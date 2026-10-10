import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { constraintFixture } from '../../../tools/constraint-fixtures.mjs';
const percentile = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length * 0.95)];
mkdirSync('packages/editor/.smoke', { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } }),
    errors = [];
  page.setDefaultTimeout(60000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(process.env.SPRINE_URL ?? 'http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__ticks > 2);
  const save = async () => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    return JSON.parse(readFileSync(await (await pending).path(), 'utf8'));
  };
  const results = [];
  let environment;
  for (const kind of ['Standard', 'Heavy']) {
    const project = constraintFixture(kind),
      rig = project.artboards[0].nodes[0];
    if (kind === 'Heavy')
      rig.skeleton.attachments.find((a) => a.type === 'clipping').meshVertices = [
        -20, -20, 240, -20, 240, 420, -20, 420,
      ];
    rig.logic = {
      id: 'logic',
      name: 'Combined Logic',
      enabled: true,
      entryStateId: 'idle',
      parameters: [{ id: 'open', name: 'open', type: 'trigger', initial: false }],
      states: [
        { id: 'idle', name: 'Idle', clip: null, loop: false },
        { id: 'active', name: 'Active', clip: rig.animations[0].name, loop: true },
      ],
      transitions: [
        {
          id: 'open-edge',
          from: 'idle',
          to: 'active',
          priority: 0,
          conditions: [{ parameterId: 'open', operator: 'fired' }],
          blendDuration: 0.2,
          interruption: 'none',
        },
      ],
      routes: [{ id: 'click', targetId: null, event: 'click', parameterId: 'open' }],
    };
    await page.locator('input[type=file][accept^=".bbbproj"]').setInputFiles({
      name: `logic-${kind}.bbbproj`,
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(project)),
    });
    await page.locator('footer').getByText(`Opened logic-${kind}.bbbproj`, { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Logic', exact: true }).click();
    await page.getByLabel('Logic owner', { exact: true }).selectOption(rig.id);
    await page.waitForFunction(() => window.__logicCapture?.().rigs.length === 1);
    const baseline = await page.evaluate(() => window.__logicCapture());
    const canvas = page.getByTestId('logic-preview').locator('canvas');
    if (!environment)
      environment = await canvas.evaluate((canvas) => {
        const gl = canvas.getContext('webgl2'),
          extension = gl?.getExtension('WEBGL_debug_renderer_info');
        return {
          userAgent: navigator.userAgent,
          renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'unavailable',
        };
      });
    const pixels = await page.evaluate(
      async ({ data, width, height }) => {
        const image = new Image();
        image.src = `data:image/png;base64,${data}`;
        await image.decode();
        const copy = document.createElement('canvas');
        copy.width = image.width;
        copy.height = image.height;
        const ctx = copy.getContext('2d');
        ctx.drawImage(image, 0, 0);
        const scale = Math.max(0.02, Math.min((copy.width - 40) / width, (copy.height - 40) / height));
        const sample = (x) =>
          Array.from(
            ctx.getImageData(
              Math.round(copy.width / 2 + x * scale),
              Math.round(copy.height / 2 + 200 * scale),
              1,
              1,
            ).data,
          ).slice(0, 3);
        return { inside: sample(120), outside: sample(360) };
      },
      {
        data: (await canvas.screenshot()).toString('base64'),
        width: project.artboards[0].width,
        height: project.artboards[0].height,
      },
    );
    assert.deepEqual(pixels.inside, [255, 255, 255], `${kind} mesh remains visible inside the clip`);
    assert.deepEqual(
      pixels.outside,
      kind === 'Heavy' ? [32, 36, 44] : [255, 255, 255],
      `${kind} actual pixels respect the authored clip boundary`,
    );
    await page.getByRole('button', { name: 'Send click to viewport', exact: true }).click();
    for (let i = 0; i < 12; i++) await page.getByRole('button', { name: 'Step Logic', exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector('[data-testid="logic-preview"]').dataset.tick === '12',
    );
    const parity = await page.evaluate(
      async ({ project, moduleUrl }) => {
        const { RigLogicPlayer } = await import(moduleUrl),
          source = project.artboards[0].nodes[0],
          stepped = new RigLogicPlayer(source),
          continuous = new RigLogicPlayer(source);
        stepped.pause();
        continuous.pause();
        stepped.dispatch('click');
        continuous.dispatch('click');
        continuous.play();
        for (let i = 0; i < 12; i++) {
          stepped.step();
          continuous.update(1 / 120);
        }
        const capture = window.__logicCapture();
        return {
          actual: capture,
          expected: {
            snapshot: stepped.snapshot(),
            matrices: Array.from(stepped.getWorldTransforms()),
            vertices: Object.fromEntries(
              [...stepped.skeleton.pose.attachments].map(([id, s]) => [id, Array.from(s.verts)]),
            ),
          },
          continuous: {
            snapshot: continuous.snapshot(),
            matrices: Array.from(continuous.getWorldTransforms()),
          },
        };
      },
      { project, moduleUrl: `/@fs/${resolve('packages/core/src/index.ts').replaceAll('\\', '/')}` },
    );
    assert.deepEqual(parity.actual.snapshot, parity.expected.snapshot);
    assert.deepEqual(parity.actual.rigs[0].matrices, parity.expected.matrices);
    assert.deepEqual(parity.continuous.snapshot, parity.expected.snapshot);
    assert.deepEqual(parity.continuous.matrices, parity.expected.matrices);
    for (const mesh of parity.actual.rigs[0].meshes) {
      assert.deepEqual(mesh.positions, parity.expected.vertices[mesh.attachmentId]);
      assert.equal(mesh.masked, kind === 'Heavy');
    }
    assert.equal(parity.actual.rebuilds, baseline.rebuilds);
    assert.equal(parity.actual.rigs[0].geometryCount, baseline.rigs[0].geometryCount);
    await page.getByRole('button', { name: 'Play Logic', exact: true }).click();
    await page.waitForTimeout(750);
    await page.evaluate(() => {
      window.__logicFrameMetrics = { limit: 190, frames: [] };
    });
    await page.waitForFunction(() => window.__logicFrameMetrics.frames.length >= 190);
    const frames = (await page.evaluate(() => window.__logicFrameMetrics.frames)).slice(10);
    await page.getByRole('button', { name: 'Pause Logic', exact: true }).click();
    const cpuP95Ms = percentile(frames.map((f) => f.cpuMs));
    assert.ok(frames.every((f) => f.acceptedTicks > 0 && f.acceptedTicks <= 12));
    assert.ok(cpuP95Ms < 16.7, `${kind} Logic CPU p95 ${cpuP95Ms.toFixed(2)}ms exceeds budget`);
    const final = await page.evaluate(() => window.__logicCapture());
    assert.equal(final.rebuilds, baseline.rebuilds);
    assert.equal(final.rigs[0].geometryCount, baseline.rigs[0].geometryCount);
    await page.getByLabel('Test Logic enabled', { exact: true }).uncheck();
    await page.getByRole('button', { name: 'Step Logic', exact: true }).click();
    await page.waitForFunction(() => !window.__logicCapture().snapshot.enabled);
    const disabled = await page.evaluate(
      async ({ project, moduleUrl }) => {
        const { RigLogicPlayer } = await import(moduleUrl),
          p = new RigLogicPlayer(project.artboards[0].nodes[0]);
        p.setEnabled(false);
        return {
          actual: window.__logicCapture().rigs[0].matrices,
          expected: Array.from(p.getWorldTransforms()),
        };
      },
      { project, moduleUrl: `/@fs/${resolve('packages/core/src/index.ts').replaceAll('\\', '/')}` },
    );
    assert.deepEqual(disabled.actual, disabled.expected);
    assert.deepEqual(await save(), project);
    const gaps = frames.slice(1).map((f, n) => f.timestamp - frames[n].timestamp);
    results.push({
      kind,
      coreP95Ms: percentile(frames.map((f) => f.coreMs)),
      cpuP95Ms,
      cpuMaxMs: Math.max(...frames.map((f) => f.cpuMs)),
      frameGapP95Ms: percentile(gaps),
      bones: rig.skeleton.bones.length,
      geometryCount: final.rigs[0].geometryCount,
      vertices: final.rigs[0].meshes.reduce((n, m) => n + m.positions.length / 2, 0),
      clipping: kind === 'Heavy',
      acceptedTicksP95: percentile(frames.map((f) => f.acceptedTicks)),
      pixelEvidence: pixels,
    });
    writeFileSync(
      `packages/editor/.smoke/logic-${kind.toLowerCase()}.bbbproj`,
      JSON.stringify(project, null, 2),
    );
    await page.screenshot({ path: `packages/editor/.smoke/logic-${kind.toLowerCase()}.png` });
  }
  assert.deepEqual(errors, []);
  writeFileSync(
    'packages/editor/.smoke/logic-performance.json',
    JSON.stringify({ environment, results }, null, 2),
  );
  console.log(
    'PASS: Standard/Heavy actual Logic-renderer step/continuous parity, cached geometry, clipping, disable/source isolation and CPU gate',
    JSON.stringify(results),
  );
} finally {
  await browser.close();
}
