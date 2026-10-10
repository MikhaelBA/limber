import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { CURRENT_SOURCE_SCHEMA } from '../../../tools/project-schema.mjs';
mkdirSync('packages/editor/.smoke', { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } }),
    errors = [];
  page.setDefaultTimeout(20000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(process.env.SPRINE_URL ?? 'http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__ticks > 2);
  const save = async () => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    return JSON.parse(readFileSync(await (await pending).path(), 'utf8'));
  };
  const open = (project, name) =>
    page.locator('input[type=file][accept^=".bbbproj"]').setInputFiles({
      name,
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(project)),
    });
  await page.getByRole('button', { name: 'Animate', exact: true }).click();
  const rigBefore = await save();
  await page.getByRole('button', { name: 'Character event payload', exact: true }).click();
  await page.getByLabel('Character event template', { exact: true }).selectOption('AttackHit');
  await page.getByLabel('Character event payload value', { exact: true }).fill('17');
  await page.screenshot({ path: 'packages/editor/.smoke/typed-events-character.png' });
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByTitle('Key this event at the playhead (fires during playback)', { exact: true }).click();
  const rigAfter = await save(),
    rig = rigAfter.artboards[0].nodes.find((n) => n.type === 'rig');
  const key = rig.animations[0].timelines.find((t) => t.kind === 'event').keyframes[0];
  assert.equal(rigAfter.schemaVersion, CURRENT_SOURCE_SCHEMA);
  assert.equal(key.eventName, 'AttackHit');
  assert.deepEqual(key.payload, { type: 'int', value: 17 });
  await page.getByTitle('Undo (Ctrl+Z)', { exact: true }).click();
  assert.deepEqual(await save(), rigBefore);
  await page.getByTitle('Redo (Ctrl+Shift+Z / Ctrl+Y)', { exact: true }).click();
  assert.deepEqual(await save(), rigAfter);
  await page.getByRole('button', { name: 'Character event payload: int', exact: true }).click();
  await page.getByLabel('Character event payload value', { exact: true }).fill('1.5');
  assert.equal(
    await page
      .getByTitle('Key this event at the playhead (fires during playback)', { exact: true })
      .isDisabled(),
    true,
  );
  assert.match(
    await page.getByLabel('Character event error', { exact: true }).textContent(),
    /signed 32-bit/,
  );
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  assert.deepEqual(await save(), rigAfter);
  for (const name of ['Export Spine JSON', 'Export Spine Bundle']) {
    await page.getByRole('button', { name, exact: true }).click();
    await page
      .locator('footer')
      .getByText(/export failed:.*typed event payload/)
      .waitFor();
    assert.deepEqual(await save(), rigAfter);
  }
  await page.getByRole('button', { name: 'Scene', exact: true }).click();
  await page.getByRole('button', { name: 'Animation', exact: true }).click();
  await page.getByRole('button', { name: 'New clip', exact: true }).click();
  const before = await save();
  await page.getByRole('button', { name: 'Scene event payload', exact: true }).click();
  await page.getByLabel('Scene event template', { exact: true }).selectOption('UIConfirm');
  await page.screenshot({ path: 'packages/editor/.smoke/typed-events-scene.png' });
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Key event', exact: true }).click();
  const after = await save(),
    board = after.artboards[0];
  assert.deepEqual(board.clips[0].events[0].payload, { type: 'bool', value: true });
  assert.equal(board.clips[0].events[0].name, 'UIConfirm');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await save(), before);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  assert.deepEqual(await save(), after);
  await page.getByRole('button', { name: 'Scene event payload: bool', exact: true }).click();
  await page.getByLabel('Scene event payload type', { exact: true }).selectOption('string');
  await page.getByLabel('Scene event payload value', { exact: true }).fill('سلام 🌿');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByLabel('Scene event name', { exact: true }).fill('LocalizedCue');
  await page.getByRole('button', { name: 'Key event', exact: true }).click();
  const final = await save();
  assert.deepEqual(final.artboards[0].clips[0].events[1].payload, { type: 'string', value: 'سلام 🌿' });
  const malformed = structuredClone(final);
  malformed.artboards[0].clips[0].events[1].payload = { type: 'int', value: 1.5 };
  await open(malformed, 'bad-typed-event.bbbproj');
  await page
    .locator('footer')
    .getByText(/Open failed:.*int payload/)
    .waitFor();
  assert.deepEqual(await save(), final);
  await open(final, 'reopened-typed-events.bbbproj');
  await page
    .locator('footer')
    .getByText(/Opened reopened-typed-events.bbbproj/)
    .waitFor();
  assert.deepEqual(await save(), final);
  writeFileSync('packages/editor/.smoke/typed-events.bbbproj', JSON.stringify(final, null, 2));
  await page.screenshot({ path: 'packages/editor/.smoke/typed-events.png' });
  assert.deepEqual(errors, []);
  console.log(
    'PASS: explicit typed scene/rig event authoring, generic templates/custom Unicode payload, atomic invalid drafts/import, exact history/Save/Open and compatibility-export rejection',
  );
} finally {
  await browser.close();
}
