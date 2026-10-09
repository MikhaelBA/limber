import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
const out = 'packages/editor/.smoke';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: process.env.HEADLESS !== '0' });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(process.env.SPRINE_URL ?? 'http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__ticks > 2);
  const fixture = JSON.parse(
    readFileSync(new URL('../../../examples/fox-adventurer/Fox-Adventurer.bbbproj', import.meta.url), 'utf8'),
  );
  const rig = fixture.artboards[0].nodes[0];
  for (const [id, boneId] of [
    ['left-wrist', 'Hand L'],
    ['right-ankle', 'Foot R'],
  ])
    rig.skeleton.markers.push({
      id,
      name: id,
      kind: 'point',
      boneId,
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 },
    });
  const open = (value, name = 'fox-pins.bbbproj') =>
    page.locator('input[type=file]').setInputFiles({
      name,
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(value)),
    });
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
  await open(fixture);
  await page.getByText('Opened fox-pins.bbbproj — 2 embedded texture(s) restored', { exact: true }).waitFor();
  await page.waitForFunction(() => window.__markers?.some((m) => m.id === 'left-wrist'));
  const before = await save(),
    wrist = await marker('left-wrist'),
    ankle = await marker('right-ankle');
  await select('Hand L');
  await page.getByRole('button', { name: 'Pin Hand', exact: true }).click();
  await page
    .locator('footer')
    .getByText(/Pin Hand created/)
    .waitFor();
  const pinned = await save(),
    leftIK = pinned.artboards[0].nodes[0].skeleton.ikConstraints.at(-1);
  assert.deepEqual(leftIK.bones, ['Upper arm L', 'Forearm L']);
  const target = pinned.artboards[0].nodes[0].skeleton.bones.find((b) => b.id === leftIK.targetId);
  assert.equal(target.parentId, null);
  assert.equal(pinned.schemaVersion, 6);
  await page.keyboard.press('Control+z');
  assert.deepEqual(await save(), before);
  await page.keyboard.press('Control+y');
  assert.deepEqual(await save(), pinned);
  await select('Hand L');
  await page.getByRole('button', { name: 'Pin Hand', exact: true }).click();
  await page
    .locator('footer')
    .getByText(/already has IK/)
    .waitFor();
  assert.deepEqual(await save(), pinned);

  await select(target.name);
  await field('IK strength', 2);
  await page
    .locator('footer')
    .getByText(/strength must be finite/)
    .waitFor();
  assert.deepEqual(await save(), pinned);
  await field('IK strength', 0.55);
  assert.equal(
    (await save()).artboards[0].nodes[0].skeleton.ikConstraints.find((c) => c.id === leftIK.id).mix,
    0.55,
  );
  await page.keyboard.press('Control+z');
  assert.deepEqual(await save(), pinned);
  await page.getByText('Advanced IK', { exact: true }).click();
  await page.getByTitle('Move IK earlier', { exact: true }).click();
  const reordered = await save();
  assert.equal(reordered.artboards[0].nodes[0].skeleton.ikConstraints[0].id, leftIK.id);
  await page.keyboard.press('Control+z');
  assert.deepEqual(await save(), pinned);
  await page.keyboard.press('Control+y');
  assert.deepEqual(await save(), reordered);
  await page.keyboard.press('Control+z');

  await select('Foot R');
  await page.getByRole('button', { name: 'Pin Foot', exact: true }).click();
  await page
    .locator('footer')
    .getByText(/Pin Foot created/)
    .waitFor();
  const pins = await save();
  assert.equal(pins.artboards[0].nodes[0].skeleton.ikConstraints.length, 3);
  assert.equal(pins.artboards[0].nodes[0].skeleton.bones.length, 21);
  assert.deepEqual(pins.artboards[0].nodes[0].animations, before.artboards[0].nodes[0].animations);
  await select('Root');
  await field('X', 8);
  await field('Y', 8);
  await page.waitForFunction(
    ({ wrist, ankle }) => {
      const m = (id) => window.__markers.find((m) => m.id === id).world;
      return (
        Math.hypot(m('left-wrist')[4] - wrist[0], m('left-wrist')[5] - wrist[1]) < 0.001 &&
        Math.hypot(m('right-ankle')[4] - ankle[0], m('right-ankle')[5] - ankle[1]) < 0.001
      );
    },
    { wrist, ankle },
  );
  const authored = await save();
  writeFileSync(`${out}/fox-pinned.bbbproj`, JSON.stringify(authored, null, 2));
  await select(target.name);
  await page.screenshot({ path: `${out}/character-pins.png` });
  await page.getByRole('button', { name: 'Animate', exact: true }).click();
  assert.equal(await page.getByLabel('IK strength', { exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Pin Hand', exact: true }).isDisabled(), true);
  // Target drags/property edits still author ordinary keys in Animate.
  await field('Y', wrist[1] + 5);
  const animated = await save();
  assert.ok(
    animated.artboards[0].nodes[0].animations[0].timelines.some(
      (t) => t.kind === 'boneProperty' && t.boneId === leftIK.targetId,
    ),
  );
  await page.keyboard.press('Control+z');
  assert.deepEqual(await save(), authored);
  await page.getByRole('button', { name: 'Setup', exact: true }).click();
  await open(authored, 'reopened.bbbproj');
  await page
    .locator('footer')
    .getByText(/Opened reopened.bbbproj — 2 embedded/)
    .waitFor();
  assert.deepEqual(await save(), authored);
  for (const bad of ['feedback', 'order']) {
    const broken = structuredClone(authored);
    if (bad === 'feedback')
      broken.artboards[0].nodes[0].skeleton.ikConstraints.find((c) => c.id === leftIK.id).targetId = 'Hand L';
    else
      broken.artboards[0].nodes[0].skeleton.ikConstraints[1].order =
        broken.artboards[0].nodes[0].skeleton.ikConstraints[0].order;
    await open(broken, 'invalid.bbbproj');
    await page
      .locator('footer')
      .getByText(/Open failed:.*(feedback cycle|unique nonnegative)/)
      .waitFor();
    assert.deepEqual(
      await save(),
      authored,
      'Failed open must preserve the live rig, textures and constraints',
    );
  }
  assert.deepEqual(errors, []);
  console.log(
    '[character-pins] hand/foot pins, body independence, atomic failure, order, undo/redo, keys and Save/Open passed.',
  );
} finally {
  await browser.close();
}
