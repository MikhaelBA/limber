import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: process.env.HEADLESS !== '0' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(process.env.SPRINE_URL ?? 'http://localhost:5173/');
  await page.waitForFunction(() => window.__ticks > 2);
  const bone = (id, parentId, pose = {}) => ({ id, name: id, parentId, length: 60,
    setupPose: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0, ...pose } });
  const fixture = { version: 2, skeleton: {
    bones: [bone('root', null), bone('child', 'root', { x: 60 }), bone('zero', null, { x: -100, scaleX: 0 })],
    slots: [{ id: 'slot', name: 'image', boneId: 'root', defaultAttachmentId: 'weighted', color: 0xffffffff }],
    attachments: [{ id: 'weighted', name: 'weighted', type: 'region', textureId: '',
      vertices: [-10, -10, 10, -10, 10, 10, -10, 10], uvs: [0, 0, 1, 0, 1, 1, 0, 1],
      weights: [1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1] }],
    ikConstraints: [], skins: [], activeSkin: '',
  }, animations: [], assetManifest: {} };
  await page.locator('input[type=file]').setInputFiles({
    name: 'rig.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)),
  });
  const selectBone = async (name) => page.locator('[draggable=true]').filter({ has: page.getByText(name, { exact: true }) }).click();
  const save = async () => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    return JSON.parse(readFileSync(await (await pending).path(), 'utf8'));
  };
  await selectBone('root');
  const before = await save();
  await selectBone('root');
  await page.keyboard.press('Delete');
  await page.locator('footer').getByText(/Rebind or remove weighted attachment/).waitFor();
  assert.deepEqual(await save(), before);
  await page.getByTitle('Delete selected (Del)', { exact: true }).click();
  await page.locator('footer').getByText(/Rebind or remove weighted attachment/).waitFor();
  assert.deepEqual(await save(), before);
  await selectBone('child');
  await page.getByLabel('Bone parent', { exact: true }).selectOption('zero');
  await page.locator('footer').getByText(/zero-scale/).waitFor();
  assert.deepEqual(await save(), before);
  await page.getByLabel('Bone parent', { exact: true }).selectOption('');
  const changed = await save();
  assert.equal(changed.artboards[0].nodes[0].skeleton.bones.find((b) => b.id === 'child').parentId, null);
  await page.keyboard.press('Control+z');
  assert.deepEqual(await save(), before);
  await page.keyboard.press('Control+y');
  assert.deepEqual(await save(), changed);
  mkdirSync('packages/editor/.smoke', { recursive: true });
  await page.screenshot({ path: 'packages/editor/.smoke/rig-structural.png' });
  assert.deepEqual(errors, []);
  console.log('PASS: weighted delete errors in hierarchy/hotkey, singular parent rejection, reparent and exact native undo/redo');
} finally {
  await browser.close();
}
