import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: process.env.HEADLESS !== '0' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(process.env.SPRINE_URL ?? 'http://localhost:5173/');
  await page.waitForFunction(() => window.__ticks > 2);
  const fixture = readFileSync('fixtures/scene-standard-v1.json');
  const original = JSON.parse(fixture);
  await page
    .locator('input[accept=".bbbproj,.json,application/json"]')
    .setInputFiles({ name: 'standard.bbbproj', mimeType: 'application/json', buffer: fixture });
  await page.getByText(/Opened standard.bbbproj/).waitFor();
  const canvas = page.getByTestId('scene-viewport').locator('canvas');
  await canvas.waitFor();
  await page.getByRole('button', { name: 'Fit artboard', exact: true }).click();
  const bounds = await canvas.boundingBox(),
    scale = Math.min((bounds.width - 80) / 700, (bounds.height - 80) / 500);
  const point = (x, y) => ({
    x: bounds.x + bounds.width / 2 + x * scale,
    y: bounds.y + bounds.height / 2 + y * scale,
  });
  const golden = 'fixtures/scene-standard-v1.png';
  mkdirSync('packages/editor/.smoke', { recursive: true });
  const clip = { x: bounds.x, y: bounds.y + 50, width: bounds.width, height: bounds.height - 90 };
  const actual = await page.screenshot({ clip, path: 'packages/editor/.smoke/scene-standard-actual.png' });
  if (process.env.UPDATE_SCENE_GOLDEN === '1') await page.screenshot({ clip, path: golden });
  assert.ok(existsSync(golden), 'Reviewed golden screenshot must exist');
  const diff = await page.evaluate(
    async ({ a, b }) => {
      const decode = async (data) => {
        const image = new Image();
        image.src = 'data:image/png;base64,' + data;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0);
        return {
          width: image.width,
          height: image.height,
          data: ctx.getImageData(0, 0, image.width, image.height).data,
        };
      };
      const first = await decode(a),
        second = await decode(b);
      if (first.width !== second.width || first.height !== second.height) return 1;
      let changed = 0;
      for (let i = 0; i < first.data.length; i += 4)
        if (Math.max(...[0, 1, 2].map((k) => Math.abs(first.data[i + k] - second.data[i + k]))) > 12)
          changed++;
      return changed / (first.width * first.height);
    },
    { a: actual.toString('base64'), b: readFileSync(golden).toString('base64') },
  );
  assert.ok(diff < 0.015, `Scene screenshot mismatch ${(diff * 100).toFixed(3)}%`);
  const select = async (i, shift = false) => {
    const n = original.artboards[0].nodes[i],
      p = point(n.transform.x, n.transform.y);
    if (shift) await page.keyboard.down('Shift');
    await page.mouse.click(p.x, p.y);
    if (shift) await page.keyboard.up('Shift');
  };
  const save = async () => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    return JSON.parse(readFileSync(await (await pending).path(), 'utf8'));
  };
  const scene = page.getByRole('region', { name: 'Scene workspace' }),
    surface = page.getByTestId('scene-canvas');
  await select(44);
  await select(45, true);
  const first = original.artboards[0].nodes[44],
    second = original.artboards[0].nodes[45],
    start = point(first.transform.x, first.transform.y);
  const beforeRebuilds = Number(await surface.getAttribute('data-rebuilds'));
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let i = 1; i <= 120; i++)
    await page.mouse.move(start.x + (i * scale) / 2, start.y + (40 * scale * i) / 120);
  assert.equal(
    Number(await surface.getAttribute('data-rebuilds')),
    beforeRebuilds,
    'Drag must reuse geometry',
  );
  const p95 = Number(await surface.getAttribute('data-p95-ms'));
  assert.ok(p95 < 16.7, `100-image CPU update/render-submit p95 ${p95}ms exceeds 60fps budget`);
  await page.mouse.up();
  let saved = await save();
  for (const n of [first, second]) {
    const moved = saved.artboards[0].nodes.find((v) => v.id === n.id);
    assert.ok(Math.abs(moved.transform.x - n.transform.x - 60) < 0.01);
    assert.ok(Math.abs(moved.transform.y - n.transform.y - 40) < 0.01);
  }
  await scene.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(
    (await save()).artboards,
    original.artboards,
    'One undo reverses the whole multi-selection drag',
  );
  await scene.getByRole('button', { name: 'Redo', exact: true }).click();
  assert.deepEqual((await save()).artboards, saved.artboards);
  await scene.getByRole('button', { name: 'Undo', exact: true }).click();
  await select(44);
  await page.getByRole('button', { name: 'Scene rotate', exact: true }).click();
  const pivot = point(first.transform.x, first.transform.y);
  await page.mouse.move(pivot.x + 45, pivot.y);
  await page.mouse.down();
  await page.mouse.move(pivot.x, pivot.y + 45, { steps: 20 });
  await page.mouse.up();
  saved = await save();
  assert.ok(Math.abs(saved.artboards[0].nodes[44].transform.rotation - Math.PI / 2) < 0.01);
  await scene.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('button', { name: 'Scene scale', exact: true }).click();
  await page.mouse.move(pivot.x + 20, pivot.y + 10);
  await page.mouse.down();
  await page.mouse.move(pivot.x + 40, pivot.y + 20, { steps: 20 });
  await page.mouse.up();
  saved = await save();
  assert.ok(Math.abs(saved.artboards[0].nodes[44].transform.scaleX - 2) < 0.01);
  await scene.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('button', { name: 'Scene pivot', exact: true }).click();
  await page.mouse.move(pivot.x, pivot.y);
  await page.mouse.down();
  await page.mouse.move(pivot.x + 10 * scale, pivot.y + 5 * scale, { steps: 10 });
  await page.mouse.up();
  saved = await save();
  const t = saved.artboards[0].nodes[44].transform;
  assert.ok(Math.abs(t.pivotX - 10) < 0.01);
  assert.ok(Math.abs(t.x - t.pivotX - first.transform.x) < 0.01, 'Pivot editing retains the rendered pose');
  await scene.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('button', { name: 'Scene move', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Snap', exact: true }).check();
  await page.mouse.move(pivot.x, pivot.y);
  await page.mouse.down();
  await page.mouse.move(pivot.x + 17 * scale, pivot.y + 13 * scale, { steps: 10 });
  await page.mouse.up();
  saved = await save();
  assert.ok(Math.abs(saved.artboards[0].nodes[44].transform.x - first.transform.x - 20) < 0.01);
  assert.ok(Math.abs(saved.artboards[0].nodes[44].transform.y - first.transform.y - 10) < 0.01);
  await scene.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Snap', exact: true }).uncheck();
  await page.mouse.move(pivot.x, pivot.y);
  await page.mouse.down();
  await page.mouse.move(pivot.x + 80, pivot.y + 40, { steps: 10 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.deepEqual(
    (await save()).artboards,
    original.artboards,
    'Escape cancels preview without changing source',
  );
  await page.mouse.move(pivot.x, pivot.y);
  await page.mouse.wheel(0, -300);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(pivot.x + 50, pivot.y + 20, { steps: 10 });
  await page.mouse.up({ button: 'middle' });
  await page.getByRole('button', { name: 'Frame selection', exact: true }).click();
  assert.deepEqual(
    (await save()).artboards,
    original.artboards,
    'Camera changes never edit authoring transforms',
  );
  assert.deepEqual(errors, []);
  console.log(
    `PASS: scene golden (${(diff * 100).toFixed(3)}%), move/rotate/scale/pivot, cancel, camera, multi-select single undo; 100-node CPU p95 ${p95.toFixed(2)}ms`,
  );
} finally {
  await browser.close();
}
