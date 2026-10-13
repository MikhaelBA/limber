import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const scratch = resolve('packages/editor/.smoke/deform');
mkdirSync(scratch, { recursive: true });
await build({
  entryPoints: ['packages/editor/src/engine/EditorEngine.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: resolve(scratch, 'engine.mjs'),
  alias: {
    '@limber/core': resolve('packages/core/src/index.ts'),
    '@limber/mesh': resolve('packages/mesh/src/index.ts'),
  },
});
const { EditorEngine } = await import(pathToFileURL(resolve(scratch, 'engine.mjs')));
const source = JSON.parse(readFileSync('examples/face-performance/Face-Performance.bbbproj'));
const reference = new EditorEngine();
reference.loadProject(structuredClone(source));
reference.mode = 'animate';
reference.setAnimation('Laughing');
reference.scrub(1.4);
reference.tick(0);
const geometry = reference.skeleton.pose.attachments.get('Eye R Closed').verts;
const vertex = [geometry[34], geometry[35]];
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(process.env.SPRINE_URL ?? 'http://127.0.0.1:5183/');
  await page.waitForFunction(() => window.__ticks > 2);
  await page
    .locator('input[type=file]')
    .setInputFiles({
      name: 'deform-face.bbbproj',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(source)),
    });
  await page
    .locator('footer')
    .getByText(/Opened deform-face.bbbproj/)
    .waitFor();
  await page.getByRole('button', { name: 'Animate', exact: true }).click();
  await page
    .locator('select')
    .filter({ has: page.locator('option', { hasText: /^Laughing$/ }) })
    .selectOption('Laughing');
  await page
    .locator('.cursor-ew-resize')
    .first()
    .click({ position: { x: 140, y: 12 } });
  await page.getByRole('button', { name: 'Bones', exact: true }).click();
  const screen = (x, y) => page.evaluate(([x, y]) => window.__worldToScreen(x, y), [x, y]);
  const save = async () => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    return JSON.parse(readFileSync(await (await pending).path(), 'utf8'));
  };
  const select = () =>
    page
      .locator('span', { hasText: /^Eye R — lids@head$/ })
      .first()
      .click();
  const clean = async () => {
    await page.keyboard.press('v');
    await page.mouse.click(...(await screen(-250, 100)));
  };
  const canvas = page.locator('canvas');
  const image = () => canvas.screenshot();
  await clean();
  const beforePixels = await image();
  const original = await save();
  await select();
  await page.keyboard.press('m');
  assert.equal(await page.getByText(/Deform · drag a blue vertex/).count(), 1);
  // Clicking and tiny jitter select a point without manufacturing a Deform key.
  await page.mouse.click(...(await screen(...vertex)));
  assert.deepEqual(await save(), original);
  await page.mouse.move(...(await screen(...vertex)));
  await page.mouse.down();
  const down = await screen(...vertex);
  await page.mouse.move(down[0] + 1, down[1] + 1);
  await page.mouse.up();
  assert.deepEqual(await save(), original, 'click jitter does not change source');
  const begin = async () => {
    await page.mouse.move(...(await screen(vertex[0] + 2, vertex[1])));
    await page.mouse.down();
  };
  const move = async () => page.mouse.move(...(await screen(vertex[0] + 14, vertex[1] - 8)), { steps: 8 });
  await begin();
  await move();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.deepEqual(await save(), original, 'Escape rolls back a live Deform');
  await begin();
  await move();
  await canvas.dispatchEvent('pointercancel', { pointerId: 1 });
  await page.mouse.up();
  assert.deepEqual(await save(), original, 'pointer cancellation rolls back');
  await begin();
  await move();
  await page.mouse.up();
  const changed = await save();
  const changedRig = changed.artboards[0].nodes[0];
  assert.deepEqual(
    changedRig.skeleton,
    source.artboards[0].nodes[0].skeleton,
    'Deform leaves Setup and weights unchanged',
  );
  const tracks = changedRig.animations
    .find((a) => a.name === 'Laughing')
    .timelines.filter((t) => t.kind === 'deform');
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].attachmentId, 'Eye R Closed');
  assert.equal(tracks[0].keyframes.length, 1);
  assert(Math.abs(tracks[0].keyframes[0].time - 1.4) < 1e-6);
  reference.loadProject(structuredClone(changed));
  reference.mode = 'animate';
  reference.setAnimation('Laughing');
  reference.scrub(1.4);
  reference.tick(0);
  const moved = reference.skeleton.pose.attachments.get('Eye R Closed').verts;
  assert(
    Math.abs(moved[34] - vertex[0] - 12) < 0.001 && Math.abs(moved[35] - vertex[1] + 8) < 0.001,
    'weighted vertex preserves grab offset',
  );
  await clean();
  const afterPixels = await image();
  const difference = await page.evaluate(
    async ({ before, after }) => {
      const decode = async (data) => {
        const i = new Image();
        i.src = 'data:image/png;base64,' + data;
        await i.decode();
        const c = document.createElement('canvas');
        c.width = i.width;
        c.height = i.height;
        const x = c.getContext('2d');
        x.drawImage(i, 0, 0);
        return x.getImageData(0, 0, c.width, c.height).data;
      };
      const a = await decode(before),
        b = await decode(after);
      let count = 0;
      for (let i = 0; i < a.length; i += 4)
        if (Math.max(...[0, 1, 2].map((k) => Math.abs(a[i + k] - b[i + k]))) > 12) count++;
      return count;
    },
    { before: beforePixels.toString('base64'), after: afterPixels.toString('base64') },
  );
  assert(difference > 40, `actual artwork must change without wireframe/selection guides: ${difference}`);
  await canvas.screenshot({ path: resolve(scratch, 'face-deformed.png') });
  await page.keyboard.press('Control+z');
  assert.deepEqual(await save(), original);
  await page.keyboard.press('Control+y');
  assert.deepEqual(await save(), changed);
  await page.keyboard.press('Control+z');
  // Beginning an edit during playback freezes the clip and produces one time key.
  await select();
  await page.keyboard.press('m');
  await page.getByTitle('Play/Pause (Space)', { exact: true }).click();
  await begin();
  assert.equal(await page.getByTitle('Play/Pause (Space)', { exact: true }).innerText(), '▶');
  await page.waitForTimeout(350);
  await move();
  await page.mouse.up();
  const paused = await save();
  const pauseTrack = paused.artboards[0].nodes[0].animations
    .find((a) => a.name === 'Laughing')
    .timelines.filter((t) => t.kind === 'deform');
  assert.equal(pauseTrack.length, 1);
  assert.equal(pauseTrack[0].keyframes.length, 1);
  assert.deepEqual(errors, []);
  console.log(
    `PASS: practical weighted-eye artwork (${difference} clean pixels), Deform grab offset, pause/single-time key, click/jitter, Escape/pointer cancel and exact history.`,
  );
} finally {
  await browser.close();
}
