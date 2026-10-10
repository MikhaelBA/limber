import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.SPRINE_URL ?? 'http://127.0.0.1:5173/';
const browser = await chromium.launch({ headless: true });
mkdirSync('packages/editor/.smoke', { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }),
    errors = [];
  page.setDefaultTimeout(30000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(new URL('tests/native-web.html', base).href);
  const project = await page.evaluate(async () => {
    const { core } = await import('/tests/native-web-host.ts');
    return {
      format: core.PROJECT_FORMAT,
      schemaVersion: core.PROJECT_SCHEMA_VERSION,
      projectId: 'author-fonts',
      name: 'Font authoring',
      assetManifest: {},
      editor: { activeArtboardId: 'board', activeRigId: null },
      artboards: [
        {
          id: 'board',
          name: 'Board',
          width: 360,
          height: 120,
          nodes: [
            {
              id: 'label',
              name: 'Label',
              type: 'text',
              parentId: null,
              transform: core.sceneTransform(),
              visible: true,
              opacity: 1,
              width: 340,
              height: 115,
              text: 'سلام دنیا A123',
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
  });
  const original = readFileSync('packages/editor/public/fonts/NotoSansArabic.ttf'),
    smaller = Buffer.from(original);
  for (let i = 0; i < smaller.readUInt16BE(4); i++) {
    const p = 12 + i * 16;
    if (smaller.toString('ascii', p, p + 4) === 'head') {
      const at = smaller.readUInt32BE(p + 8);
      smaller.writeUInt16BE(smaller.readUInt16BE(at + 18) * 2, at + 18);
    }
  }
  await page.goto(base);
  await page.waitForFunction(() => window.__ticks > 2);
  const open = async (source) => {
    await page.locator('input[accept=".bbbproj,.json,application/json"]').setInputFiles({
      name: 'fonts.bbbproj',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(source)),
    });
    await page.getByText(/Opened fonts.bbbproj/).waitFor();
    await page.getByTestId('scene-canvas').locator('canvas').waitFor();
    if (!(await page.locator('details[aria-label="Project font library"]').count()))
      await page.getByRole('button', { name: 'Game UI', exact: true }).click();
    await page.locator('details[aria-label="Project font library"]').evaluate((el) => {
      el.open = true;
    });
  };
  const save = async () => {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    return JSON.parse(readFileSync(await (await download).path(), 'utf8'));
  };
  const pixels = async () => {
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
    });
    const rect = await page.getByTestId('scene-canvas').locator('canvas').boundingBox();
    // Screenshot only the rendered artboard; live CPU timing labels overlay the canvas edges.
    return page.screenshot({
      clip: { x: rect.x + 20, y: rect.y + 100, width: rect.width - 40, height: rect.height - 200 },
    });
  };
  const importFont = (buffer) =>
    page.getByLabel('Import project font', { exact: true }).setInputFiles({
      name: 'sample.ttf',
      mimeType: 'font/ttf',
      buffer,
    });
  await open(project);
  const baseline = await pixels();
  await importFont(smaller);
  await page.getByText(/Imported Noto Sans Arabic/).waitFor();
  assert.equal((await save()).fonts[0].base64, smaller.toString('base64'));
  await page.waitForFunction(async () => {
    const { resolveUIFonts } = await import('/src/rendering/UITextAdapter.ts');
    return resolveUIFonts(['Noto Sans Arabic'])[0].startsWith('BoneByBonePreview');
  });
  const changed = await pixels();
  assert(!baseline.equals(changed), 'imported font bytes must change source-preview glyph scale');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.waitForFunction(async () => {
    const { resolveUIFonts } = await import('/src/rendering/UITextAdapter.ts');
    return resolveUIFonts(['Noto Sans Arabic'])[0] === 'Noto Sans Arabic';
  });
  const undone = await pixels();
  writeFileSync('packages/editor/.smoke/font-baseline.png', baseline);
  writeFileSync('packages/editor/.smoke/font-changed.png', changed);
  writeFileSync('packages/editor/.smoke/font-undone.png', undone);
  assert(baseline.equals(undone), 'undo restores exact source-preview pixels');
  assert.equal((await save()).fonts, undefined);
  await importFont(Buffer.from('bad'));
  await page.getByText(/Invalid or oversized OpenType bytes/).waitFor();
  assert(await page.getByRole('button', { name: 'Redo', exact: true }).isEnabled());
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await page.getByLabel('License name Noto Sans Arabic', { exact: true }).fill('SIL Open Font License 1.1');
  await page.getByLabel('License name Noto Sans Arabic', { exact: true }).press('Tab');
  const notice = readFileSync('packages/editor/public/fonts/OFL-NotoSansArabic.txt', 'utf8');
  await page.getByLabel('License text Noto Sans Arabic', { exact: true }).fill(notice);
  await page.getByLabel('License text Noto Sans Arabic', { exact: true }).press('Tab');
  await page.getByLabel('Redistribution Noto Sans Arabic', { exact: true }).selectOption('allowed');
  await page.getByRole('button', { name: 'Label text', exact: true }).click();
  await page.getByRole('button', { name: 'Use for selected text', exact: true }).click();
  const saved = await save();
  assert.deepEqual(saved.artboards[0].nodes[0].fontFamilies, ['Noto Sans Arabic']);
  assert.equal(saved.fonts[0].license.text, notice);
  assert.equal(saved.fonts[0].license.redistribution, 'allowed');
  await open(saved);
  assert.deepEqual((await save()).fonts, saved.fonts);
  assert(changed.equals(await pixels()), 'reopened embedded font restores exact preview pixels');
  await page.getByLabel('Remove font Noto Sans Arabic', { exact: true }).click();
  assert.deepEqual((await save()).fonts, []);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual((await save()).fonts, saved.fonts);

  // Slow actual font decoding cannot import into a newly opened project.
  await page.evaluate(() => {
    const Original = window.FontFace;
    window.restoreImportFont = () => {
      window.FontFace = Original;
    };
    window.FontFace = class extends Original {
      async load() {
        const face = await super.load();
        if (this.family === 'BoneByBoneImportProbe') {
          window.importProbeWaiting = true;
          await new Promise((resolve) => {
            window.releaseImportFont = resolve;
          });
        }
        return face;
      }
    };
  });
  await importFont(original);
  await page.waitForFunction(() => window.importProbeWaiting);
  await open({ ...project, projectId: 'new-project' });
  await page.evaluate(() => {
    window.releaseImportFont();
    window.restoreImportFont();
  });
  await page.getByRole('button', { name: 'Import TTF / OTF', exact: true }).waitFor();
  assert.equal((await save()).fonts, undefined);

  await page.goto(new URL('tests/native-web.html', base).href);
  const acceptance = await page.evaluate(async () => {
    const { core, prepareNativeAtlas } = await import('/tests/native-web-host.ts');
    const bytes = new Uint8Array(await (await fetch('/fonts/NotoSansArabic.ttf')).arrayBuffer());
    const fonts = [
      {
        id: 'noto',
        family: 'Noto Sans Arabic',
        format: 'ttf',
        base64: '',
        license: { name: 'Unverified', text: '', redistribution: 'unknown' },
      },
    ];
    let binary = '';
    for (let p = 0; p < bytes.length; p += 8192)
      binary += String.fromCharCode(...bytes.subarray(p, p + 8192));
    fonts[0].base64 = btoa(binary);
    const { ensureUIFonts, resolveUIFonts } = await import('/src/rendering/UITextAdapter.ts');
    const Original = window.FontFace;
    let release, started;
    const waiting = new Promise((resolve) => {
      started = resolve;
    });
    let delayed = false;
    window.FontFace = class extends Original {
      async load() {
        const face = await super.load();
        if (this.family.startsWith('BoneByBonePreview') && !delayed) {
          delayed = true;
          started();
          await new Promise((resolve) => {
            release = resolve;
          });
        }
        return face;
      }
    };
    const before = document.fonts.size;
    try {
      const stale = ensureUIFonts(fonts);
      await waiting;
      await ensureUIFonts([{ ...fonts[0], family: 'Newest' }]);
      const newest = resolveUIFonts(['Newest'])[0];
      release();
      await stale;
      if (
        resolveUIFonts(['Newest'])[0] !== newest ||
        resolveUIFonts(['Noto Sans Arabic'])[0] !== 'Noto Sans Arabic'
      )
        throw new Error('Stale font published');
    } finally {
      window.FontFace = Original;
      await ensureUIFonts();
    }
    const svg = (body) => ({
      id: 'svg',
      mime: 'image/svg+xml',
      trim: false,
      bytes: new TextEncoder().encode(
        `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="60">${body}</svg>`,
      ).buffer,
    });
    const run = (body, buffers = [bytes.buffer]) =>
      prepareNativeAtlas({ images: [svg(body)], svgFonts: buffers, layout: { padding: 0 } });
    const raster = async (body) => {
      const result = await run(body),
        page = result.pages[0];
      const image = await createImageBitmap(new Blob([page.bytes], { type: page.mime }));
      const canvas = document.createElement('canvas');
      canvas.width = page.width;
      canvas.height = page.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);
      image.close();
      return [...ctx.getImageData(0, 0, page.width, page.height).data];
    };
    const canonical = await raster(
      '<text x="5" y="40" font-size="28" font-family="Noto Sans Arabic">سلام A123</text>',
    );
    const inherited = await raster(
      '<g font-family="NOTO SANS ARABIC"><text x="5" y="40" font-size="28">سلام A123</text></g>',
    );
    const generic = await raster(
      '<text x="5" y="40" font-size="28" style="font-family: sans-serif">سلام A123</text>',
    );
    const codes = [];
    for (const [body, buffers] of [
      ['<text font-family="Absent">A</text>', [bytes.buffer]],
      ['<text>🦊</text>', [bytes.buffer]],
      ['<text>A</text>', []],
      ['<style>text{font-family:Absent}</style><text>A</text>', [bytes.buffer]],
      ['<text>A</other>', [bytes.buffer]],
    ]) {
      try {
        await run(body, buffers);
        codes.push('unexpected success');
      } catch (e) {
        codes.push(e.code);
      }
    }
    const altered = bytes.slice(),
      view = new DataView(altered.buffer);
    for (let i = 0; i < view.getUint16(4); i++) {
      const p = 12 + i * 16;
      if (String.fromCharCode(...altered.subarray(p, p + 4)) === 'head') {
        const at = view.getUint32(p + 8);
        view.setUint16(at + 18, view.getUint16(at + 18) * 2);
      }
    }
    try {
      await run('<text>A</text>', [bytes.buffer, altered.buffer]);
      codes.push('unexpected success');
    } catch (e) {
      codes.push(e.code);
    }
    return {
      visible: canonical.filter((v, i) => i % 4 === 3 && v > 0).length,
      inherited: canonical.every((v, i) => v === inherited[i]),
      generic: canonical.every((v, i) => v === generic[i]),
      codes,
      noPreviewLeaks: document.fonts.size === before + 1, // only the shared bundled source face remains
      internalName: core.inspectOpenType(bytes).familyNames,
    };
  });
  assert(acceptance.visible > 200);
  assert(acceptance.inherited && acceptance.generic && acceptance.noPreviewLeaks);
  assert.deepEqual(acceptance.codes, [
    'SVG_FONT_MISSING',
    'SVG_FONT_GLYPH',
    'SVG_FONT_REQUIRED',
    'SVG_FONT_STYLE',
    'SVG_DECODE',
    'SVG_FONT_AMBIGUOUS',
  ]);
  assert.deepEqual(errors, []);
  writeFileSync('packages/editor/.smoke/font-authoring.json', JSON.stringify(acceptance, null, 2));
  console.log(
    'PASS: font import, actual source pixel changes/undo/reopen, license bytes, rejected/stale imports, isolated preview race and real SVG text-font pixels/diagnostics.',
  );
} finally {
  await browser.close();
}
