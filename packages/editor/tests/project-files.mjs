import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: process.env.HEADLESS !== '0' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(process.env.SPRINE_URL ?? 'http://localhost:5173/');
  await page.waitForFunction(() => window.__ticks > 2);
  const legacy = readFileSync(new URL('../../../fixtures/limber-v2-demo.json', import.meta.url));
  const open = (name, buffer) =>
    page.locator('input[type=file]').setInputFiles({ name, mimeType: 'application/json', buffer });
  const save = async () => {
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const download = await downloading;
    assert.equal(download.suggestedFilename(), 'project.bbbproj');
    return JSON.parse(readFileSync(await download.path(), 'utf8'));
  };
  await open('legacy.limber.json', legacy);
  await page.getByText(/Opened legacy.limber.json/).waitFor();
  const saved = await save();
  assert.equal(saved.format, 'bonebybone-project');
  const rig = saved.artboards[0].nodes.find((n) => n.type === 'rig');
  const original = JSON.parse(legacy);
  assert.deepEqual(rig.skeleton, original.skeleton);
  assert.deepEqual(rig.animations, original.animations);
  assert.deepEqual(saved.assetManifest, original.assetManifest);

  await open('roundtrip.bbbproj', Buffer.from(JSON.stringify(saved)));
  await page.getByText(/Opened roundtrip.bbbproj/).waitFor();
  assert.deepEqual(await save(), saved);

  const broken = structuredClone(saved);
  broken.editor.activeArtboardId = 'missing';
  await open('invalid.bbbproj', Buffer.from(JSON.stringify(broken)));
  await page.getByText(/Open failed: Active artboard/).waitFor();
  assert.deepEqual(await save(), saved, 'failed import preserves the active project');

  const future = { ...saved, schemaVersion: 99 };
  await open('future.bbbproj', Buffer.from(JSON.stringify(future)));
  await page.getByText(/Open failed: Project schema 99/).waitFor();
  assert.deepEqual(await save(), saved);

  // A page reload loses the in-memory session; explicit recovery restores the whole project.
  await page.waitForTimeout(1900);
  await page.reload();
  await page.getByRole('button', { name: 'Restore autosave', exact: true }).click();
  await page.getByText(/Autosave restored/).waitFor();
  assert.deepEqual(await save(), saved);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: legacy migration, project save/open, embedded assets, failed/future import isolation, recovery',
  );
} finally {
  await browser.close();
}
