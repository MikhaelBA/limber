import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { renderGoldenFixture } from '../../../tools/render-golden-fixture.mjs';

const base = process.env.SPRINE_URL ?? 'http://127.0.0.1:5173/';
mkdirSync('packages/editor/.smoke', { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } }),
    errors = [];
  page.setDefaultTimeout(60000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(new URL('tests/native-web.html', base).href);
  await page.evaluate(async () => {
    window.nativeTest = { ...(await import('/tests/native-web-host.ts')) };
    // Independent source renderer owns its baseline face; native faces use private aliases.
    const face = await new FontFace('Noto Sans Arabic', 'url(/fonts/NotoSansArabic.ttf)').load();
    document.fonts.add(face);
  });

  const goldens = await page.evaluate(async (source) => {
    const { runtime, web, pixi } = window.nativeTest;
    const before = JSON.stringify(source),
      asset = new runtime.NativeRuntimeAsset(
        runtime.loadRuntime(runtime.encodeRuntime(runtime.compileRuntime(source).program)),
      );
    const assets = await web.NativeWebAssets.load(asset),
      player = new runtime.NativeArtboardPlayer(asset);
    const view = new web.NativeWebRenderer(player, assets),
      app = new pixi.Application();
    await app.init({
      width: 400,
      height: 300,
      resolution: 1,
      backgroundAlpha: 0,
      antialias: false,
      preference: 'webgl',
      autoStart: false,
    });
    document.querySelector('#stage').append(app.canvas);
    view.world.position.set(200, 150);
    app.stage.addChild(view.world);
    const pixels = () =>
      app.renderer.extract.pixels({
        target: app.stage,
        frame: new pixi.Rectangle(0, 0, 400, 300),
        clearColor: '#00000000',
      }).pixels;
    const sample = () => {
      app.render();
      const bytes = pixels(),
        pixel = (x, y) => [
          ...bytes.slice(((y + 150) * 400 + x + 200) * 4, ((y + 150) * 400 + x + 200) * 4 + 4),
        ];
      return {
        green: pixel(-40, 0),
        clipped: pixel(10, 0),
        red: pixel(60, 0),
        blue: pixel(-40, 80),
        secondClipped: pixel(40, 80),
        unused: pixel(0, 130),
        empty: pixel(150, 100),
      };
    };
    const initial = sample();
    view.step();
    const stepped = sample();
    const beforeMode = view.inspect();
    player.getRig(source.artboards[0].nodes[0].id).play('reorder');
    view.step();
    const reordered = sample(),
      switched = view.inspect();
    const sameAsset = new web.NativeWebRenderer(new runtime.NativeArtboardPlayer(asset), assets);
    sameAsset.destroy();
    sameAsset.destroy();
    const stillLive = !assets.isDisposed;
    view.destroy();
    app.destroy(true);
    assets.dispose();
    assets.dispose();
    let disposedGuard = false;
    try {
      view.update(1 / 60);
    } catch {
      disposedGuard = true;
    }
    return {
      initial,
      stepped,
      reordered,
      beforeMode,
      switched,
      sourceUnchanged: JSON.stringify(source) === before,
      stillLive,
      disposedGuard,
    };
  }, renderGoldenFixture());
  const expected = {
    green: [0, 255, 0, 255],
    clipped: [0, 0, 0, 0],
    red: [128, 0, 0, 128], // Pixi pixel extraction returns premultiplied RGBA.
    blue: [0, 0, 255, 255],
    secondClipped: [0, 0, 0, 0],
    unused: [0, 0, 0, 0],
    empty: [0, 0, 0, 0],
  };
  assert.deepEqual(
    goldens.initial,
    expected,
    'native stencil/RGBA/alpha goldens on a transparent production canvas',
  );
  assert.deepEqual(goldens.stepped, expected);
  assert.deepEqual(
    goldens.reordered.clipped,
    [0, 255, 0, 255],
    'animated draw order removes stale clipping membership',
  );
  assert.equal(
    goldens.switched.rebuilds,
    goldens.beforeMode.rebuilds + 1,
    'raw/Logic skeleton publication rebuilds exactly once',
  );
  assert.ok(goldens.sourceUnchanged && goldens.stillLive && goldens.disposedGuard);

  const interactive = await page.evaluate(
    (source) => window.nativeTest.core.deserializeProject(source),
    readFileSync('fixtures/bbbproj-v13-interactive.json', 'utf8'),
  );
  for (const board of [...interactive.artboards, ...interactive.components])
    for (const node of board.nodes)
      if (node.type === 'text') node.fontFamilies = ['Noto Sans Arabic', 'sans-serif'];
  const download = page.waitForEvent('download');
  download.catch(() => {}); // Preserve the original compile error if setup fails before download.
  await page.evaluate((source) => {
    const { runtime } = window.nativeTest,
      before = JSON.stringify(source),
      { program } = runtime.compileRuntime(source);
    const bytes = runtime.encodeRuntime(program),
      blob = new Blob([bytes], { type: 'application/octet-stream' }),
      url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'native-interactive.bbb';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    window.nativeTest.sourceUnchanged = before === JSON.stringify(source);
  }, interactive);
  const exported = readFileSync(await (await download).path());
  const parity = await page.evaluate(
    async ({ bytes, source, base }) => {
      const { runtime, web, core, pixi } = window.nativeTest;
      const asset = new runtime.NativeRuntimeAsset(runtime.loadRuntime(Uint8Array.from(bytes))),
        fontsBefore = document.fonts.size;
      const fonts = [
        {
          family: 'Noto Sans Arabic',
          source: `url(${new URL('fonts/NotoSansArabic.ttf', base).href})`,
          descriptors: { weight: '100 900' },
        },
      ];
      const assets = await web.NativeWebAssets.load(asset, { fonts }),
        player = new runtime.NativeArtboardPlayer(asset),
        view = new web.NativeWebRenderer(player, assets);
      const sourceScene = new core.SceneLogicPlayer(source.artboards[0], source.components),
        sourceRigs = new Map();
      sourceScene.pause();
      for (const node of source.artboards[0].nodes)
        if (node.type === 'rig') {
          const rig = new core.RigLogicPlayer(node);
          rig.pause();
          sourceRigs.set(node.id, rig);
        }
      const sourceView = new web.PixiSceneRenderer(assets),
        skeletons = new Map([...sourceRigs].map(([id, rig]) => [id, rig.skeleton]));
      sourceView.setScene(sourceScene.getView(), source.components, 'expected', skeletons);
      const app = new pixi.Application();
      await app.init({
        width: 700,
        height: 500,
        resolution: 1,
        backgroundAlpha: 0,
        preference: 'webgl',
        autoStart: false,
      });
      document.querySelector('#stage').append(app.canvas);
      const pixelBytes = (renderer) => {
        app.stage.removeChildren();
        renderer.world.position.set(350, 250);
        app.stage.addChild(renderer.world);
        app.render();
        return app.renderer.extract.pixels({
          target: app.stage,
          frame: new pixi.Rectangle(0, 0, 700, 500),
          clearColor: '#00000000',
        }).pixels;
      };
      const compare = () => {
        const a = pixelBytes(view),
          b = pixelBytes(sourceView);
        return {
          equal: a.length === b.length && a.every((byte, index) => byte === b[index]),
          nonempty: a.filter((_, index) => index % 4 === 3 && a[index] > 0).length,
        };
      };
      const initial = compare(),
        baseline = view.inspect();
      const hit = player
        .getView()
        .nodes.find((node) => node.type === 'text' && player.scene.getNodeOwner(node.id) === 'instance');
      player.dispatch('click', hit.id);
      sourceScene.dispatch('click', 'instance');
      player.getRig('rig-character').dispatch('click');
      sourceRigs.get('rig-character').dispatch('click', null);
      const events = [];
      player.onEvent((event) => events.push(event));
      for (let n = 0; n < 60; n++) {
        view.step();
        sourceScene.step();
        for (const rig of sourceRigs.values()) rig.step();
      }
      sourceView.previewView(sourceScene.getView(), skeletons);
      const active = compare(),
        animated = view.inspect();
      const point = player.evaluate().find((entry) => entry.node.id === hit.id).world;
      const picked = view.hitTest(point[4], point[5]);
      player.resize(900, 500);
      view.sync();
      const resized = view.inspect();
      const held = view.inspect();
      for (let n = 0; n < 20; n++) view.sync();
      const steady = view.inspect();
      let differentAsset = false;
      try {
        new web.NativeWebRenderer(new runtime.NativeArtboardPlayer(asset.getProgram()), assets);
      } catch {
        differentAsset = true;
      }
      app.stage.removeChildren();
      view.destroy();
      sourceView.destroy();
      app.destroy(true);
      assets.dispose();
      return {
        initial,
        active,
        baseline,
        animated,
        resized,
        held,
        steady,
        picked,
        expectedHit: hit.id,
        events,
        fontsRestored: document.fonts.size === fontsBefore,
        decoded: assets.isDisposed,
        differentAsset,
        sourceUnchanged: window.nativeTest.sourceUnchanged,
      };
    },
    { bytes: [...exported], source: interactive, base },
  );
  assert.ok(
    parity.initial.equal && parity.active.equal,
    'downloaded native file renders pixel-for-pixel like independent source scene/rig playback',
  );
  assert.ok(
    parity.initial.nonempty > 1000 && parity.active.nonempty > 1000,
    'real raster image and shaped RTL text produce visible pixels',
  );
  assert.equal(
    parity.animated.rebuilds,
    parity.baseline.rebuilds,
    'stable native geometry survives animation',
  );
  assert.equal(
    parity.resized.rebuilds,
    parity.animated.rebuilds + 1,
    'responsive resize updates actual geometry',
  );
  assert.equal(parity.steady.textRasters, parity.held.textRasters, 'held views reuse shaped text textures');
  assert.equal(parity.picked, parity.expectedHit, 'rendered hit routes through native component ownership');
  assert.ok(parity.fontsRestored && parity.decoded && parity.differentAsset && parity.sourceUnchanged);

  const rejection = await page.evaluate(
    async ({ source, base }) => {
      const { runtime, web } = window.nativeTest,
        program = runtime.compileRuntime(source).program,
        asset = new runtime.NativeRuntimeAsset(program);
      const fontsBefore = document.fonts.size,
        urls = new Set(),
        create = URL.createObjectURL,
        revoke = URL.revokeObjectURL;
      URL.createObjectURL = (blob) => {
        const url = create.call(URL, blob);
        urls.add(url);
        return url;
      };
      URL.revokeObjectURL = (url) => {
        urls.delete(url);
        revoke.call(URL, url);
      };
      const fonts = [
        { family: 'Noto Sans Arabic', source: `url(${new URL('fonts/NotoSansArabic.ttf', base).href})` },
      ];
      const outcome = async (operation) => {
        try {
          const assets = await operation();
          assets.dispose();
          return 'unexpected-success';
        } catch (error) {
          return error.diagnostic?.code ?? error.name;
        }
      };
      try {
        const missingFont = await outcome(() => web.NativeWebAssets.load(asset));
        const invalidFont = await outcome(() =>
          web.NativeWebAssets.load(asset, {
            fonts: [{ family: 'Noto Sans Arabic', source: Uint8Array.from([1, 2, 3]).buffer }],
          }),
        );
        const corrupt = asset.getProgram();
        corrupt.textures.push({
          ...corrupt.textures[0],
          id: 'zz-corrupt',
          base64: btoa(atob(corrupt.textures[0].base64).slice(0, 33)),
        });
        corrupt.artboards[0].nodes.push({
          id: 'bad-image',
          name: 'Bad image',
          type: 'image',
          parentId: null,
          visible: true,
          opacity: 1,
          transform: {
            x: 0,
            y: 0,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            shearX: 0,
            shearY: 0,
            pivotX: 0,
            pivotY: 0,
          },
          width: 128,
          height: 128,
          textureId: 'zz-corrupt',
        });
        const invalidImage = await outcome(() =>
          web.NativeWebAssets.load(new runtime.NativeRuntimeAsset(corrupt), { fonts }),
        );
        const budget = await outcome(() => web.NativeWebAssets.load(asset, { fonts, maxPixels: 1 }));
        const controller = new AbortController(),
          loading = web.NativeWebAssets.load(asset, { fonts, signal: controller.signal });
        controller.abort();
        const cancelled = await outcome(() => loading);
        const loaded = await web.NativeWebAssets.load(asset, { fonts });
        let missingTexture;
        try {
          loaded.get('missing');
        } catch (error) {
          missingTexture = error.diagnostic?.code;
        }
        loaded.dispose();
        return {
          missingFont,
          invalidFont,
          invalidImage,
          budget,
          cancelled,
          missingTexture,
          urls: urls.size,
          fontsRestored: document.fonts.size === fontsBefore,
        };
      } finally {
        URL.createObjectURL = create;
        URL.revokeObjectURL = revoke;
      }
    },
    { source: interactive, base },
  );
  assert.deepEqual(rejection, {
    missingFont: 'MISSING_FONT',
    invalidFont: 'FONT_DECODE',
    invalidImage: 'IMAGE_DECODE',
    budget: 'IMAGE_BUDGET',
    cancelled: 'AbortError',
    missingTexture: 'MISSING_PIXELS',
    urls: 0,
    fontsRestored: true,
  });
  const cases = readdirSync('fixtures')
    .filter((name) => /^bbbproj.*\.json$/.test(name))
    .map((name) => ({ name, source: readFileSync(`fixtures/${name}`, 'utf8') }));
  cases.push({
    name: 'Fox-Adventurer',
    source: readFileSync('examples/fox-adventurer/Fox-Adventurer.bbbproj', 'utf8'),
  });
  const corpus = await page.evaluate(async (cases) => {
    const { runtime, web, core, pixi } = window.nativeTest,
      results = [];
    const app = new pixi.Application();
    await app.init({
      width: 512,
      height: 384,
      backgroundAlpha: 0,
      resolution: 1,
      preference: 'webgl',
      autoStart: false,
    });
    try {
      for (const item of cases) {
        const project = core.deserializeProject(item.source),
          before = JSON.stringify(project);
        let program;
        try {
          program = runtime.compileRuntime(project).program;
        } catch (error) {
          if (error.diagnostic?.code !== 'UNSUPPORTED_IMAGE') throw error;
          results.push({ name: item.name, unsupported: error.diagnostic.code });
          continue;
        }
        const asset = new runtime.NativeRuntimeAsset(runtime.loadRuntime(runtime.encodeRuntime(program))),
          assets = await web.NativeWebAssets.load(asset);
        const player = new runtime.NativeArtboardPlayer(asset),
          native = new web.NativeWebRenderer(player, assets),
          sourceRenderer = new web.PixiSceneRenderer(assets);
        const board = project.artboards[0],
          scene = board.logic ? new core.SceneLogicPlayer(board, project.components) : null;
        scene?.pause();
        const sourceView = scene?.getView() ?? board,
          skeletons = new Map();
        for (const node of core.expandUIComponents(project, sourceView).artboard.nodes)
          if (node.type === 'rig') {
            let skeleton;
            if (node.logic) {
              const graph = new core.RigLogicPlayer(node);
              graph.pause();
              skeleton = graph.skeleton;
            } else {
              skeleton = new core.Skeleton(structuredClone(node.skeleton));
              core.solveFK(skeleton.data, skeleton.boneIndexMap, skeleton.pose);
              core.solveConstraints(skeleton);
              skeleton.secondaryMotion?.rebase(skeleton);
              core.updateSkinning(skeleton);
            }
            skeletons.set(node.id, skeleton);
          }
        sourceRenderer.setScene(sourceView, project.components ?? [], 'expected', skeletons);
        const pixels = (renderer) => {
          app.stage.removeChildren();
          renderer.world.position.set(256, 192);
          renderer.world.scale.set(Math.min(1, 492 / board.width, 364 / board.height));
          app.stage.addChild(renderer.world);
          app.render();
          return app.renderer.extract.pixels({
            target: app.stage,
            frame: new pixi.Rectangle(0, 0, 512, 384),
            clearColor: '#00000000',
          }).pixels;
        };
        const a = pixels(native),
          b = pixels(sourceRenderer),
          publication = assets.inspect();
        results.push({
          name: item.name,
          equal: a.length === b.length && a.every((value, index) => value === b[index]),
          sourceUnchanged: JSON.stringify(project) === before,
          images: publication.textures.length,
          fonts: publication.fonts.length,
        });
        app.stage.removeChildren();
        native.destroy();
        sourceRenderer.destroy();
        assets.dispose();
      }
    } finally {
      app.destroy(true);
    }
    return results;
  }, cases);
  assert.equal(corpus.filter((item) => item.unsupported === 'UNSUPPORTED_IMAGE').length, 2);
  assert.equal(
    corpus.filter((item) => item.equal && item.sourceUnchanged).length,
    13,
    JSON.stringify(corpus),
  );
  assert.deepEqual(errors, []);
  writeFileSync(
    'packages/editor/.smoke/native-web.json',
    JSON.stringify({ goldens, parity, rejection, corpus }, null, 2),
  );
  console.log(
    'PASS: independent native .bbb download/load, actual raster/RTL source pixel parity, stencil/RGBA/draw order, stable geometry, resize/hit routing, atomic decode/cancellation and resource disposal',
  );
} finally {
  await browser.close();
}
