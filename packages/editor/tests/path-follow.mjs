import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { CURRENT_SOURCE_SCHEMA } from '../../../tools/project-schema.mjs';
const fixture = JSON.parse(readFileSync('fixtures/bbbproj-v1-demo.json', 'utf8')),
  rig = fixture.artboards[0].nodes[0];
const identity = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 };
rig.skeleton = {
  bones: [
    { id: 'body', name: 'Body', parentId: null, length: 10, setupPose: { ...identity, x: 100, y: 100 } },
    { id: 'tail', name: 'Tail', parentId: 'body', length: 30, setupPose: { ...identity, x: 20 } },
    { id: 'tip', name: 'Tip', parentId: 'tail', length: 30, setupPose: { ...identity, x: 30 } },
    { id: 'other', name: 'Other', parentId: null, length: 20, setupPose: { ...identity, x: 30, y: 30 } },
  ],
  slots: [],
  attachments: [],
  ikConstraints: [],
  skins: [],
  activeSkin: '',
  markers: ['tail', 'tip'].map((id) => ({
    id,
    name: id,
    kind: 'point',
    boneId: id,
    transform: { ...identity },
  })),
};
rig.animations = [{ name: 'Travel', duration: 1, loop: true, timelines: [] }];
mkdirSync('packages/editor/.smoke', { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } }),
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
  const position = async (x, y) =>
    page.waitForFunction(
      ({ x, y }) => {
        const m = window.__markers?.find((m) => m.id === 'tail')?.world;
        return m && Math.abs(m[4] - x) < 0.001 && Math.abs(m[5] - y) < 0.001;
      },
      { x, y },
    );
  await open(fixture, 'path.bbbproj');
  await select('Tail');
  const before = await save();
  await page.getByLabel('Path chain end', { exact: true }).selectOption('tip');
  await page.getByRole('button', { name: 'Follow path', exact: true }).click();
  await page
    .locator('footer')
    .getByText(/Path follow created/)
    .waitFor();
  const created = await save(),
    sk = created.artboards[0].nodes[0].skeleton,
    c = sk.pathConstraints[0],
    p = sk.paths[0];
  assert.equal(created.schemaVersion, CURRENT_SOURCE_SCHEMA);
  assert.deepEqual(c.bones, ['tail', 'tip']);
  assert.equal(c.pathId, p.id);
  assert.ok(sk.bones.some((b) => b.id === c.driverId));
  await position(120, 100);
  await page.keyboard.press('Control+z');
  assert.deepEqual(await save(), before);
  await page.keyboard.press('Control+y');
  assert.deepEqual(await save(), created);
  await field('Path progress %', 50);
  await position(220, 145);
  await field('Path position strength', 0);
  await position(120, 100);
  await field('Path position strength', 1);
  await position(220, 145);
  const valid = await save();
  await field('Path spacing', -2);
  await page
    .locator('footer')
    .getByText(/spacing must be nonnegative/)
    .waitFor();
  assert.deepEqual(await save(), valid);
  await page.getByText(`Edit curve: ${p.name}`, { exact: true }).click();
  await page.getByText('Segment 1', { exact: true }).click();
  await field('Path 1 control 1 Y', 0);
  await field('Path 1 control 2 Y', 0);
  await position(220, 100);
  await page.getByTitle('Extend path', { exact: true }).click();
  const extended = await save();
  assert.equal(extended.artboards[0].nodes[0].skeleton.paths[0].segments.length, 2);
  await field('Path 1 end X', 210);
  const joined = await save();
  assert.equal(joined.artboards[0].nodes[0].skeleton.paths[0].segments[1][0], 210);
  await page.keyboard.press('Control+z');
  assert.deepEqual(await save(), extended);
  await page.getByTitle('Remove last path segment', { exact: true }).click();
  await position(220, 100);
  await page.getByTitle('Toggle closed path', { exact: true }).click();
  const loop = await save();
  assert.equal(loop.artboards[0].nodes[0].skeleton.paths[0].closed, true);
  assert.deepEqual(loop.artboards[0].nodes[0].skeleton.paths[0].segments.at(-1).slice(6), [0, 0]);
  await page.keyboard.press('Control+z');
  await field('Path progress %', 0);
  await page.getByRole('button', { name: 'Animate', exact: true }).click();
  assert.equal(await page.getByLabel('Path spacing', { exact: true }).isDisabled(), true);
  await page.getByLabel('Key path progress %', { exact: true }).fill('70');
  await page.getByRole('button', { name: 'Key path progress', exact: true }).click();
  await position(260, 100);
  const keyed = await save(),
    timeline = keyed.artboards[0].nodes[0].animations[0].timelines.find(
      (t) => t.boneId === c.driverId && t.property === 'x',
    );
  assert.equal(timeline.keyframes[0].value, 70);
  assert.equal(timeline.keyframes[0].time, 0);
  await page.keyboard.press('Control+z');
  assert.equal((await save()).artboards[0].nodes[0].animations[0].timelines.length, 0);
  await position(120, 100);
  await page.keyboard.press('Control+y');
  assert.deepEqual(await save(), keyed);
  await position(260, 100);
  await page.getByRole('button', { name: 'Setup', exact: true }).click();
  await position(120, 100);
  await select('Other');
  await page.getByText('Advanced creation', { exact: true }).click();
  await page.getByRole('button', { name: '＋ Add IK', exact: true }).click();
  await page
    .locator('footer')
    .getByText(/IK created/)
    .waitFor();
  await select('Tail');
  await page.getByText('Advanced path', { exact: true }).click();
  await page.getByTitle('Move path later', { exact: true }).click();
  const ordered = await save();
  assert.equal(ordered.artboards[0].nodes[0].skeleton.ikConstraints[0].order, 0);
  assert.equal(ordered.artboards[0].nodes[0].skeleton.pathConstraints[0].order, 1);
  await page.getByTitle('Delete path follow', { exact: true }).click();
  assert.deepEqual((await save()).artboards[0].nodes[0].skeleton.pathConstraints, []);
  await page.keyboard.press('Control+z');
  assert.deepEqual(await save(), ordered);
  writeFileSync('packages/editor/.smoke/path-follow.bbbproj', JSON.stringify(ordered, null, 2));
  await open(ordered, 'reopened-path.bbbproj');
  assert.deepEqual(await save(), ordered);
  await page.getByRole('button', { name: 'Export Spine JSON', exact: true }).click();
  await page
    .locator('footer')
    .getByText(/Spine export failed:.*Native paths/)
    .waitFor();
  assert.deepEqual(await save(), ordered);
  const broken = structuredClone(ordered);
  broken.artboards[0].nodes[0].skeleton.paths[0].boneId = 'tail';
  await page
    .locator('input[type=file]')
    .setInputFiles({
      name: 'invalid-path.bbbproj',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(broken)),
    });
  await page
    .locator('footer')
    .getByText(/Open failed:.*outside its controlled subtree/)
    .waitFor();
  assert.deepEqual(await save(), ordered);
  await select('Tail');
  await page.getByText(`Edit curve: ${p.name}`, { exact: true }).click();
  await page.getByText('Segment 1', { exact: true }).click();
  await page.screenshot({ path: 'packages/editor/.smoke/path-follow.png' });
  assert.deepEqual(errors, []);
  console.log(
    '[path-follow] spline/chain creation, progress/spacing, curve/continuity/closure, explicit keys, shared order, exact history, Setup isolation and Save/Open passed.',
  );
} finally {
  await browser.close();
}
