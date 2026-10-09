import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { playbackFixture } from '../../../tools/mesh-fixtures.mjs';
import { installHeldWorkers } from '../../../tools/held-worker-harness.mjs';

const percentile = (values, fraction = 0.95) => [...values].sort((a,b) => a-b)[Math.min(values.length-1, Math.floor(values.length * fraction))];
const browser = await chromium.launch({ headless: process.env.HEADLESS !== '0' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } }); page.setDefaultTimeout(60000);
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(installHeldWorkers); await page.goto(process.env.SPRINE_URL ?? 'http://localhost:5173/');
  await page.waitForFunction(() => window.__ticks > 2);
  const open = async (project, name) => {
    await page.locator('input[type=file]').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
    await page.locator('footer').getByText(new RegExp(`Opened ${name}`)).waitFor();
  };
  const save = async () => { const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Save', exact: true }).click(); return JSON.parse(readFileSync(await (await pending).path(), 'utf8')); };
  const results = [];
  for (const kind of ['Standard', 'Heavy']) {
    const project = playbackFixture(kind), heavy = kind === 'Heavy';
    await open(project, `${kind}.bbbproj`);
    await page.getByText(/^bind test mesh/).first().click();
    await page.getByRole('button', { name: 'Animate', exact: true }).click();
    // Warm up shader/program caches and authoring panels before steady-state sampling.
    await page.locator('button[title="Play/Pause (Space)"]').click();
    await page.waitForTimeout(750);
    await page.evaluate(() => { window.__rigFrameMetrics = { limit: 190, frames: [] }; });
    await page.waitForFunction(() => window.__rigFrameMetrics.frames.length >= 190);
    const frames = (await page.evaluate(() => window.__rigFrameMetrics.frames)).slice(10);
    await page.locator('button[title="Play/Pause (Space)"]').click();
    assert.equal(frames.length, 180);
    for (const frame of frames) {
      assert.equal(frame.vertices, heavy ? 10004 : 2500);
      assert.equal(frame.vertexTransforms, heavy ? 40004 : 10000);
      assert.equal(frame.bindMatrixProducts, heavy ? 120 : 60);
      assert.equal(frame.maskedMeshes, heavy ? 1 : 0);
    }
    const cpuP95Ms = percentile(frames.map((frame) => frame.cpuMs));
    console.log(`[mesh-perf] ${kind} core p95 ${percentile(frames.map((frame) => frame.coreMs)).toFixed(2)}ms; CPU update/render-submit p95 ${cpuP95Ms.toFixed(2)}ms`);
    assert.ok(cpuP95Ms < 16.7, `${kind} update/render-submit CPU p95 ${cpuP95Ms.toFixed(2)}ms exceeds a 60Hz frame`);
    assert.deepEqual(await save(), project, 'playback leaves authored geometry/clips/bindings unchanged');
    const gaps = frames.slice(1).map((frame,index) => frame.timestamp - frames[index].timestamp);
    const metrics = { kind, bones: project.artboards[0].nodes[0].skeleton.bones.length,
      clips: project.artboards[0].nodes[0].animations.length,
      constraints: project.artboards[0].nodes[0].skeleton.ikConstraints.length,
      weightedVertices: heavy ? 10000 : 2500,
      transformsPerFrame: frames[0].vertexTransforms,
      coreP95Ms: percentile(frames.map((frame) => frame.coreMs)),
      viewportP95Ms: percentile(frames.map((frame) => frame.viewportMs)), cpuP95Ms,
      cpuMaxMs: Math.max(...frames.map((frame) => frame.cpuMs)),
      frameGapP95Ms: percentile(gaps), frameGapMaxMs: Math.max(...gaps) };
    await page.getByRole('button', { name: 'Setup', exact: true }).click();
    if (heavy) {
      // Measure the complete Heavy fixture, including clips, deform and clipping metadata.
      const before = await save();
      const builds = await page.evaluate(() => ({ geometry: window.__rigGeometryBuilds, ghost: window.__rigGhostBuilds }));
      await page.getByRole('button', { name: 'Auto weights', exact: true }).click();
      await page.getByRole('progressbar', { name: 'Auto weights progress' }).waitFor();
      await page.waitForFunction(() => window.__workerJobs.at(-1)?.computing && window.__workerJobs.at(-1).frames >= 2);
      // A real inspector interaction while the computation runs changes only the tool setting.
      await page.getByLabel('Maximum mesh influences', { exact: true }).fill('3');
      assert.equal(await page.getByLabel('Maximum mesh influences', { exact: true }).inputValue(), '3');
      await page.waitForFunction(() => window.__workerJobs.at(-1)?.result !== null);
      const worker = await page.evaluate(() => { const job = window.__workerJobs.at(-1); return { workerMs: job.result.durationMs, workerFrames: job.frames, workerFrameGapMaxMs: Math.max(0, ...job.gaps) }; });
      assert.ok(worker.workerFrames >= 2, 'Heavy computation must leave rendering active');
      const publicationMs = await page.evaluate(() => window.__releaseWeights());
      await page.locator('footer').getByText(/Auto weights applied/).waitFor();
      // The result publishes new influences, so existing GPU geometry and ghost caches survive.
      assert.deepEqual(await page.evaluate(() => ({ geometry: window.__rigGeometryBuilds, ghost: window.__rigGhostBuilds })), builds);
      const after = await save();
      assert.deepEqual(after.artboards[0].nodes[0].animations, before.artboards[0].nodes[0].animations);
      assert.deepEqual(after.artboards[0].nodes[0].skeleton.attachments[0].boneBindings, before.artboards[0].nodes[0].skeleton.attachments[0].boneBindings);
      await page.keyboard.press('Control+z'); assert.deepEqual(await save(), before);
      await page.keyboard.press('Control+y'); assert.deepEqual(await save(), after);
      await open(after, 'Heavy-weighted.bbbproj'); assert.deepEqual(await save(), after);
      Object.assign(metrics, worker, { publicationMs });
    }
    results.push(metrics);
    await page.screenshot({ path: `packages/editor/.smoke/mesh-${kind.toLowerCase()}-playback.png` });
  }
  const environment = await page.evaluate(() => {
    const canvas = document.querySelector('canvas'), gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
    const extension = gl?.getExtension('WEBGL_debug_renderer_info');
    return { userAgent: navigator.userAgent, renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'unavailable' };
  });
  assert.deepEqual(errors, []);
  writeFileSync('packages/editor/.smoke/mesh-performance.json', JSON.stringify({ environment, results }, null, 2));
  console.log('PASS: full Standard/Heavy authored playback, CPU frame gate, influence counters, clipping, source preservation and responsive Heavy worker workflow', JSON.stringify({ environment, results }));
} finally { await browser.close(); }
