import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.SPRINE_URL ?? 'http://127.0.0.1:5173/';
const browser = await chromium.launch({ headless: true });
mkdirSync('packages/editor/.smoke', { recursive: true });
try {
  const page = await browser.newPage(),
    errors = [],
    corpus = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(new URL('tests/native-web.html', base).href);
  const cases = readdirSync('fixtures')
    .filter((name) => /^bbbproj.*\.json$/.test(name))
    .map((name) => ({ name, source: readFileSync(`fixtures/${name}`, 'utf8') }));
  cases.push({
    name: 'Fox-Adventurer',
    source: readFileSync('examples/fox-adventurer/Fox-Adventurer.bbbproj', 'utf8'),
  });
  for (const item of cases) {
    const result = await page.evaluate(async ({ source }) => {
      const { core, runtime, web, compileNativeProject } = await import('/tests/native-web-host.ts');
      const project = core.deserializeProject(source),
        before = JSON.stringify(project),
        exported = await compileNativeProject(project),
        asset = new runtime.NativeRuntimeAsset(runtime.loadRuntime(new Uint8Array(exported.runtime.bytes))),
        report = runtime.inspectRuntimeInventory(asset),
        beforeFaces = document.fonts.size;
      const assets = await web.NativeWebAssets.load(asset);
      try {
        const physical = new Set(asset.getTextures().map((texture) => assets.get(texture.id).source));
        const actualBytes = [...physical].reduce(
          (sum, source) => sum + source.pixelWidth * source.pixelHeight * 4,
          0,
        );
        const actualDimension = Math.max(
          0,
          ...[...physical].flatMap((source) => [source.pixelWidth, source.pixelHeight]),
        );
        const expanded = project.artboards.map((board) => core.expandUIComponents(project, board).artboard);
        const player = new runtime.NativeArtboardPlayer(asset);
        const snapshot = JSON.stringify(player.snapshot());
        runtime.inspectRuntimeInventory(
          asset,
          runtime.createRuntimeBudget('custom', { bones: 0, textureBytes: 0 }),
        );
        return {
          report,
          sameResources:
            actualBytes === report.resources.textureBytes &&
            actualDimension === report.resources.textureDimension &&
            physical.size === report.resources.physicalTextures,
          sameNodes: expanded.every((board, i) => board.nodes.length === report.artboards[i].metrics.nodes),
          unchanged: before === JSON.stringify(project) && snapshot === JSON.stringify(player.snapshot()),
          facesBefore: beforeFaces,
        };
      } finally {
        assets.dispose();
      }
    }, item);
    assert(
      result.sameResources,
      `${item.name}: reported RGBA memory/pages/dimensions equal actual decoded sources`,
    );
    assert(result.sameNodes && result.unchanged);
    assert(
      !result.report.diagnostics.some((d) => d.severity === 'error'),
      `${item.name}: no native asset errors`,
    );
    assert.equal(await page.evaluate(() => document.fonts.size), result.facesBefore);
    corpus.push({
      name: item.name,
      resources: result.report.resources,
      artboards: result.report.artboards,
      codes: result.report.diagnostics.map((d) => d.code),
    });
  }
  assert.equal(corpus.length, 15);
  assert.deepEqual(errors, []);
  writeFileSync('packages/editor/.smoke/native-doctor.json', JSON.stringify(corpus, null, 2));
  console.log(
    'PASS: Ship Doctor inventory on all fifteen actual worker exports, decoded page/memory/dimension equality, repeated UI expansion, source/player immutability and font cleanup.',
  );
} finally {
  await browser.close();
}
