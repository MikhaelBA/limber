import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: process.env.HEADLESS !== '0' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(15000);
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
  // Immutable native marker fixture: UI authoring, validation, persistence and sampled poses.
  const markerFixture = JSON.parse(readFileSync(new URL('../../../fixtures/bbbproj-v4-markers.json', import.meta.url), 'utf8'));
  const openProject = async (project) => {
    await page.locator('input[type=file]').setInputFiles({ name: 'markers.bbbproj', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
    await page.waitForFunction(() => window.__markers?.some((marker) => marker.id === 'weapon'));
  };
  await openProject(markerFixture);
  await page.getByText('Markers & sockets (2)', { exact: true }).click();
  await selectBone('hand');
  await page.getByLabel('New marker kind', { exact: true }).selectOption('hitbox');
  await page.getByRole('button', { name: 'Add marker', exact: true }).click();
  const field = async (name, value) => { const input = page.getByLabel(`Marker ${name}`, { exact: true }); await input.fill(value); await input.press('Enter'); };
  await field('name', 'Sword hit');
  await field('x', '40');
  await field('width', '80');
  const authored = await save();
  assert.equal(authored.schemaVersion, 4);
  assert.equal(authored.artboards[0].nodes[0].skeleton.markers.length, 3);
  await field('width', '-2');
  await page.locator('footer').getByText(/dimensions must be positive/).waitFor();
  assert.deepEqual(await save(), authored);
  await page.getByRole('button', { name: 'Delete marker', exact: true }).click();
  assert.equal((await save()).artboards[0].nodes[0].skeleton.markers.length, 2);
  await page.keyboard.press('Control+z');
  assert.deepEqual(await save(), authored);
  await page.keyboard.press('Control+y');
  assert.equal((await save()).artboards[0].nodes[0].skeleton.markers.length, 2);
  await openProject(authored);
  assert.deepEqual(await save(), authored);
  await page.getByRole('button', { name: 'Animate', exact: true }).click();
  assert.equal(await page.getByLabel('Marker name', { exact: true }).isDisabled(), true);
  const ruler = page.locator('.cursor-ew-resize').first();
  // Timeline uses 100 px/s. Sample the middle of the existing wave animation.
  await ruler.click({ position: { x: 50, y: 12 } });
  await page.waitForFunction(() => Math.abs(window.__markers?.find((marker) => marker.id === 'weapon')?.world[5]) > 1);
  const evaluated = await page.evaluate(() => window.__markers.find((marker) => marker.id === 'weapon').world);
  assert.ok(Math.abs(evaluated[4] - (60 + 40 * Math.cos(Math.PI / 4))) < 0.1, JSON.stringify(evaluated));
  assert.ok(Math.abs(evaluated[5] - 40 * Math.sin(Math.PI / 4)) < 0.1);
  assert.deepEqual(await save(), authored, 'Sampling must not change source transforms or keys');
  await page.getByRole('button', { name: 'Setup', exact: true }).click();
  await page.waitForFunction(() => Math.abs(window.__markers?.find((marker) => marker.id === 'weapon')?.world[5]) < 0.001);
  await page.screenshot({ path: 'packages/editor/.smoke/rig-markers.png' });
  assert.deepEqual(errors, []);
  console.log('PASS: marker create/edit/delete, validation, save/reopen, animated world poses and setup isolation; weighted delete errors in hierarchy/hotkey, singular parent rejection, reparent and exact native undo/redo');
} finally {
  await browser.close();
}
