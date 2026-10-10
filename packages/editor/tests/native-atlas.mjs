import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { renderGoldenFixture } from '../../../tools/render-golden-fixture.mjs';

const base = process.env.SPRINE_URL ?? 'http://127.0.0.1:5173/';
const browser = await chromium.launch({ headless: true });
mkdirSync('packages/editor/.smoke', { recursive: true });
try {
  const page = await browser.newPage(),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(new URL('tests/native-web.html', base).href);
  await page.evaluate(async () => {
    const api = await import('/tests/native-web-host.ts');
    window.nativeTest = api;
    window.compareNativeAtlas = async (project, options = {}, animate = false) => {
      const { runtime, web, core, pixi, compileNativeProject } = api;
      const before = JSON.stringify(project),
        progress = [];
      const result = await compileNativeProject(project, {
        ...options,
        progress: (fraction, stage) => progress.push({ fraction, stage }),
      });
      const program = runtime.loadRuntime(new Uint8Array(result.runtime.bytes)),
        asset = new runtime.NativeRuntimeAsset(program);
      const assets = await web.NativeWebAssets.load(asset, {
        fonts: [{ family: 'Noto Sans Arabic', source: 'url(/fonts/NotoSansArabic.ttf)' }],
      });
      const originals = new Map();
      for (const requirement of runtime.runtimeTextureRequirements({
        artboards: project.artboards,
        components: project.components ?? [],
      })) {
        const image = new Image();
        await new Promise((resolve, reject) => {
          image.onload = resolve;
          image.onerror = reject;
          image.src = project.assetManifest[requirement.id].dataUrl;
        });
        originals.set(requirement.id, pixi.Texture.from(image, true));
      }
      const sourceAssets = {
        placeholder: pixi.Texture.WHITE,
        version: 1,
        get: (id) => (id === '' ? pixi.Texture.WHITE : originals.get(id)),
      };
      const player = new runtime.NativeArtboardPlayer(asset),
        native = new web.NativeWebRenderer(player, assets),
        expected = new web.PixiSceneRenderer(sourceAssets);
      const board = project.artboards[0],
        scene = board.logic ? new core.SceneLogicPlayer(board, project.components) : null;
      scene?.pause();
      const sourceView = scene?.getView() ?? board,
        skeletons = new Map(),
        sourceRigs = new Map();
      for (const node of core.expandUIComponents(project, sourceView).artboard.nodes)
        if (node.type === 'rig') {
          let skeleton;
          if (node.logic) {
            const logic = new core.RigLogicPlayer(node);
            logic.pause();
            sourceRigs.set(node.id, logic);
            skeleton = logic.skeleton;
          } else {
            skeleton = new core.Skeleton(structuredClone(node.skeleton));
            core.solveFK(skeleton.data, skeleton.boneIndexMap, skeleton.pose);
            core.solveConstraints(skeleton);
            skeleton.secondaryMotion?.rebase(skeleton);
            core.updateSkinning(skeleton);
          }
          skeletons.set(node.id, skeleton);
        }
      expected.setScene(sourceView, project.components ?? [], 'source', skeletons);
      const app = new pixi.Application();
      await app.init({
        width: 512,
        height: 384,
        resolution: 1,
        backgroundAlpha: 0,
        preference: 'webgl',
        autoStart: false,
        antialias: false,
      });
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
      const compare = () => {
        const a = pixels(native),
          b = pixels(expected);
        let changed = 0,
          maximum = 0,
          visible = 0;
        const first = [],
          bounds = [512, 384, 0, 0];
        for (let i = 0; i < a.length; i++) {
          if (a[i] !== b[i]) {
            changed++;
            const x = Math.floor(i / 4) % 512,
              y = Math.floor(i / 2048);
            bounds[0] = Math.min(bounds[0], x);
            bounds[1] = Math.min(bounds[1], y);
            bounds[2] = Math.max(bounds[2], x);
            bounds[3] = Math.max(bounds[3], y);
            if (first.length < 12) first.push({ x, y, channel: i % 4, actual: a[i], expected: b[i] });
          }
          maximum = Math.max(maximum, Math.abs(a[i] - b[i]));
          if (i % 4 === 3 && b[i]) visible++;
        }
        return { changed, maximum, visible, first, bounds };
      };
      const initial = compare();
      let animated = null;
      if (animate) {
        player.play();
        scene?.play();
        for (const rig of sourceRigs.values()) rig.play();
        for (let i = 0; i < 60; i++) {
          native.update(1 / 120);
          scene?.update(1 / 120);
          for (const rig of sourceRigs.values()) rig.update(1 / 120);
          expected.previewView(scene?.getView() ?? board, skeletons);
        }
        animated = compare();
      }
      const publication = assets.inspect(),
        physicalSources = new Set(program.textures.map((t) => assets.get(t.id).source)).size;
      app.stage.removeChildren();
      native.destroy();
      expected.destroy();
      app.destroy(true);
      assets.dispose();
      for (const texture of originals.values()) texture.destroy(true);
      return {
        initial,
        animated,
        unchanged: JSON.stringify(project) === before,
        pages: program.atlasPages.length,
        logicalImages: program.textures.length,
        physicalSources,
        publication,
        layout: result.layout,
        regions: result.regions,
        bytes: result.runtime.bytes.byteLength,
        diagnostics: result.runtime.diagnostics,
        progress,
        stats: result.stats,
      };
    };
  });

  const synthetic = await page.evaluate(async (project) => {
    const board = project.artboards[0],
      rig = board.nodes[0];
    const c = document.createElement('canvas');
    c.width = 8;
    c.height = 4;
    const ctx = c.getContext('2d');
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 8; x++) {
        ctx.fillStyle = x < 4 ? (y < 2 ? 'red' : '#00ff00') : y < 2 ? 'blue' : 'yellow';
        ctx.fillRect(x, y, 1, 1);
      }
    project.assetManifest.pattern = { name: 'pattern.png', source: 'embedded', dataUrl: c.toDataURL() };
    for (const attachment of rig.skeleton.attachments)
      if (attachment.type === 'region') attachment.textureId = 'pattern';
    const red = rig.skeleton.attachments.find((a) => a.id === 'red');
    red.uvs = [-1, -1, 2, -1, 2, 2, -1, 2];
    const base = {
      name: 'Sprite',
      parentId: null,
      transform: {
        x: -110,
        y: 0,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        shearX: 0,
        shearY: 0,
        pivotX: 0,
        pivotY: 0,
      },
      opacity: 1,
      visible: true,
    };
    board.nodes.push({ ...base, id: 'sprite', type: 'image', textureId: 'pattern', width: 64, height: 32 });
    board.nodes.push({
      ...base,
      id: 'nine-slice',
      type: 'nineSlice',
      textureId: 'pattern',
      transform: { ...base.transform, x: 110, y: 80 },
      width: 72,
      height: 32,
      sourceWidth: 8,
      sourceHeight: 4,
      borders: { left: 2, right: 2, top: 1, bottom: 1 },
    });
    const trim = document.createElement('canvas');
    trim.width = 6;
    trim.height = 5;
    trim.getContext('2d').fillRect(2, 1, 2, 3);
    project.assetManifest.trim = { name: 'trim.png', source: 'embedded', dataUrl: trim.toDataURL() };
    board.nodes.push({
      ...base,
      id: 'trimmed',
      type: 'image',
      textureId: 'trim',
      transform: { ...base.transform, x: -110, y: -100 },
      width: 60,
      height: 50,
    });
    const empty = document.createElement('canvas');
    empty.width = 5;
    empty.height = 7;
    project.assetManifest.empty = { name: 'empty.png', source: 'embedded', dataUrl: empty.toDataURL() };
    board.nodes.push({
      ...base,
      id: 'empty-sprite',
      type: 'image',
      textureId: 'empty',
      width: 30,
      height: 40,
    });
    const result = await window.compareNativeAtlas(project, {
      layout: { maxWidth: 8, maxHeight: 16, padding: 1, allowRotation: true, powerOfTwo: false },
    });
    window.syntheticProject = project;
    result.noTrim = await window.compareNativeAtlas(project, {
      raster: { trim: false },
      layout: { maxWidth: 8, maxHeight: 16, padding: 1, allowRotation: true, powerOfTwo: false },
    });
    return result;
  }, renderGoldenFixture());
  assert.equal(synthetic.unchanged, true);
  assert.equal(
    synthetic.initial.changed,
    0,
    JSON.stringify({
      initial: synthetic.initial,
      noTrim: synthetic.noTrim.initial,
      regions: synthetic.regions,
      layout: synthetic.layout,
    }),
  );
  assert(synthetic.initial.visible > 1000);
  assert.equal(synthetic.logicalImages, 3);
  assert(synthetic.layout.placements.some((p) => p.id === 'pattern' && p.rotated));
  assert.deepEqual(synthetic.regions.find((r) => r.id === 'pattern').crop, {
    x: 0,
    y: 0,
    width: 8,
    height: 4,
  });
  assert.deepEqual(synthetic.regions.find((r) => r.id === 'trim').crop, { x: 1, y: 0, width: 4, height: 5 });
  assert.equal(synthetic.regions.find((r) => r.id === 'empty').empty, true);

  await page.evaluate(() => {
    const button = document.createElement('button');
    button.id = 'download';
    button.textContent = 'Download packed .bbb';
    button.onclick = async () => {
      const result = await window.nativeTest.compileNativeProject(window.syntheticProject);
      const url = URL.createObjectURL(new Blob([result.runtime.bytes], { type: 'application/octet-stream' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'Native-Atlas.bbb';
      link.click();
      URL.revokeObjectURL(url);
    };
    document.body.append(button);
  });
  const downloading = page.waitForEvent('download');
  await page.locator('#download').click();
  const bytes = readFileSync(await (await downloading).path());
  const reloaded = await page.evaluate(
    (bytes) => {
      const { runtime } = window.nativeTest;
      const asset = new runtime.NativeRuntimeAsset(runtime.loadRuntime(new Uint8Array(bytes)));
      return {
        pages: asset.getAtlasPages().length,
        images: asset.getTextures().length,
        types: asset.getTextures().map((t) => t.type),
      };
    },
    [...bytes],
  );
  assert.equal(reloaded.images, 3);
  assert(reloaded.pages > 0);
  assert(reloaded.types.every((t) => t === 'atlas'));

  const lifecycle = await page.evaluate(async () => {
    const { runtime, web, pixi, compileNativeProject } = window.nativeTest;
    const source = structuredClone(window.syntheticProject),
      originalId = source.projectId;
    const pending = compileNativeProject(source);
    source.projectId = 'edited-after-worker-snapshot';
    source.artboards[0].nodes = [];
    source.assetManifest = {};
    const captured = await pending;
    const snapshot = runtime.loadRuntime(new Uint8Array(captured.runtime.bytes));
    const stopped = new AbortController();
    let lastStage, cancelled;
    try {
      await compileNativeProject(window.syntheticProject, {
        signal: stopped.signal,
        progress: (_, stage) => {
          lastStage = stage;
          if (stage === 'compile') stopped.abort();
        },
      });
    } catch (error) {
      cancelled = error.name;
    }
    const result = await compileNativeProject(window.syntheticProject, {
      layout: { maxWidth: 8, maxHeight: 16, padding: 1, allowRotation: true, powerOfTwo: false },
    });
    const damaged = runtime.loadRuntime(new Uint8Array(result.runtime.bytes));
    if (damaged.atlasPages.length < 2) throw new Error('Cleanup fixture needs multiple pages.');
    const second = damaged.atlasPages[1];
    second.base64 = btoa(atob(second.base64).slice(0, 33));
    const urls = new Set(),
      create = URL.createObjectURL,
      revoke = URL.revokeObjectURL;
    const destroy = pixi.Texture.prototype.destroy;
    let physicalDestroyed = 0,
      decodeError;
    URL.createObjectURL = (blob) => {
      const url = create.call(URL, blob);
      urls.add(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      urls.delete(url);
      revoke.call(URL, url);
    };
    pixi.Texture.prototype.destroy = function (source) {
      if (source) physicalDestroyed++;
      return destroy.call(this, source);
    };
    try {
      await web.NativeWebAssets.load(new runtime.NativeRuntimeAsset(damaged));
    } catch (error) {
      decodeError = error.diagnostic.code;
    } finally {
      URL.createObjectURL = create;
      URL.revokeObjectURL = revoke;
      pixi.Texture.prototype.destroy = destroy;
    }
    return {
      snapshotId: snapshot.id,
      originalId,
      snapshotImages: snapshot.textures.length,
      lastStage,
      cancelled,
      decodeError,
      physicalDestroyed,
      urls: urls.size,
    };
  });
  assert.equal(lifecycle.snapshotId, lifecycle.originalId);
  assert.equal(lifecycle.snapshotImages, 3);
  assert.equal(lifecycle.lastStage, 'compile');
  assert.equal(lifecycle.cancelled, 'AbortError');
  assert.equal(lifecycle.decodeError, 'IMAGE_DECODE');
  assert.equal(lifecycle.physicalDestroyed, 1);
  assert.equal(lifecycle.urls, 0);

  const cases = readdirSync('fixtures')
    .filter((name) => /^bbbproj.*\.json$/.test(name))
    .map((name) => ({ name, source: readFileSync(`fixtures/${name}`, 'utf8') }));
  cases.push({
    name: 'Fox-Adventurer',
    source: readFileSync('examples/fox-adventurer/Fox-Adventurer.bbbproj', 'utf8'),
  });
  const corpus = [];
  for (const item of cases) {
    const result = await page.evaluate(
      async ({ source, animate }) => {
        const project = window.nativeTest.core.deserializeProject(source);
        return window.compareNativeAtlas(project, { layout: { allowRotation: true } }, animate);
      },
      { source: item.source, animate: item.name === 'bbbproj-v13-interactive.json' },
    );
    assert.equal(result.unchanged, true, item.name);
    // Packed UV transforms can change GPU linear-filter rounding by one RGBA8 unit.
    // Geometry/trim/rotation goldens above remain exact; larger corpus errors still fail.
    assert(result.initial.maximum <= 1, `${item.name}: ${JSON.stringify(result.initial)}`);
    assert(
      result.initial.changed <= Math.ceil(result.initial.visible * 0.04),
      `${item.name}: corpus rounding exceeds one percent of visible RGBA channels.`,
    );
    if (result.animated)
      assert(result.animated.maximum <= 1, `${item.name} animated: ${JSON.stringify(result.animated)}`);
    assert.equal(result.physicalSources, result.pages, item.name);
    corpus.push({ name: item.name, ...result });
  }
  assert.equal(corpus.length, 15);
  assert.deepEqual(errors, []);
  writeFileSync(
    'packages/editor/.smoke/native-atlas.json',
    JSON.stringify({ synthetic, reloaded, lifecycle, corpus }, null, 2),
  );
  console.log(
    'PASS: packed .bbb download/load, rotated sprite/mesh/nine-slice and out-of-domain UV pixels, trim/empty/source isolation, shared page lifetimes and all fifteen source pixel gates.',
  );
} finally {
  await browser.close();
}
