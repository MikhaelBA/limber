import { deserializeProject, serializeProject, uuid, type BoneByBoneProject } from '@limber/core';

// Keep the existing database so Limber recovery records remain discoverable.
const DB_NAME = 'limber-autosave';
const STORE = 'kv';
const CURRENT = 'current';
const PREVIOUS = 'previous';
const DIRECTORY = 'bonebybone-recovery';

export interface AutosaveTexture {
  textureId: string;
  name: string;
  blob: Blob;
}
export interface AutosaveRecord {
  json: string;
  textures: AutosaveTexture[];
  savedAt: number;
  recoveredFromPrevious?: boolean;
}
interface OpfsReference {
  storage: 'opfs';
  snapshotId: string;
  savedAt: number;
  // Small document mirror supports diagnostics and existing recovery discovery.
  json: string;
}
type StoredRecord = AutosaveRecord | OpfsReference;
interface SnapshotManifest {
  json: string;
  savedAt: number;
  textures: { textureId: string; name: string; file: string; type: string; size: number }[];
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Recovery database could not be opened.'));
  });
}

async function readHeads(): Promise<[StoredRecord | undefined, StoredRecord | undefined]> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      const current = store.get(CURRENT);
      const previous = store.get(PREVIOUS);
      tx.oncomplete = () => resolve([current.result, previous.result]);
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Recovery index read failed.'));
    });
  } finally {
    db.close();
  }
}

function isOpfs(value: StoredRecord): value is OpfsReference {
  return 'storage' in value && value.storage === 'opfs';
}
async function directory(): Promise<FileSystemDirectoryHandle> {
  if (!navigator.storage?.getDirectory) throw new Error('OPFS is unavailable.');
  return (await navigator.storage.getDirectory()).getDirectoryHandle(DIRECTORY, { create: true });
}
function validSnapshotId(id: string): boolean {
  return /^snapshot-[a-zA-Z0-9-]+$/.test(id);
}
async function removeSnapshot(ref: StoredRecord | undefined): Promise<void> {
  if (!ref || !isOpfs(ref) || !validSnapshotId(ref.snapshotId)) return;
  try {
    await (await directory()).removeEntry(ref.snapshotId, { recursive: true });
  } catch {
    /* Cleanup must never invalidate an already committed recovery index. */
  }
}
async function writeFile(dir: FileSystemDirectoryHandle, name: string, data: string | Blob): Promise<void> {
  const file = await dir.getFileHandle(name, { create: true });
  const stream = await file.createWritable();
  try {
    await stream.write(data);
    await stream.close();
  } catch (error) {
    await stream.abort().catch(() => {});
    throw error;
  }
}

async function writeSnapshot(record: AutosaveRecord): Promise<OpfsReference> {
  const ref: OpfsReference = {
    storage: 'opfs',
    snapshotId: `snapshot-${uuid()}`,
    savedAt: record.savedAt,
    json: record.json,
  };
  const root = await directory();
  const dir = await root.getDirectoryHandle(ref.snapshotId, { create: true });
  try {
    const manifest: SnapshotManifest = { json: record.json, savedAt: record.savedAt, textures: [] };
    for (let i = 0; i < record.textures.length; i++) {
      const texture = record.textures[i]!;
      const file = `texture-${i}.bin`;
      await writeFile(dir, file, texture.blob);
      manifest.textures.push({
        textureId: texture.textureId,
        name: texture.name,
        file,
        type: texture.blob.type,
        size: texture.blob.size,
      });
    }
    // Publish no pointer until every file is closed and the manifest is durable.
    await writeFile(dir, 'manifest.json', JSON.stringify(manifest));
    return ref;
  } catch (error) {
    await removeSnapshot(ref);
    throw error;
  }
}

async function readSnapshot(ref: OpfsReference): Promise<AutosaveRecord> {
  if (!validSnapshotId(ref.snapshotId)) throw new Error('Invalid recovery snapshot ID.');
  const dir = await (await directory()).getDirectoryHandle(ref.snapshotId);
  const file = await (await dir.getFileHandle('manifest.json')).getFile();
  const manifest = JSON.parse(await file.text()) as SnapshotManifest;
  if (
    typeof manifest.json !== 'string' ||
    !Array.isArray(manifest.textures) ||
    !Number.isFinite(manifest.savedAt)
  )
    throw new Error('Invalid recovery manifest.');
  deserializeProject(manifest.json);
  const textures: AutosaveTexture[] = [];
  for (const item of manifest.textures) {
    if (
      !/^texture-\d+\.bin$/.test(item.file) ||
      typeof item.textureId !== 'string' ||
      typeof item.name !== 'string'
    )
      throw new Error('Invalid recovery texture reference.');
    const blob = await (await dir.getFileHandle(item.file)).getFile();
    if (blob.size !== item.size) throw new Error('Incomplete recovery texture.');
    textures.push({ textureId: item.textureId, name: item.name, blob: blob.slice(0, blob.size, item.type) });
  }
  return { json: manifest.json, savedAt: manifest.savedAt, textures };
}

// Serialize writes/clears so a slow old snapshot cannot replace a newer one.
let writes: Promise<void> = Promise.resolve();
async function withRecoveryLock<T>(operation: () => Promise<T>): Promise<T> {
  return await (navigator.locks ? navigator.locks.request('bonebybone-recovery', operation) : operation());
}
function enqueue(operation: () => Promise<void>): Promise<void> {
  const next = writes.catch(() => {}).then(() => withRecoveryLock(operation));
  writes = next;
  return next;
}

export function writeAutosave(doc: BoneByBoneProject, textures: AutosaveTexture[]): Promise<void> {
  // Capture the actual edit now, before any asynchronous work or queue delay.
  const snapshot: AutosaveRecord = {
    json: serializeProject(doc),
    savedAt: Date.now(),
    textures: textures.map((item) => ({ ...item })),
  };
  return enqueue(async () => {
    const heads = await readHeads();
    let retained: StoredRecord | undefined;
    for (const head of heads) {
      if (!head) continue;
      try {
        await loadRecord(head);
        retained = head;
        break;
      } catch {
        /* Never replace a readable previous generation with a corrupt head. */
      }
    }
    let next: StoredRecord;
    try {
      next = await writeSnapshot(snapshot);
    } catch {
      next = snapshot;
    } // HTTP/unsupported/private/quota: retain IndexedDB fallback.
    let db: IDBDatabase | undefined;
    try {
      db = await openDb();
      const opened = db;
      await new Promise<void>((resolve, reject) => {
        const tx = opened.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        tx.oncomplete = () => resolve();
        tx.onabort = tx.onerror = () =>
          reject(tx.error ?? new Error('Autosave could not be committed. Save a project file now.'));
        try {
          if (retained) store.put(retained, PREVIOUS);
          else store.delete(PREVIOUS);
          store.put(next, CURRENT);
        } catch (error) {
          tx.abort();
          reject(error);
        }
      });
    } catch (error) {
      await removeSnapshot(next);
      throw error;
    } finally {
      db?.close();
    }
    await Promise.all(heads.filter((head) => head !== retained).map(removeSnapshot));
  });
}

async function loadRecord(head: StoredRecord): Promise<AutosaveRecord> {
  const record = isOpfs(head) ? await readSnapshot(head) : head;
  deserializeProject(record.json);
  if (!Array.isArray(record.textures) || record.textures.some((t) => !(t.blob instanceof Blob)))
    throw new Error('Invalid recovery textures.');
  return record;
}

export async function readAutosave(): Promise<AutosaveRecord | null> {
  return withRecoveryLock(readCompleteAutosave);
}

async function readCompleteAutosave(): Promise<AutosaveRecord | null> {
  const heads = await readHeads();
  for (let i = 0; i < heads.length; i++) {
    const head = heads[i];
    if (!head) continue;
    try {
      const record = await loadRecord(head);
      return { ...record, recoveredFromPrevious: i > 0 };
    } catch {
      /* Try the previous complete generation. */
    }
  }
  if (heads.some(Boolean))
    throw new Error('No readable autosave remains. Open your last saved project file.');
  return null;
}

let timer: ReturnType<typeof setTimeout> | undefined;
let pending = 0;
export function cancelScheduledAutosave(): void {
  if (timer) clearTimeout(timer);
  timer = undefined;
  pending++;
}
export function clearAutosave(): Promise<void> {
  cancelScheduledAutosave();
  return enqueue(async () => {
    const heads = await readHeads();
    const db = await openDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        store.delete(CURRENT);
        store.delete(PREVIOUS);
        tx.oncomplete = () => resolve();
        tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Recovery clear failed.'));
      });
    } finally {
      db.close();
    }
    await Promise.all(heads.map(removeSnapshot));
  });
}

export function scheduleAutosave(
  get: () => { doc: BoneByBoneProject; textures: () => AutosaveTexture[] },
  delayMs = 1500,
  onError: (message: string) => void = () => {},
): void {
  cancelScheduledAutosave();
  const seq = pending;
  timer = setTimeout(async () => {
    timer = undefined;
    if (seq !== pending) return;
    try {
      const { doc, textures } = get();
      await writeAutosave(doc, textures());
    } catch {
      onError('Autosave failed. Use Save to download your project before closing.');
    }
  }, delayMs);
}
