import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { constraintFixture } from '../../../tools/constraint-fixtures.mjs';
const percentile = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length * 0.95)];
mkdirSync('packages/editor/.smoke', { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } }),
    errors = [];
  page.setDefaultTimeout(60000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(process.env.SPRINE_URL ?? 'http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__ticks > 2);
  const environment = await page.evaluate(() => {
    const gl = document.querySelector('canvas')?.getContext('webgl2');
    const extension = gl?.getExtension('WEBGL_debug_renderer_info');
    return {
      userAgent: navigator.userAgent,
      renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'unavailable',
    };
  });
  const save = async () => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    return JSON.parse(readFileSync(await (await pending).path(), 'utf8'));
  };
  const results = [];
  for (const kind of ['Standard', 'Heavy']) {
    const project = constraintFixture(kind),
      data = project.artboards[0].nodes[0].skeleton;
    await page.locator('input[type=file]').setInputFiles({
      name: `combined-${kind}.bbbproj`,
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(project)),
    });
    await page
      .locator('footer')
      .getByText(new RegExp(`Opened combined-${kind}.bbbproj`))
      .waitFor();
    await page.getByRole('button', { name: 'Animate', exact: true }).click();
    await page.getByTitle('Play/Pause (Space)', { exact: true }).click();
    await page.waitForTimeout(750);
    await page.evaluate(() => {
      window.__rigFrameMetrics = { limit: 190, frames: [] };
    });
    await page.waitForFunction(() => window.__rigFrameMetrics.frames.length >= 190);
    const frames = (await page.evaluate(() => window.__rigFrameMetrics.frames)).slice(10);
    await page.getByTitle('Play/Pause (Space)', { exact: true }).click();
    const cpuP95Ms = percentile(frames.map((f) => f.cpuMs));
    assert.ok(cpuP95Ms < 16.7, `${kind} combined constraint CPU p95 ${cpuP95Ms.toFixed(2)}ms exceeds budget`);
    for (const f of frames) {
      assert.equal(f.vertexTransforms, kind === 'Standard' ? 10000 : 40004);
      assert.equal(f.vertices, kind === 'Standard' ? 2500 : 10004);
    }
    assert.deepEqual(await save(), project, 'all constraint stages leave authored source unchanged');
    const markers = await page.evaluate(() => window.__markers);
    assert.equal(markers.length, 3);
    assert.ok(markers.every((m) => m.world.every(Number.isFinite)));
    const gaps = frames.slice(1).map((f, n) => f.timestamp - frames[n].timestamp);
    results.push({
      kind,
      bones: data.bones.length,
      ik: data.ikConstraints.length,
      transform: data.transformConstraints.length,
      path: data.pathConstraints.length,
      secondary: data.secondaryConstraints.length,
      coreP95Ms: percentile(frames.map((f) => f.coreMs)),
      cpuP95Ms,
      cpuMaxMs: Math.max(...frames.map((f) => f.cpuMs)),
      frameGapP95Ms: percentile(gaps),
      weightedTransforms: frames[0].vertexTransforms,
    });
    await page.getByRole('button', { name: 'Setup', exact: true }).click();
    writeFileSync(
      `packages/editor/.smoke/constraints-${kind.toLowerCase()}.bbbproj`,
      JSON.stringify(project, null, 2),
    );
    await page.screenshot({ path: `packages/editor/.smoke/constraints-${kind.toLowerCase()}.png` });
  }
  assert.deepEqual(errors, []);
  writeFileSync(
    'packages/editor/.smoke/constraint-performance.json',
    JSON.stringify({ environment, results }, null, 2),
  );
  console.log(
    'PASS: combined IK/affine follow/closed path/secondary playback, weighted/deform/clipping source preservation and CPU gate',
    JSON.stringify(results),
  );
} finally {
  await browser.close();
}
