import { serializeDocument, type EditorDocument } from '@limber/core';

/**
 * Crash-safe autosave (DESIGN.md §7): the serialized document + the source
 * texture BLOBS live in IndexedDB, so a restore is pixel-complete — no
 * re-dropping images. Writing is debounced by the caller (App subscribes to
 * dataRevision and schedules after ~1.5s of quiet).
 */

const DB_NAME = 'limber-autosave';
const STORE = 'kv';
const KEY = 'current';

export interface AutosaveTexture {
  textureId: string;
  name: string;
  blob: Blob;
}

export interface AutosaveRecord {
  json: string;
  textures: AutosaveTexture[];
  savedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
  });
}

export async function writeAutosave(doc: EditorDocument, textures: AutosaveTexture[]): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ json: serializeDocument(doc), textures, savedAt: Date.now() } satisfies AutosaveRecord, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('autosave write failed'));
    });
  } finally {
    db.close();
  }
}

export async function readAutosave(): Promise<AutosaveRecord | null> {
  const db = await openDb();
  try {
    return await new Promise<AutosaveRecord | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as AutosaveRecord | undefined) ?? null);
      req.onerror = () => reject(req.error ?? new Error('autosave read failed'));
    });
  } finally {
    db.close();
  }
}

export async function clearAutosave(): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('autosave clear failed'));
    });
  } finally {
    db.close();
  }
}

/** One shared timer — schedule overwrites any pending write (debounce). */
let timer: ReturnType<typeof setTimeout> | undefined;
let pending = 0;

export function scheduleAutosave(get: () => { doc: EditorDocument; textures: () => AutosaveTexture[] }, delayMs = 1500): void {
  if (timer) clearTimeout(timer);
  pending++;
  const seq = pending;
  timer = setTimeout(async () => {
    timer = undefined;
    if (seq !== pending) return; // A newer edit rescheduled us.
    try {
      const { doc, textures } = get();
      await writeAutosave(doc, textures());
    } catch {
      /* Quota/private-mode failures must never break editing. */
    }
  }, delayMs);
}
