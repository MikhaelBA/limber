import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { renderGoldenFixture } from '../../../tools/render-golden-fixture.mjs';

const browser = await chromium.launch({ headless: true });
mkdirSync('packages/editor/.smoke', { recursive: true });
try {
  const page = await browser.newPage(),
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(new URL('tests/native-web.html', process.env.SPRINE_URL ?? 'http://127.0.0.1:5173/').href);
  const result = await page.evaluate(async (source) => {
    const { core, runtime, web, pixi, compileNativeProject } = await import('/tests/native-web-host.ts');
    const exported = await compileNativeProject(core.deserializeProject(JSON.stringify(source))),
      asset = new runtime.NativeRuntimeAsset(runtime.loadRuntime(new Uint8Array(exported.runtime.bytes))),
      assets = await web.NativeWebAssets.load(asset),
      player = new runtime.NativeArtboardPlayer(asset),
      view = new web.NativeWebRenderer(player, assets),
      app = new pixi.Application();
    await app.init({ width: 400, height: 300, backgroundAlpha: 0, autoStart: false, preference: 'webgl' });
    document.body.appendChild(app.canvas);
    view.world.position.set(200, 150);
    app.stage.addChild(view.world);
    try {
      app.render();
      const gl = app.renderer.gl,
        originals = new Map(
          [
            'drawElements',
            'drawArrays',
            'drawElementsInstanced',
            'drawArraysInstanced',
            'drawRangeElements',
          ].map((key) => [key, gl[key]]),
        ),
        before = app.renderer.extract.pixels({
          target: app.stage,
          frame: new pixi.Rectangle(0, 0, 400, 300),
          resolution: 1,
        }).pixels,
        frames = new runtime.RuntimeFrameProfiler(8),
        profiler = new web.NativeWebFrameProfiler(view, frames);
      player.play();
      for (let i = 0; i < 16; i++) profiler.run(1 / 60, () => app.render(), gl);
      const captured = frames.inspect(),
        work = runtime.inspectRuntimeFrame(player),
        snapshot = JSON.stringify(player.snapshot());
      const pixels = app.renderer.extract.pixels({
        target: app.stage,
        frame: new pixi.Rectangle(0, 0, 400, 300),
        resolution: 1,
      }).pixels;
      // Independent observer around one real submission verifies core API call counts.
      let observed = 0;
      const restore = [];
      for (const [key, fn] of originals) {
        if (typeof fn !== 'function') continue;
        const descriptor = Object.getOwnPropertyDescriptor(gl, key);
        Object.defineProperty(gl, key, {
          configurable: true,
          writable: true,
          value: function (...args) {
            observed++;
            return Reflect.apply(fn, gl, args);
          },
        });
        restore.push(() => {
          if (descriptor) Object.defineProperty(gl, key, descriptor);
          else delete gl[key];
        });
      }
      try {
        app.render();
      } finally {
        for (const undo of restore.reverse()) undo();
      }
      const descriptorsRestored = [...originals].every(([key, method]) => gl[key] === method);
      const beforeFailure = frames.inspect();
      let failure = '';
      try {
        profiler.run(
          0,
          () => {
            app.render();
            throw new Error('submission failed');
          },
          gl,
        );
      } catch (error) {
        failure = error.message;
      }
      const unchangedAfterFailure = JSON.stringify(beforeFailure) === JSON.stringify(frames.inspect());
      const contextRestored = [...originals].every(([key, method]) => gl[key] === method);
      const rig = player.getRig(player.getRigIds()[0]);
      for (let i = 0; i < rig.skeleton.data.slots.length; i++) {
        const slot = rig.skeleton.data.slots[i],
          selected = rig.skeleton.pose.slots[i].attachmentId,
          attachment = selected && rig.skeleton.attachmentById.get(selected);
        if (attachment?.type === 'clipping') rig.setAttachment(slot.id, null);
      }
      const noMasks = profiler.run(0, () => app.render(), gl);
      const noClipWork = runtime.inspectRuntimeFrame(player);
      const unknown = profiler.run(0, () => app.render());
      return {
        captured,
        work,
        noClipWork,
        observed,
        noMaskCalls: noMasks.drawCalls,
        unknown: unknown.drawCalls,
        pixelsUnchanged: before.every((value, i) => value === pixels[i]),
        readDidNotAdvance: snapshot === JSON.stringify({ ...player.snapshot() }),
        descriptorsRestored,
        failure,
        unchangedAfterFailure,
        contextRestored,
        driver: gl.getParameter(gl.RENDERER),
      };
    } finally {
      view.destroy();
      app.destroy(true);
      assets.dispose();
    }
  }, renderGoldenFixture());
  assert.equal(result.captured.samples, 8);
  assert.equal(result.captured.totalRecorded, 16);
  assert.equal(result.captured.acceptedTicks, 16);
  assert.equal(result.captured.drawCallSamples, 8);
  assert(result.captured.updateMs.min >= 0 && result.captured.renderSubmitMs.min >= 0);
  assert.equal(result.captured.drawCalls.p95, result.observed);
  assert(result.observed > result.noMaskCalls, 'real mask passes must contribute draw submissions');
  assert(result.work.clippingVertices > 0);
  assert.equal(result.noClipWork.clippingVertices, 0);
  assert.equal(result.unknown, null);
  assert(
    result.pixelsUnchanged &&
      result.readDidNotAdvance &&
      result.descriptorsRestored &&
      result.contextRestored &&
      result.unchangedAfterFailure,
  );
  assert.equal(result.failure, 'submission failed');
  assert.deepEqual(errors, []);
  writeFileSync('packages/editor/.smoke/native-profiler.json', JSON.stringify(result, null, 2));
  console.log(
    'PASS: actual native update/render CPU samples, bounded window, independent WebGL draw counts including stencil masks, unchanged golden pixels, unknown backend and failure restoration.',
  );
} finally {
  await browser.close();
}
