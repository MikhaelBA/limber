import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { CURRENT_SOURCE_SCHEMA } from '../../../tools/project-schema.mjs';
const fixture = JSON.parse(readFileSync('fixtures/bbbproj-v1-demo.json', 'utf8')),
  rig = fixture.artboards[0].nodes[0],
  identity = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 };
rig.skeleton = {
  bones: [
    { id: 'body', name: 'Body', parentId: null, length: 10, setupPose: { ...identity, x: 100, y: 100 } },
    { id: 'tail', name: 'Tail', parentId: 'body', length: 50, setupPose: { ...identity, x: 20 } },
    { id: 'tip', name: 'Tip', parentId: 'tail', length: 30, setupPose: { ...identity, x: 50 } },
    { id: 'other', name: 'Other', parentId: null, length: 20, setupPose: { ...identity, x: 30, y: 30 } },
  ],
  slots: [],
  attachments: [],
  ikConstraints: [],
  skins: [],
  activeSkin: '',
  markers: ['body', 'tail', 'tip'].map((id) => ({
    id,
    name: id,
    kind: 'point',
    boneId: id,
    transform: { ...identity },
  })),
};
rig.animations = [
  {
    name: 'Turn',
    duration: 2,
    loop: true,
    timelines: [
      {
        kind: 'boneProperty',
        boneId: 'body',
        property: 'rotation',
        keyframes: [
          { time: 0, value: 0, curve: { type: 'linear' } },
          { time: 1, value: 1, curve: { type: 'linear' } },
          { time: 2, value: 0, curve: { type: 'linear' } },
        ],
      },
    ],
  },
];
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
  await open(fixture, 'secondary.bbbproj');
  await select('Tail');
  const before = await save();
  await page.getByRole('button', { name: 'Add secondary motion', exact: true }).click();
  await page
    .locator('footer')
    .getByText(/Secondary motion added/)
    .waitFor();
  const created = await save(),
    c = created.artboards[0].nodes[0].skeleton.secondaryConstraints[0];
  assert.equal(created.schemaVersion, CURRENT_SOURCE_SCHEMA);
  assert.equal(c.preset, 'soft');
  assert.equal(c.frequency, 2);
  assert.equal(c.damping, 0.7);
  await page.keyboard.press('Control+z');
  assert.deepEqual(await save(), before);
  await page.keyboard.press('Control+y');
  assert.deepEqual(await save(), created);
  await page.getByLabel('Secondary motion preset', { exact: true }).selectOption('bouncy');
  await field('Secondary strength', 0.5);
  await field('Maximum sway °', 65);
  await page.getByText('Advanced secondary motion', { exact: true }).click();
  await field('Secondary frequency Hz', 4);
  const tuned = await save();
  assert.equal(tuned.artboards[0].nodes[0].skeleton.secondaryConstraints[0].frequency, 4);
  await field('Secondary frequency Hz', 0);
  await page
    .locator('footer')
    .getByText(/frequency must be/)
    .waitFor();
  assert.deepEqual(await save(), tuned);
  await select('Other');
  await page.getByText('Advanced creation', { exact: true }).click();
  await page.getByRole('button', { name: '＋ Add IK', exact: true }).click();
  await page
    .locator('footer')
    .getByText(/IK created/)
    .waitFor();
  const ordered = await save();
  assert.equal(ordered.artboards[0].nodes[0].skeleton.ikConstraints[0].order, 0);
  assert.equal(ordered.artboards[0].nodes[0].skeleton.secondaryConstraints[0].order, 1);
  await select('Tip');
  await page.getByRole('button', { name: 'Add secondary motion', exact: true }).click();
  await page
    .locator('footer')
    .getByText(/Secondary motion added/)
    .waitFor();
  const both = await save();
  assert.deepEqual(
    both.artboards[0].nodes[0].skeleton.secondaryConstraints.map((c) => c.boneId),
    ['tail', 'tip'],
  );
  await page.getByText('Advanced secondary motion', { exact: true }).click();
  await page.getByTitle('Move secondary earlier', { exact: true }).click();
  await page
    .locator('footer')
    .getByText(/parent motion must run before/)
    .waitFor();
  assert.deepEqual(await save(), both);
  await page.getByRole('button', { name: 'Animate', exact: true }).click();
  assert.equal(await page.getByLabel('Secondary strength', { exact: true }).isDisabled(), true);
  await page.getByTitle('Play/Pause (Space)', { exact: true }).click();
  await page.waitForFunction(() => {
    const body = window.__markers?.find((m) => m.id === 'body')?.world,
      tail = window.__markers?.find((m) => m.id === 'tail')?.world;
    if (!body || !tail) return false;
    const b = Math.atan2(body[1], body[0]),
      t = Math.atan2(tail[1], tail[0]);
    return b > 0.4 && b < 0.9 && b - t > 0.004;
  });
  await page.getByTitle('Play/Pause (Space)', { exact: true }).click();
  await page.waitForFunction(() => {
    const a = window.__markers.find((m) => m.id === 'body').world,
      b = window.__markers.find((m) => m.id === 'tail').world;
    return Math.abs(Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0])) < 0.000001;
  });
  assert.deepEqual(await save(), both);
  const ruler = await page.locator('.sticky.cursor-ew-resize').boundingBox();
  assert.ok(ruler);
  await page.mouse.click(ruler.x + 50, ruler.y + 10);
  await page.waitForFunction(() => {
    const a = window.__markers.find((m) => m.id === 'tail').world;
    return Math.abs(Math.atan2(a[1], a[0]) - 0.5) < 0.000001;
  });
  await page.getByTitle('Stop (back to 0)', { exact: true }).click();
  await page.waitForFunction(() => {
    const a = window.__markers.find((m) => m.id === 'tail').world;
    return Math.abs(Math.atan2(a[1], a[0])) < 0.000001;
  });
  await page.getByRole('button', { name: 'Setup', exact: true }).click();
  await select('Tail');
  await page.getByText('Advanced secondary motion', { exact: true }).click();
  await page.getByTitle('Delete secondary motion', { exact: true }).click();
  assert.equal((await save()).artboards[0].nodes[0].skeleton.secondaryConstraints.length, 1);
  await page.keyboard.press('Control+z');
  assert.deepEqual(await save(), both);
  writeFileSync('packages/editor/.smoke/secondary-motion.bbbproj', JSON.stringify(both, null, 2));
  await open(both, 'reopened-secondary.bbbproj');
  assert.deepEqual(await save(), both);
  await page.getByRole('button', { name: 'Export Spine JSON', exact: true }).click();
  await page
    .locator('footer')
    .getByText(/Spine export failed:.*Native secondary motion/)
    .waitFor();
  assert.deepEqual(await save(), both);
  const bad = structuredClone(both);
  bad.artboards[0].nodes[0].skeleton.secondaryConstraints[0].maxAngle = 4;
  await page
    .locator('input[type=file]')
    .setInputFiles({
      name: 'invalid-secondary.bbbproj',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(bad)),
    });
  await page
    .locator('footer')
    .getByText(/Open failed:.*maximum angle/)
    .waitFor();
  assert.deepEqual(await save(), both);
  await select('Tail');
  await page.getByText('Advanced secondary motion', { exact: true }).click();
  await page.screenshot({ path: 'packages/editor/.smoke/secondary-motion.png' });
  assert.deepEqual(errors, []);
  console.log(
    '[secondary-motion] presets/coefficients, primary insertion, hierarchy order, inertia playback, pause/scrub/stop, atomic history, Setup isolation and native Save/Open passed.',
  );
} finally {
  await browser.close();
}
