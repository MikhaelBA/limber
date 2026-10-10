import assert from 'node:assert/strict';
import { build } from 'vite';
import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative, extname, isAbsolute } from 'node:path';

/** Verify emitted worker/WASM paths, not just Vite dev-time source resolution. */
export async function verifyAtlasProduction(browser) {
  const editor = resolve(import.meta.dirname, '../packages/editor');
  const output = resolve(editor, '.smoke/atlas-production');
  assert(output.startsWith(`${editor}${process.platform === 'win32' ? '\\' : '/'}`));
  await build({
    root: editor,
    configFile: resolve(editor, 'vite.config.ts'),
    logLevel: 'warn',
    build: {
      outDir: output,
      emptyOutDir: true,
      rollupOptions: { input: resolve(editor, 'tests/atlas-production-host.html') },
    },
  });
  assert(readdirSync(resolve(output, 'assets')).some((name) => name.endsWith('.wasm')));
  assert(
    readdirSync(resolve(output, 'assets')).some(
      (name) => name.startsWith('assetWorker-') && name.endsWith('.js'),
    ),
  );
  assert(
    readFileSync(resolve(output, 'licenses/resvg/LICENSE.txt'), 'utf8').includes('Mozilla Public License'),
  );
  const server = createServer((request, response) => {
    try {
      const path = resolve(
          output,
          `.${decodeURIComponent(new URL(request.url, 'http://localhost').pathname)}`,
        ),
        rel = relative(output, path);
      if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Path outside artifact.');
      response.setHeader(
        'Content-Type',
        { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css' }[
          extname(path)
        ] ?? 'application/octet-stream',
      );
      response.end(readFileSync(path));
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const page = await browser.newPage(),
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/tests/atlas-production-host.html`);
    await page.waitForFunction(() => typeof window.prepareNativeAtlas === 'function');
    const result = await page.evaluate(async () => {
      const bytes = new TextEncoder().encode(
        '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="3"><rect width="2" height="3" fill="red"/></svg>',
      ).buffer;
      const r = await window.prepareNativeAtlas({
        images: [{ id: 'production', mime: 'image/svg+xml', bytes }],
        layout: { padding: 0 },
      });
      const bitmap = await createImageBitmap(new Blob([r.pages[0].bytes], { type: 'image/png' }));
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      return {
        regions: r.regions.length,
        pixel: [...ctx.getImageData(0, 0, 1, 1).data],
        pages: r.pages.length,
      };
    });
    assert.deepEqual(result, { regions: 1, pixel: [255, 0, 0, 255], pages: 1 });
    await page.evaluate(async () => {
      window.fontProject = window.createNativeFontProject();
      window.fontResult = await window.compileNativeProject(window.fontProject);
    });
    await page.route('**/fonts/**', (route) => route.abort());
    const fonts = await page.evaluate(async () => {
      const { loadRuntime, NativeRuntimeAsset } = window.nativeRuntime;
      const program = loadRuntime(new Uint8Array(window.fontResult.runtime.bytes));
      const before = document.fonts.size;
      const assets = await window.NativeWebAssets.load(new NativeRuntimeAsset(program));
      const node = window.fontProject.artboards[0].nodes[0];
      const rendered = window.rasterizeUIText(
        node,
        node,
        'expected',
        assets.resolveFontFamilies(node.fontFamilies),
      );
      const pixels = rendered.canvas.getContext('2d').getImageData(0, 0, node.width, node.height).data;
      const visible = pixels.reduce((n, value, i) => n + Number(i % 4 === 3 && value > 0), 0);
      assets.dispose();
      return {
        count: program.fonts.length,
        notice: program.fonts[0].license.text.includes('SIL OPEN FONT LICENSE'),
        visible,
        restored: document.fonts.size === before,
      };
    });
    assert.equal(fonts.count, 1);
    assert(fonts.notice && fonts.visible > 100 && fonts.restored);
    assert.deepEqual(errors, []);
    return { ...result, fonts };
  } finally {
    await page.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
