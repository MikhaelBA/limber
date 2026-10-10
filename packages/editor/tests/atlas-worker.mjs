import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { verifyAtlasProduction } from '../../../tools/verify-atlas-production.mjs';

const base = process.env.SPRINE_URL ?? 'http://127.0.0.1:5173/';
mkdirSync('packages/editor/.smoke', { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage(),
    errors = [];
  page.setDefaultTimeout(60000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(new URL('tests/native-web.html', base).href);
  const golden = await page.evaluate(async () => {
    const { prepareNativeAtlas } = await import('/tests/native-web-host.ts');
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="6" height="2"><path fill="red" d="M0 0h2v2H0z"/><path fill="#00ff00" d="M2 0h2v2H2z"/><path fill="blue" fill-opacity="0.5" d="M4 0h2v2H4z"/></svg>',
    ).buffer;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 2;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(255,255,0,1)';
    ctx.fillRect(1, 1, 1, 1);
    const png = await (await new Promise((resolve) => canvas.toBlob(resolve))).arrayBuffer();
    const images = [
      { id: 'wide', mime: 'image/svg+xml', bytes: svg, trim: false },
      { id: 'tiny', mime: 'image/png', bytes: png },
    ];
    const before = images.map((image) => Array.from(new Uint8Array(image.bytes)));
    const progress = [];
    const input = {
      images,
      layout: { maxWidth: 4, maxHeight: 8, padding: 1, powerOfTwo: false, allowRotation: true },
    };
    const result = await prepareNativeAtlas(input, {
      progress: (fraction, stage) => progress.push({ fraction, stage }),
    });
    const output = [];
    for (const p of result.pages) {
      const bitmap = await createImageBitmap(new Blob([p.bytes], { type: p.mime }));
      const c = document.createElement('canvas');
      c.width = p.width;
      c.height = p.height;
      const cx = c.getContext('2d');
      cx.drawImage(bitmap, 0, 0);
      bitmap.close();
      output.push([...cx.getImageData(0, 0, c.width, c.height).data]);
    }
    const read = (id, x, y) => {
      const placement = result.layout.placements.find((p) => p.id === id),
        p = result.pages[placement.page];
      const offset = ((placement.y + y) * p.width + placement.x + x) * 4;
      return output[placement.page].slice(offset, offset + 4);
    };
    const reverse = await prepareNativeAtlas({ ...input, images: [...images].reverse() });
    return {
      layout: result.layout,
      regions: result.regions,
      stats: result.stats,
      timingsMs: result.timingsMs,
      rgba: Array.from({ length: 6 }, (_, y) => read('wide', 0, y)),
      gutter: read('wide', -1, 5),
      tiny: read('tiny', 0, 0),
      pages: result.pages.map((p) => ({
        id: p.id,
        width: p.width,
        height: p.height,
        mime: p.mime,
        bytes: p.bytes.byteLength,
        premultiplied: p.premultiplied,
      })),
      unchanged:
        JSON.stringify(before) ===
        JSON.stringify(images.map((image) => Array.from(new Uint8Array(image.bytes)))),
      deterministic:
        JSON.stringify(result.layout) === JSON.stringify(reverse.layout) &&
        JSON.stringify(output) ===
          JSON.stringify(
            await Promise.all(
              reverse.pages.map(async (p) => {
                const bitmap = await createImageBitmap(new Blob([p.bytes], { type: p.mime }));
                const c = document.createElement('canvas');
                c.width = p.width;
                c.height = p.height;
                const cx = c.getContext('2d');
                cx.drawImage(bitmap, 0, 0);
                bitmap.close();
                return [...cx.getImageData(0, 0, c.width, c.height).data];
              }),
            ),
          ),
      progress,
    };
  });
  assert.equal(golden.unchanged, true);
  assert.equal(golden.deterministic, true);
  assert.equal(golden.layout.placements.find((p) => p.id === 'wide').rotated, true);
  assert.equal(golden.pages.length, 2);
  assert.deepEqual(golden.rgba, [
    [255, 0, 0, 255],
    [255, 0, 0, 255],
    [0, 255, 0, 255],
    [0, 255, 0, 255],
    [0, 0, 255, 128],
    [0, 0, 255, 128],
  ]);
  assert.deepEqual(golden.gutter, [0, 0, 255, 128]);
  assert.deepEqual(golden.tiny, [255, 255, 0, 255]);
  assert.deepEqual(golden.regions.find((r) => r.id === 'tiny').crop, { x: 1, y: 1, width: 1, height: 1 });
  assert.equal(golden.progress.at(-1).fraction, 1);
  assert(golden.progress.every((p, i) => i === 0 || p.fraction >= golden.progress[i - 1].fraction));
  assert(golden.pages.every((p) => p.premultiplied === false && p.bytes > 33));
  assert.equal(golden.stats.pixelsScanned, 4);
  assert.equal(golden.stats.resizedPixels, 13);

  const diagnostics = await page.evaluate(async () => {
    const { prepareNativeAtlas } = await import('/tests/native-web-host.ts');
    const svg = (s) => ({ id: 'svg', mime: 'image/svg+xml', bytes: new TextEncoder().encode(s).buffer });
    const get = async (input) => {
      try {
        await prepareNativeAtlas(input);
        return null;
      } catch (e) {
        return { code: e.code, id: e.objectId, remedy: e.remedy, name: e.name };
      }
    };
    const basic =
      '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="6"><rect x="2" y="1" width="3" height="4" fill="red"/></svg>';
    const trimmed = await prepareNativeAtlas({
      images: [svg(basic)],
      raster: { scale: 0.5 },
      layout: { padding: 0 },
    });
    const locked = await prepareNativeAtlas({
      images: [{ ...svg(basic), trim: false }],
      layout: { padding: 0 },
    });
    const failure = {
      damaged: await get({ images: [svg('<svg broken')] }),
      external: await get({
        images: [
          svg(
            '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><image href="https://invalid.test/absent.png" width="2" height="2"/></svg>',
          ),
        ],
      }),
      missingFont: await get({
        images: [
          svg(
            '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><text y="15">Hello</text></svg>',
          ),
        ],
      }),
      budget: await get({ images: [svg(basic)], maxDecodedPixels: 47 }),
      scaleBudget: await get({
        images: [{ ...svg(basic), trim: false }],
        raster: { scale: 2 },
        maxDecodedPixels: 48,
      }),
      duplicate: await get({ images: [svg(basic), svg(basic)] }),
    };
    const aborted = new AbortController();
    aborted.abort();
    try {
      await prepareNativeAtlas({ images: [svg(basic)] }, { signal: aborted.signal });
    } catch (e) {
      failure.preAbort = { name: e.name };
    }
    // Cancel while the owned worker is active, then ensure a fresh job can publish.
    const active = new AbortController(),
      stages = [];
    try {
      await prepareNativeAtlas(
        { images: [svg(basic)] },
        {
          signal: active.signal,
          progress: (fraction, stage) => {
            stages.push(stage);
            active.abort();
          },
        },
      );
    } catch (e) {
      failure.activeAbort = { name: e.name };
    }
    const fresh = await prepareNativeAtlas({ images: [svg(basic)] });
    return {
      failure,
      stages,
      trimmed: trimmed.regions[0],
      locked: locked.regions[0],
      fresh: fresh.pages.length,
    };
  });
  assert.deepEqual(diagnostics.trimmed.crop, { x: 2, y: 1, width: 3, height: 4 });
  assert.equal(diagnostics.trimmed.width, 2);
  assert.equal(diagnostics.trimmed.height, 2);
  assert.deepEqual(diagnostics.locked.crop, { x: 0, y: 0, width: 8, height: 6 });
  for (const [key, code] of Object.entries({
    damaged: 'SVG_DECODE',
    external: 'SVG_EXTERNAL_IMAGE',
    missingFont: 'SVG_FONT_REQUIRED',
    budget: 'IMAGE_PIXEL_BUDGET',
    scaleBudget: 'ATLAS_PIXEL_BUDGET',
    duplicate: 'ATLAS_DUPLICATE_ID',
  })) {
    assert.equal(diagnostics.failure[key]?.code, code, key);
    assert(diagnostics.failure[key].remedy);
  }
  assert.equal(diagnostics.failure.preAbort.name, 'AbortError');
  assert.equal(diagnostics.failure.activeAbort.name, 'AbortError');
  assert.equal(diagnostics.stages.length, 1);
  assert.equal(diagnostics.fresh, 1);

  const formats = await page.evaluate(async () => {
    const { prepareNativeAtlas } = await import('/tests/native-web-host.ts');
    const c = document.createElement('canvas');
    c.width = 6;
    c.height = 4;
    c.getContext('2d').fillRect(0, 0, 6, 4);
    const images = [];
    for (const mime of ['image/png', 'image/jpeg', 'image/webp']) {
      const blob = await new Promise((resolve) => c.toBlob(resolve, mime));
      if (blob.type !== mime) throw new Error(`Browser did not encode ${mime}`);
      images.push({ id: mime, mime, bytes: await blob.arrayBuffer(), trim: false });
    }
    const result = await prepareNativeAtlas({ images });
    const truncated = { ...images[0], bytes: images[0].bytes.slice(0, 33) };
    let damaged;
    try {
      await prepareNativeAtlas({ images: [images[1], truncated] });
    } catch (e) {
      damaged = { code: e.code, id: e.objectId };
    }
    return { regions: result.regions.map((r) => ({ id: r.id, width: r.width, height: r.height })), damaged };
  });
  assert.equal(formats.regions.length, 3);
  assert(formats.regions.every((r) => r.width === 6 && r.height === 4));
  assert.deepEqual(formats.damaged, { code: 'IMAGE_DECODE', id: 'image/png' });

  const corpus = [];
  const cases = readdirSync('fixtures')
    .filter((f) => /^bbbproj.*\.json$/.test(f))
    .map((name) => ({ name, path: `fixtures/${name}` }));
  cases.push({ name: 'Fox-Adventurer', path: 'examples/fox-adventurer/Fox-Adventurer.bbbproj' });
  for (const { name, path } of cases) {
    const source = JSON.parse(readFileSync(path, 'utf8'));
    const images = Object.entries(source.assetManifest ?? {}).flatMap(([id, meta]) => {
      const data =
        typeof meta.dataUrl === 'string' &&
        /^data:(image\/(?:png|jpeg|webp|svg\+xml));base64,(.*)$/i.exec(meta.dataUrl);
      return data
        ? [{ id, mime: data[1].toLowerCase(), bytes: [...Buffer.from(data[2], 'base64')], trim: false }]
        : [];
    });
    const result = await page.evaluate(async (images) => {
      const { prepareNativeAtlas } = await import('/tests/native-web-host.ts');
      const before = JSON.stringify(images);
      const result = await prepareNativeAtlas({
        images: images.map((i) => ({ ...i, bytes: new Uint8Array(i.bytes).buffer })),
        layout: { maxWidth: 2048, maxHeight: 2048, padding: 2 },
      });
      return {
        regions: result.regions.map((r) => ({
          id: r.id,
          sourceWidth: r.sourceWidth,
          sourceHeight: r.sourceHeight,
        })),
        pages: result.pages.length,
        unchanged: before === JSON.stringify(images),
        stats: result.stats,
      };
    }, images);
    assert.equal(result.regions.length, images.length, name);
    assert.equal(result.unchanged, true);
    corpus.push({ name, ...result });
  }
  assert(corpus.some((f) => f.name.includes('motion')));
  assert(corpus.some((f) => f.name.includes('reward')));
  assert.equal(corpus.length, 15);
  assert.deepEqual(errors, []);
  const production = await verifyAtlasProduction(browser);
  writeFileSync(
    'packages/editor/.smoke/atlas-worker.json',
    JSON.stringify({ golden, diagnostics, formats, corpus, production }, null, 2),
  );
  console.log(
    `Atlas worker acceptance passed: RGBA/rotation/trim goldens, three raster formats, abort/isolation/diagnostics and ${corpus.length} source projects.`,
  );
} finally {
  await browser.close();
}
