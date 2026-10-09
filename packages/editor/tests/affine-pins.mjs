import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
const out = 'packages/editor/.smoke';
mkdirSync(out, { recursive: true });
const fixture = JSON.parse(readFileSync('examples/fox-adventurer/Fox-Adventurer.bbbproj', 'utf8'));
const rig = fixture.artboards[0].nodes[0];
const identity = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 };
rig.skeleton = {
  bones: [
    {
      id: 'body',
      name: 'Body',
      parentId: null,
      length: 10,
      setupPose: { ...identity, x: 100, y: 100, rotation: 0.4, scaleX: -1.4, scaleY: 0.8, shearX: 0.2 },
    },
    {
      id: 'upper',
      name: 'Upper',
      parentId: 'body',
      length: 40,
      setupPose: { ...identity, x: 10, y: 8, rotation: 0.8, scaleX: 1.3, scaleY: 0.7, shearX: 0.25 },
    },
    {
      id: 'lower',
      name: 'Lower',
      parentId: 'upper',
      length: 30,
      setupPose: { ...identity, x: 40, rotation: -1.5, scaleX: 0.9, shearY: 0.2 },
    },
    { id: 'hand', name: 'Hand', parentId: 'lower', length: 8, setupPose: { ...identity, x: 30 } },
    { id: 'pole', name: 'Pole', parentId: null, length: 8, setupPose: { ...identity, x: 100, y: 250 } },
  ],
  slots: [],
  attachments: [],
  ikConstraints: [],
  skins: [],
  activeSkin: '',
  markers: [
    { id: 'wrist', name: 'wrist', kind: 'point', boneId: 'hand', transform: { ...identity } },
    { id: 'elbow', name: 'elbow', kind: 'point', boneId: 'lower', transform: { ...identity } },
  ],
};
rig.animations = [{ name: 'Idle', duration: 1, loop: true, timelines: [] }];
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(process.env.SPRINE_URL ?? 'http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__ticks > 2);
  const open = async (data, name) => {
    await page
      .locator('input[type=file]')
      .setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
    await page
      .locator('footer')
      .getByText(new RegExp(`Opened ${name}`))
      .waitFor();
  };
  const save = async () => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    return JSON.parse(readFileSync(await (await pending).path(), 'utf8'));
  };
  const select = async (name) =>
    page
      .locator('[draggable=true]')
      .filter({ has: page.getByText(name, { exact: true }) })
      .click();
  const field = async (label, value) => {
    const input = page.getByLabel(label, { exact: true });
    await input.fill(String(value));
    await input.press('Enter');
  };
  const marker = async (id) =>
    page.evaluate((id) => window.__markers.find((m) => m.id === id).world.slice(4, 6), id);
  const close = (a, b) => assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.001, `${a} versus ${b}`);
  await open(fixture, 'affine.bbbproj');
  await page.waitForFunction(() => window.__markers?.some((m) => m.id === 'wrist'));
  const before = await save(),
    wrist = await marker('wrist');
  await select('Hand');
  await page.getByRole('button', { name: 'Pin Hand', exact: true }).click();
  await page
    .locator('footer')
    .getByText(/Pin Hand created/)
    .waitFor();
  close(await marker('wrist'), wrist);
  const pinned = await save(),
    c = pinned.artboards[0].nodes[0].skeleton.ikConstraints[0];
  assert.deepEqual(c.bones, ['upper', 'lower']);
  await page.keyboard.press('Control+z');
  assert.deepEqual(await save(), before);
  await page.keyboard.press('Control+y');
  assert.deepEqual(await save(), pinned);
  await select('Body');
  await field('X', 101);
  await field('Y', 101);
  await page.waitForFunction((w) => {
    const m = window.__markers.find((m) => m.id === 'wrist').world;
    return Math.hypot(m[4] - w[0], m[5] - w[1]) < 0.001;
  }, wrist);
  const moved = await save();
  const name = moved.artboards[0].nodes[0].skeleton.bones.find((b) => b.id === c.targetId).name;
  await select(name);
  await page.getByText('Advanced IK', { exact: true }).click();
  await page.getByLabel('IK pole', { exact: true }).selectOption('pole');
  const poled = await save();
  assert.equal(poled.artboards[0].nodes[0].skeleton.ikConstraints[0].poleVectorId, 'pole');
  close(await marker('wrist'), wrist);
  await page.keyboard.press('Control+z');
  assert.deepEqual(await save(), moved);
  await page.keyboard.press('Control+y');
  assert.deepEqual(await save(), poled);
  await field('IK softness', -1);
  await page
    .locator('footer')
    .getByText(/softness must be finite/)
    .waitFor();
  assert.deepEqual(await save(), poled);
  await field('IK softness', 100);
  const softened = await save();
  assert.equal(softened.artboards[0].nodes[0].skeleton.ikConstraints[0].softness, 100);
  await page.waitForFunction((w) => {
    const m = window.__markers.find((m) => m.id === 'wrist').world;
    return Math.hypot(m[4] - w[0], m[5] - w[1]) > 0.01;
  }, wrist);
  const softWrist = await marker('wrist');
  assert.ok(Math.hypot(softWrist[0] - wrist[0], softWrist[1] - wrist[1]) > 0.01);
  await page.keyboard.press('Control+z');
  assert.deepEqual(await save(), poled);
  await page.keyboard.press('Control+y');
  assert.deepEqual(await save(), softened);
  await open(softened, 'reopened-affine.bbbproj');
  assert.deepEqual(await save(), softened);
  close(await marker('wrist'), softWrist);
  await select(name);
  await page.getByRole('button', { name: 'Animate', exact: true }).click();
  assert.equal(await page.getByLabel('IK pole', { exact: true }).isDisabled(), true);
  assert.equal(await page.getByLabel('IK softness', { exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: 'Setup', exact: true }).click();
  const broken = structuredClone(softened);
  broken.artboards[0].nodes[0].skeleton.ikConstraints[0].poleVectorId = 'lower';
  await page.locator('input[type=file]').setInputFiles({
    name: 'invalid-pole.bbbproj',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(broken)),
  });
  await page
    .locator('footer')
    .getByText(/Open failed:.*feedback cycle/)
    .waitFor();
  assert.deepEqual(await save(), softened);
  await page.screenshot({ path: `${out}/affine-pins.png` });
  assert.deepEqual(errors, []);
  console.log(
    '[affine-pins] reflected/sheared limb, independent body, pole/softness controls, exact undo/redo, Save/Open and failure isolation passed.',
  );
} finally {
  await browser.close();
}
