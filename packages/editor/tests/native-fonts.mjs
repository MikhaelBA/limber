import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.SPRINE_URL ?? 'http://127.0.0.1:5173/';
const browser = await chromium.launch({ headless: true });
mkdirSync('packages/editor/.smoke', { recursive: true });
try {
  const page = await browser.newPage(),
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(new URL('tests/native-web.html', base).href);
  const prepared = await page.evaluate(async () => {
    const api = await import('/tests/native-web-host.ts');
    window.api = api;
    const { core, runtime, compileNativeProject } = api;
    const originalBytes = new Uint8Array(await (await fetch('/fonts/NotoSansArabic.ttf')).arrayBuffer());
    const originalNotice = await (await fetch('/fonts/OFL-NotoSansArabic.txt')).text();
    const control = await new FontFace('IndependentNotoControl', originalBytes).load();
    document.fonts.add(control);
    const source = {
      format: core.PROJECT_FORMAT,
      schemaVersion: core.PROJECT_SCHEMA_VERSION,
      projectId: 'packaged-rtl',
      name: 'Packaged RTL sample',
      assetManifest: {},
      editor: { activeArtboardId: 'board', activeRigId: null },
      artboards: [
        {
          id: 'board',
          name: 'RTL',
          width: 360,
          height: 120,
          nodes: [
            {
              id: 'label',
              name: 'Label',
              type: 'text',
              parentId: null,
              transform: core.sceneTransform(),
              opacity: 1,
              visible: true,
              width: 340,
              height: 115,
              text: 'سلام دنیا\nLevel 123 — نان',
              fontFamilies: ['Noto Sans Arabic'],
              fontSize: 28,
              lineHeight: 42,
              direction: 'rtl',
              align: 'center',
              color: 0xffffff,
            },
          ],
        },
      ],
    };
    const before = JSON.stringify(source),
      progress = [];
    const result = await compileNativeProject(source, {
      progress: (fraction, stage) => progress.push({ fraction, stage }),
    });
    const program = runtime.loadRuntime(new Uint8Array(result.runtime.bytes));
    const font = program.fonts[0];
    window.fontCase = { source, result, program, originalBytes, control };
    const button = document.createElement('button');
    button.id = 'download';
    button.textContent = 'Download packaged fonts';
    button.onclick = () => {
      const url = URL.createObjectURL(new Blob([result.runtime.bytes]));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'Packaged-RTL.bbb';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    };
    document.body.append(button);
    return {
      unchanged: before === JSON.stringify(source),
      fonts: program.fonts.length,
      actualBytes: core.decodeFontBytes(font.base64).every((byte, i) => byte === originalBytes[i]),
      actualLength: core.decodeFontBytes(font.base64).length === originalBytes.length,
      notice: font.license.text === originalNotice,
      stages: progress.map((p) => p.stage),
      external: result.runtime.diagnostics.filter((d) =>
        ['EXTERNAL_FONT', 'FONT_FALLBACK', 'FONT_LICENSE'].includes(d.code),
      ),
      fontDuration: result.runtime.fontDurationMs,
    };
  });
  assert.equal(prepared.unchanged, true);
  assert.equal(prepared.fonts, 1);
  assert(prepared.actualBytes && prepared.actualLength && prepared.notice);
  assert.deepEqual(prepared.external, []);
  assert.equal(prepared.stages[0], 'fonts');
  assert(prepared.fontDuration >= 0);
  const download = page.waitForEvent('download');
  await page.locator('#download').click();
  const shipped = readFileSync(await (await download).path()).toString('base64');
  await page.route('**/fonts/**', (route) => route.abort()); // Playback must use packaged bytes offline.
  const playback = await page.evaluate(async (encoded) => {
    const { runtime, web, pixi, core, compileNativeProject } = window.api,
      { source, originalBytes } = window.fontCase;
    const program = runtime.loadRuntime(Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)));
    const beforeFonts = document.fonts.size;
    const asset = new runtime.NativeRuntimeAsset(program),
      assets = await web.NativeWebAssets.load(asset);
    const provider = {
      placeholder: pixi.Texture.WHITE,
      version: 1,
      get: () => pixi.Texture.WHITE,
      resolveFontFamilies: () => ['IndependentNotoControl'],
    };
    const app = new pixi.Application();
    await app.init({
      width: 360,
      height: 120,
      backgroundAlpha: 0,
      antialias: false,
      autoStart: false,
      preference: 'webgl',
    });
    const native = new web.NativeWebRenderer(new runtime.NativeArtboardPlayer(asset), assets),
      expected = new web.PixiSceneRenderer(provider);
    expected.setScene(source.artboards[0], [], '', new Map());
    const pixels = (view) => {
      app.stage.removeChildren();
      view.world.position.set(180, 60);
      app.stage.addChild(view.world);
      app.render();
      return app.renderer.extract.pixels({
        target: app.stage,
        frame: new pixi.Rectangle(0, 0, 360, 120),
        clearColor: '#00000000',
      }).pixels;
    };
    const actual = pixels(native),
      original = pixels(expected);
    const changed = actual.reduce((n, value, i) => n + Number(value !== original[i]), 0);
    const visible = actual.reduce((n, value, i) => n + Number(i % 4 === 3 && value > 0), 0);
    // A valid font body with a different em size proves same-family publications cannot collide.
    const smaller = originalBytes.slice(),
      view = new DataView(smaller.buffer);
    for (let i = 0; i < view.getUint16(4); i++) {
      const p = 12 + i * 16;
      if (String.fromCharCode(...smaller.subarray(p, p + 4)) === 'head') {
        const at = view.getUint32(p + 8);
        view.setUint16(at + 18, view.getUint16(at + 18) * 2);
      }
    }
    const alternate = structuredClone(program);
    alternate.id = 'second-publication';
    let binary = '';
    for (let p = 0; p < smaller.length; p += 8192)
      binary += String.fromCharCode(...smaller.subarray(p, p + 8192));
    alternate.fonts[0].base64 = btoa(binary);
    alternate.fonts[0].license.redistribution = 'unknown';
    const second = await web.NativeWebAssets.load(new runtime.NativeRuntimeAsset(alternate));
    const node = source.artboards[0].nodes[0];
    const textPixels = (publication) =>
      web
        .rasterizeUIText(node, node, 'expected', publication.resolveFontFamilies(node.fontFamilies))
        .canvas.getContext('2d')
        .getImageData(0, 0, node.width, node.height).data;
    const firstRaster = textPixels(assets),
      secondRaster = textPixels(second);
    const different = firstRaster.some((value, i) => value !== secondRaster[i]);
    const privateNames =
      assets.resolveFontFamilies(node.fontFamilies)[0] !== second.resolveFontFamilies(node.fontFamilies)[0];
    const fallbackSource = structuredClone(source);
    fallbackSource.fonts = [
      { ...alternate.fonts[0], id: 'compact', family: 'Compact' },
      { ...program.fonts[0], id: 'full', family: 'Full' },
    ];
    fallbackSource.artboards[0].nodes[0].fontFamilies = ['Compact', 'Full'];
    const packedFallback = await compileNativeProject(fallbackSource);
    const fallbackProgram = runtime.loadRuntime(new Uint8Array(packedFallback.runtime.bytes));
    const fallbackAssets = await web.NativeWebAssets.load(new runtime.NativeRuntimeAsset(fallbackProgram));
    const fallbackPixels = (families) =>
      web
        .rasterizeUIText(node, node, 'expected', fallbackAssets.resolveFontFamilies(families))
        .canvas.getContext('2d')
        .getImageData(0, 0, node.width, node.height).data;
    const compactFirst = fallbackPixels(['Compact', 'Full']),
      fullFirst = fallbackPixels(['Full', 'Compact']);
    const fallbackOrder =
      compactFirst.every((value, i) => value === secondRaster[i]) &&
      fullFirst.every((value, i) => value === firstRaster[i]);
    const authoredOrder = fallbackProgram.artboards[0].nodes[0].fontFamilies.join(',') === 'Compact,Full';
    fallbackAssets.dispose();
    second.dispose();
    const afterSecond = textPixels(assets);
    const survived = afterSecond.every((value, i) => value === firstRaster[i]);
    app.stage.removeChildren();
    native.destroy();
    expected.destroy();
    app.destroy(true);
    assets.dispose();
    return {
      changed,
      visible,
      different,
      survived,
      privateNames,
      fallbackOrder,
      authoredOrder,
      restored: document.fonts.size === beforeFonts,
      generic: core.isGenericFontFamily('SANS-SERIF'),
    };
  }, shipped);
  assert.equal(playback.changed, 0);
  assert(playback.visible > 500);
  assert(
    playback.different &&
      playback.survived &&
      playback.privateNames &&
      playback.restored &&
      playback.generic &&
      playback.fallbackOrder &&
      playback.authoredOrder,
  );

  const rejection = await page.evaluate(async () => {
    const { runtime, web, core, compileNativeProject } = window.api;
    const source = structuredClone(window.fontCase.source),
      program = structuredClone(window.fontCase.program);
    // Invalid outline data passes directory/cmap metadata, then fails actual worker/host font decoding.
    const broken = window.fontCase.originalBytes.slice(),
      v = new DataView(broken.buffer);
    for (let i = 0; i < v.getUint16(4); i++) {
      const p = 12 + i * 16;
      if (String.fromCharCode(...broken.subarray(p, p + 4)) === 'glyf')
        broken.fill(255, v.getUint32(p + 8), v.getUint32(p + 8) + v.getUint32(p + 12));
    }
    core.inspectOpenType(broken);
    let text = '';
    for (let p = 0; p < broken.length; p += 8192)
      text += String.fromCharCode(...broken.subarray(p, p + 8192));
    const damaged = { ...program.fonts[0], base64: btoa(text) };
    const failed = async (action) => {
      try {
        await action();
        return 'accepted';
      } catch (e) {
        return typeof e.code === 'string' ? e.code : (e.diagnostic?.code ?? e.name);
      }
    };
    source.fonts = [damaged];
    const worker = await failed(() => compileNativeProject(source));
    program.fonts = [{ ...window.fontCase.program.fonts[0], id: 'first', family: 'First' }, damaged];
    program.artboards[0].nodes[0].fontFamilies = ['First', 'Noto Sans Arabic'];
    const before = document.fonts.size;
    const host = await failed(() => web.NativeWebAssets.load(new runtime.NativeRuntimeAsset(program)));
    source.fonts = [];
    const controller = new AbortController();
    const aborted = await failed(() =>
      compileNativeProject(source, {
        signal: controller.signal,
        progress: (_, stage) => {
          if (stage === 'fonts') controller.abort();
        },
      }),
    );
    const unavailable = await failed(() => compileNativeProject(source)); // Bundled font network is blocked.
    return { worker, host, aborted, unavailable, restored: document.fonts.size === before };
  });
  assert.deepEqual(rejection, {
    worker: 'FONT_DECODE',
    host: 'FONT_DECODE',
    aborted: 'AbortError',
    unavailable: 'FONT_FETCH',
    restored: true,
  });
  assert.deepEqual(errors, []);
  writeFileSync(
    'packages/editor/.smoke/native-fonts.json',
    JSON.stringify({ prepared, playback, rejection }, null, 2),
  );
  console.log(
    'PASS: real packaged OpenType worker decode, license bytes, .bbb download/offline RTL pixels, same-family isolation, invalid second-font staging and abort/fetch cleanup.',
  );
} finally {
  await browser.close();
}
