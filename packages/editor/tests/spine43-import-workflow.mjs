import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { grid43 } from '../../../fixtures/spine-import/grid43.mjs';

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(process.env.SPRINE_URL ?? 'http://127.0.0.1:5183/');
  await page.waitForFunction(() => window.__ticks > 2);
  const privateDir = process.env.BBB_SPINE_FIXTURE_DIR;
  let source, files, name;
  if (privateDir) {
    name = 'curtain-masks';
    source = JSON.parse(readFileSync(resolve(privateDir, `${name}.json`)));
    files = ['.json', '.atlas.txt', '.png'].map((ext) => resolve(privateDir, `${name}${ext}`));
  } else {
    name = 'grid43';
    source = grid43();
    const encoded = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 32;
      c.height = 32;
      const x = c.getContext('2d');
      x.fillStyle = '#da7623';
      x.fillRect(0, 0, 32, 32);
      x.fillStyle = '#46cfff';
      x.fillRect(0, 0, 16, 16);
      x.fillStyle = '#7632cc';
      x.fillRect(16, 16, 16, 16);
      // Premultiplied source color at a known isolated texel.
      x.putImageData(new ImageData(new Uint8ClampedArray([64, 32, 16, 128]), 1, 1), 3, 3);
      return c.toDataURL().split(',')[1];
    });
    files = [
      { name: `${name}.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) },
      {
        name: 'grid43.atlas.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('page.png\nsize:32,32\npma:true\npanel\nbounds:0,0,32,32\n'),
      },
      { name: 'page.png', mimeType: 'image/png', buffer: Buffer.from(encoded, 'base64') },
    ];
  }
  assert.equal(source.skeleton.spine, '4.3.26');
  await page.getByRole('button', { name: 'Import Spine…', exact: true }).click();
  await page.getByLabel('Project files', { exact: true }).setInputFiles(files);
  await page
    .getByRole('dialog', { name: 'Import Spine' })
    .getByRole('button', { name: 'Import', exact: true })
    .click();
  await page
    .locator('footer')
    .getByText(new RegExp(`Imported Spine ${name}`))
    .waitFor();
  assert.match(
    await page.locator('footer').innerText(),
    /boundary reconstructed.*128 vertices; export declared 1073/,
  );
  const save = async (output) => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const file = await (await pending).path();
    if (output) copyFileSync(file, output);
    return JSON.parse(readFileSync(file));
  };
  const evidence = resolve('packages/editor/.smoke/spine43-import');
  mkdirSync(evidence, { recursive: true });
  const saved = await save(privateDir ? resolve(evidence, 'curtain-masks.bbbproj') : undefined);
  const rig = saved.artboards[0].nodes[0],
    mesh = rig.skeleton.attachments[0];
  const original = Object.values(Object.values(source.skins[0].attachments)[0])[0];
  assert.equal(mesh.meshVertices.length, 2146);
  assert.equal(mesh.meshHull.length, 128);
  assert.deepEqual(mesh.meshTriangles, original.triangles);
  assert.deepEqual(mesh.meshUVs, original.uvs);
  for (let i = 0; i < original.vertices.length; i++)
    assert(Math.abs(mesh.meshVertices[i] - (i % 2 ? -original.vertices[i] : original.vertices[i])) < 1e-6);
  assert.equal(rig.animations.length, 2);
  const slotName = source.slots[0].name,
    attachmentName = source.slots[0].attachment;
  assert.equal(
    rig.animations.find((a) => a.name === 'idle').timelines[0].keyframes.length,
    source.animations.idle.attachments.default[slotName][attachmentName].deform.length,
  );
  if (!privateDir) {
    const rgba = await page.evaluate(async (url) => {
      const i = new Image();
      i.src = url;
      await i.decode();
      const c = document.createElement('canvas');
      c.width = i.width;
      c.height = i.height;
      const x = c.getContext('2d');
      x.drawImage(i, 0, 0);
      return [...x.getImageData(3, 3, 1, 1).data];
    }, saved.assetManifest[mesh.textureId].dataUrl);
    assert.deepEqual(rgba, [128, 64, 32, 128], 'premultiplied atlas is restored to straight RGBA');
  }
  await page.getByRole('button', { name: 'Animate', exact: true }).click();
  await page.getByRole('button', { name: 'Bones', exact: true }).click();
  const animation = page.locator('select').filter({ has: page.locator('option', { hasText: /^idle$/ }) });
  const canvas = page.locator('canvas');
  for (const clip of ['idle', 'intro']) {
    await animation.selectOption(clip);
    await page
      .locator('.cursor-ew-resize')
      .first()
      .click({ position: { x: 0, y: 12 } });
    const before = await canvas.screenshot();
    await page
      .locator('.cursor-ew-resize')
      .first()
      .click({ position: { x: clip === 'intro' ? 28 : privateDir ? 230 : 100, y: 12 } });
    const after = await canvas.screenshot();
    assert(!before.equals(after), `${clip} must change the rendered artwork`);
    await page.screenshot({ path: resolve(evidence, `${name}-${clip}.png`) });
  }
  await page.getByLabel('Project files', { exact: true }).setInputFiles({
    name: 'reopened.bbbproj',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(saved)),
  });
  await page
    .locator('footer')
    .getByText(/Opened reopened.bbbproj/)
    .waitFor();
  assert.deepEqual(await save(), saved, 'native Save/Open retains the grid, sparse Deform and atlas pixels');
  assert.deepEqual(errors, []);
  console.log(
    `PASS: ${name} Spine 4.3.26, 1073 unchanged vertices, inferred 128-point boundary, idle/intro artwork and native roundtrip.`,
  );
} finally {
  await browser.close();
}
