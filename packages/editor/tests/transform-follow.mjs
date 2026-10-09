import { CURRENT_SOURCE_SCHEMA } from '../../../tools/project-schema.mjs';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
const fixture = JSON.parse(readFileSync('fixtures/bbbproj-v1-demo.json', 'utf8')),
  rig = fixture.artboards[0].nodes[0];
const identity = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 };
rig.skeleton = {
  bones: [
    {
      id: 'body',
      name: 'Body',
      parentId: null,
      length: 10,
      setupPose: { ...identity, x: 100, y: 100, scaleX: -1.6, scaleY: 0.8, rotation: 0.3, shearX: 0.2 },
    },
    {
      id: 'follower',
      name: 'Follower',
      parentId: 'body',
      length: 30,
      setupPose: { ...identity, x: 20, y: 10, rotation: -0.2, scaleX: 0.9, scaleY: 1.2, shearY: 0.3 },
    },
    {
      id: 'target',
      name: 'Target',
      parentId: null,
      length: 10,
      setupPose: { ...identity, x: 40, y: 160, rotation: 0.6, scaleX: 1.3, scaleY: 0.7, shearY: 0.2 },
    },
    { id: 'other', name: 'Other', parentId: null, length: 20, setupPose: { ...identity, x: 150, y: 50 } },
  ],
  slots: [],
  attachments: [],
  ikConstraints: [],
  skins: [],
  activeSkin: '',
  markers: ['follower', 'target'].map((id) => ({
    id,
    name: id,
    kind: 'point',
    boneId: id,
    transform: { ...identity },
  })),
};
rig.animations = [{ name: 'Idle', duration: 1, loop: true, timelines: [] }];
mkdirSync('packages/editor/.smoke', { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } }),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(process.env.SPRINE_URL ?? 'http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__ticks > 2);
  const open = async (value, name) => {
    await page
      .locator('input[type=file]')
      .setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
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
  const marker = async (id) => page.evaluate((id) => window.__markers.find((m) => m.id === id).world, id);
  await open(fixture, 'follow.bbbproj');
  await page.waitForFunction(() => window.__markers?.some((m) => m.id === 'follower'));
  const before = await save(),
    initial = await marker('follower');
  await select('Follower');
  await page.getByLabel('Follow target', { exact: true }).selectOption('target');
  await page.getByRole('button', { name: 'Follow transform', exact: true }).click();
  await page
    .locator('footer')
    .getByText(/Transform follow created/)
    .waitFor();
  const authored = await save();
  assert.equal(authored.schemaVersion, CURRENT_SOURCE_SCHEMA);
  const c = authored.artboards[0].nodes[0].skeleton.transformConstraints[0];
  assert.equal(c.targetId, 'target');
  assert.equal(c.boneId, 'follower');
  assert.equal(c.order, 0);
  const held = await marker('follower');
  held.forEach((v, i) => assert.ok(Math.abs(v - initial[i]) < 0.001));
  await page.keyboard.press('Control+z');
  assert.deepEqual(await save(), before);
  await page.keyboard.press('Control+y');
  assert.deepEqual(await save(), authored);
  await select('Target');
  await field('X', 52);
  await page.waitForFunction(
    (x) => Math.abs(window.__markers.find((m) => m.id === 'follower').world[4] - x) < 0.001,
    initial[4] + 12,
  );
  await select('Follower');
  await field('Follow position', 0.5);
  await page.waitForFunction(
    (x) => Math.abs(window.__markers.find((m) => m.id === 'follower').world[4] - x) < 0.001,
    initial[4] + 6,
  );
  const mixed = await save();
  await field('Follow rotation', 2);
  await page
    .locator('footer')
    .getByText(/mixRotation must be finite/)
    .waitFor();
  assert.deepEqual(await save(), mixed);
  await page.getByText('Advanced follow', { exact: true }).click();
  await field('Follow offset x', c.offset.x + 2);
  const offset = await save();
  assert.equal(offset.artboards[0].nodes[0].skeleton.transformConstraints[0].offset.x, c.offset.x + 2);
  await page.keyboard.press('Control+z');
  assert.deepEqual(await save(), mixed);
  await page.keyboard.press('Control+y');
  assert.deepEqual(await save(), offset);
  await page.getByLabel('Follow space', { exact: true }).selectOption('local');
  const local = await save();
  assert.equal(local.artboards[0].nodes[0].skeleton.transformConstraints[0].space, 'local');
  await page.keyboard.press('Control+z');
  assert.deepEqual(await save(), offset);
  await select('Other');
  await page.getByText('Advanced creation', { exact: true }).click();
  await page.getByRole('button', { name: '＋ Add IK', exact: true }).click();
  await page
    .locator('footer')
    .getByText(/IK created/)
    .waitFor();
  const combined = await save();
  assert.equal(combined.artboards[0].nodes[0].skeleton.ikConstraints[0].order, 1);
  await select('Follower');
  await page.getByText('Advanced follow', { exact: true }).click();
  await page.getByTitle('Move follow later', { exact: true }).click();
  const reordered = await save();
  writeFileSync('packages/editor/.smoke/transform-follow.bbbproj', JSON.stringify(reordered, null, 2));
  assert.equal(reordered.artboards[0].nodes[0].skeleton.transformConstraints[0].order, 1);
  assert.equal(reordered.artboards[0].nodes[0].skeleton.ikConstraints[0].order, 0);
  await page.keyboard.press('Control+z');
  assert.deepEqual(await save(), combined);
  await page.keyboard.press('Control+y');
  assert.deepEqual(await save(), reordered);
  await page.getByRole('button', { name: 'Animate', exact: true }).click();
  assert.equal(await page.getByLabel('Follow position', { exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: 'Setup', exact: true }).click();
  await page.getByTitle('Delete transform follow', { exact: true }).click();
  assert.deepEqual((await save()).artboards[0].nodes[0].skeleton.transformConstraints, []);
  await page.keyboard.press('Control+z');
  assert.deepEqual(await save(), reordered);
  const finalMarker = await marker('follower');
  await open(reordered, 'reopened-follow.bbbproj');
  assert.deepEqual(await save(), reordered);
  await page.getByRole('button', { name: 'Export Spine JSON', exact: true }).click();
  await page
    .locator('footer')
    .getByText(/Spine export failed:.*native transform follow/)
    .waitFor();
  assert.deepEqual(await save(), reordered);
  const restored = await marker('follower');
  restored.forEach((v, i) => assert.ok(Math.abs(v - finalMarker[i]) < 0.001));
  const broken = structuredClone(reordered);
  broken.artboards[0].nodes[0].skeleton.transformConstraints[0].targetId = 'follower';
  await page.locator('input[type=file]').setInputFiles({
    name: 'invalid-follow.bbbproj',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(broken)),
  });
  await page
    .locator('footer')
    .getByText(/Open failed:.*feedback cycle/)
    .waitFor();
  assert.deepEqual(await save(), reordered);
  await select('Follower');
  await page.getByText('Advanced follow', { exact: true }).click();
  await page.screenshot({ path: 'packages/editor/.smoke/transform-follow.png' });
  assert.deepEqual(errors, []);
  console.log(
    '[transform-follow] affine target follow, independent mixes, offsets/space, shared IK order, exact history, Setup isolation and Save/Open passed.',
  );
} finally {
  await browser.close();
}
