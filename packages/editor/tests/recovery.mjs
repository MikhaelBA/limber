import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: process.env.HEADLESS !== '0' });
try {
  const context = await browser.newContext();
  let page = await context.newPage();
  const base = process.env.SPRINE_URL ?? 'http://localhost:5173/';
  const setup = async () => {
    await page.goto(base);
    await page.waitForFunction(() => window.__ticks > 1);
    await page.evaluate(async () => {
      window.recovery = await import('/src/persistence/autosave.ts');
      const { EditorEngine } = await import('/src/engine/EditorEngine.ts');
      window.project = new EditorEngine().project;
      window.head = () =>
        new Promise((resolve, reject) => {
          const request = indexedDB.open('limber-autosave');
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction('kv');
            const read = tx.objectStore('kv').get('current');
            tx.oncomplete = () => {
              resolve(read.result);
              db.close();
            };
            tx.onerror = () => {
              reject(tx.error);
              db.close();
            };
          };
        });
    });
  };
  await setup();
  const normal = await page.evaluate(async () => {
    await window.recovery.clearAutosave();
    window.project.name = 'First complete';
    await window.recovery.writeAutosave(window.project, [
      { textureId: 'texture', name: 'pixels', blob: new Blob(['original pixels'], { type: 'image/png' }) },
    ]);
    const record = await window.recovery.readAutosave();
    return {
      backend: (await window.head()).storage,
      name: JSON.parse(record.json).name,
      bytes: await record.textures[0].blob.text(),
    };
  });
  assert.deepEqual(normal, { backend: 'opfs', name: 'First complete', bytes: 'original pixels' });

  const failedCommit = await page.evaluate(async () => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (key === 'current') throw new DOMException('Simulated quota failure', 'QuotaExceededError');
      return put.call(this, value, key);
    };
    let rejected = false;
    try {
      window.project.name = 'Uncommitted';
      await window.recovery.writeAutosave(window.project, []);
    } catch {
      rejected = true;
    } finally {
      IDBObjectStore.prototype.put = put;
    }
    return { rejected, recovered: JSON.parse((await window.recovery.readAutosave()).json).name };
  });
  assert.deepEqual(failedCommit, { rejected: true, recovered: 'First complete' });

  const fallback = await page.evaluate(async () => {
    Object.defineProperty(navigator.storage, 'getDirectory', { value: undefined, configurable: true });
    window.project.name = 'Fallback';
    await window.recovery.writeAutosave(window.project, []);
    const stored = await window.head();
    delete navigator.storage.getDirectory;
    return {
      backend: stored.storage ?? 'indexeddb',
      name: JSON.parse((await window.recovery.readAutosave()).json).name,
    };
  });
  assert.deepEqual(fallback, { backend: 'indexeddb', name: 'Fallback' });

  const corrupted = await page.evaluate(async () => {
    window.project.name = 'Corrupted newest';
    await window.recovery.writeAutosave(window.project, []);
    const head = await window.head();
    const root = await navigator.storage.getDirectory();
    const dir = await (
      await root.getDirectoryHandle('bonebybone-recovery')
    ).getDirectoryHandle(head.snapshotId);
    const stream = await (await dir.getFileHandle('manifest.json')).createWritable();
    await stream.write('{broken');
    await stream.close();
    const record = await window.recovery.readAutosave();
    return { previous: record.recoveredFromPrevious, name: JSON.parse(record.json).name };
  });
  assert.deepEqual(corrupted, { previous: true, name: 'Fallback' });

  // Commit a known-good state, then close the tab while a newer write is unfinished.
  await page.evaluate(async () => {
    window.project.name = 'Before interruption';
    await window.recovery.writeAutosave(window.project, []);
    const create = FileSystemFileHandle.prototype.createWritable;
    FileSystemFileHandle.prototype.createWritable = async function (...args) {
      if (this.name === 'manifest.json') {
        window.interruptedWriteStarted = true;
        await new Promise(() => {});
      }
      return create.apply(this, args);
    };
    window.project.name = 'Interrupted';
    void window.recovery.writeAutosave(window.project, []);
  });
  await page.waitForFunction(() => window.interruptedWriteStarted, null, { polling: 10 });
  await page.close();
  page = await context.newPage();
  await setup();
  assert.equal(
    await page.evaluate(async () => JSON.parse((await window.recovery.readAutosave()).json).name),
    'Before interruption',
  );

  // A clear must cancel an earlier debounce and queue after any in-flight write.
  assert.equal(
    await page.evaluate(async () => {
      window.recovery.scheduleAutosave(() => ({ doc: window.project, textures: () => [] }), 30);
      await window.recovery.clearAutosave();
      await new Promise((resolve) => setTimeout(resolve, 80));
      return await window.recovery.readAutosave();
    }),
    null,
  );
  console.log(
    'PASS: OPFS bytes, failed commit rollback, IndexedDB fallback, corrupt snapshot fallback, interrupted write, debounce cancellation',
  );
} finally {
  await browser.close();
}
