import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(process.env.SPRINE_URL ?? 'http://127.0.0.1:5183/');
  await page.waitForFunction(() => window.__ticks > 2);
  const source = JSON.parse(readFileSync('fixtures/spine-import/skeleton.json'));
  const json = (raw) => ({
    name: 'skeleton.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(raw)),
  });
  const atlas = {
    name: 'atlas.atlas',
    mimeType: 'text/plain',
    buffer: readFileSync('fixtures/spine-import/atlas.atlas'),
  };
  // Local authored test pixels: asymmetric colors expose flipped/rotated atlas mistakes.
  const encoded = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 12;
    c.height = 8;
    const x = c.getContext('2d');
    x.fillStyle = '#ff3333';
    x.fillRect(0, 0, 4, 4);
    x.fillStyle = '#33ff33';
    x.fillRect(4, 0, 4, 4);
    x.fillStyle = '#3333ff';
    x.fillRect(0, 4, 4, 4);
    x.fillStyle = '#ffff33';
    x.fillRect(4, 4, 4, 4);
    const colors = ['red', 'lime', 'blue', 'yellow', 'cyan', 'magenta', 'white', 'black'];
    colors.forEach((color, i) => {
      x.fillStyle = color;
      x.fillRect(8 + (i % 4), Math.floor(i / 4), 1, 1);
    });
    return c.toDataURL().split(',')[1];
  });
  const image = { name: 'page.png', mimeType: 'image/png', buffer: Buffer.from(encoded, 'base64') };
  const save = async () => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    return JSON.parse(readFileSync(await (await pending).path()));
  };
  const chooseFiles = async (files) => {
    await page.getByRole('button', { name: 'Import Spine…', exact: true }).click();
    await page.getByLabel('Project files', { exact: true }).setInputFiles(files);
  };
  const original = await save();
  // Open recognizes skeleton JSON; missing assets and unsupported features preserve the old file.
  await page.locator('input[type=file]').first().setInputFiles(json(source));
  const dialog = page.getByRole('dialog', { name: 'Import Spine' });
  await dialog.waitFor();
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  await dialog
    .getByRole('alert')
    .filter({ hasText: /Missing image/ })
    .waitFor();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  assert.deepEqual(await save(), original, 'missing images preserve the previous project');
  const unsupported = structuredClone(source);
  unsupported.ik = [{ name: 'not-supported' }];
  await chooseFiles([json(unsupported), atlas, image]);
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  await dialog
    .getByRole('alert')
    .filter({ hasText: /ik is not supported/ })
    .waitFor();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  assert.deepEqual(await save(), original, 'unsupported semantics preserve the previous project');
  // Recover from missing assets in the dialog, then import the selected skin.
  await chooseFiles(json(source));
  await page.getByLabel('Spine assets', { exact: true }).setInputFiles([atlas, image]);
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  await page
    .locator('footer')
    .getByText(/Imported Spine skeleton/)
    .waitFor();
  const imported = await save();
  assert.equal(imported.artboards[0].nodes[0].skeleton.bones.length, 2);
  assert.equal(imported.artboards[0].nodes[0].animations.length, 1);
  assert.equal(Object.keys(imported.assetManifest).length, 2);
  const rgba = await page.evaluate(async (url) => {
    const i = new Image();
    i.src = url;
    await i.decode();
    const c = document.createElement('canvas');
    c.width = i.width;
    c.height = i.height;
    const x = c.getContext('2d');
    x.drawImage(i, 0, 0);
    return {
      width: i.width,
      height: i.height,
      colors: [
        [1, 1],
        [2, 1],
        [1, 4],
        [0, 0],
      ].map(([a, b]) => [...x.getImageData(a, b, 1, 1).data]),
    };
  }, imported.assetManifest['spine:texture:badge'].dataUrl);
  assert.deepEqual(
    rgba,
    {
      width: 4,
      height: 6,
      colors: [
        [0, 255, 255, 255],
        [255, 0, 0, 255],
        [0, 0, 0, 255],
        [0, 0, 0, 0],
      ],
    },
    'rotated trim is reconstructed with correct orientation and transparent margins',
  );
  const canvas = page.locator('canvas');
  await page.getByRole('button', { name: 'Animate', exact: true }).click();
  await page.getByRole('button', { name: 'Bones', exact: true }).click();
  const before = await canvas.screenshot();
  await page
    .locator('.cursor-ew-resize')
    .first()
    .click({ position: { x: 80, y: 12 } });
  const after = await canvas.screenshot();
  assert(!before.equals(after), 'imported animation changes the rendered artwork');
  const scratch = resolve('packages/editor/.smoke/spine-import');
  mkdirSync(scratch, { recursive: true });
  await page.screenshot({ path: resolve(scratch, 'imported-animation.png') });
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles({
      name: 'imported.bbbproj',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(imported)),
    });
  await page
    .locator('footer')
    .getByText(/Opened imported.bbbproj/)
    .waitFor();
  assert.deepEqual(
    await save(),
    imported,
    'save/reopen preserves editable imported source and embedded artwork',
  );
  await chooseFiles([json(source), atlas, image]);
  await page.getByLabel('Spine skin', { exact: true }).selectOption('blue');
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  await page
    .locator('footer')
    .getByText(/Imported Spine skeleton/)
    .waitFor();
  const blue = await save();
  assert(blue.assetManifest['spine:texture:blue']);
  assert(!blue.assetManifest['spine:texture:badge']);
  await chooseFiles({
    name: 'original.spine',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('not-a-json-export'),
  });
  await page
    .locator('footer')
    .getByText(/Original .spine projects/)
    .waitFor();
  assert.deepEqual(await save(), blue, 'binary project rejection preserves the open rig');
  assert.deepEqual(errors, []);
  console.log(
    'PASS: Spine JSON import, skin fallback, rotated/trimmed atlas pixels, weighted animation, native save/reopen and atomic error handling.',
  );
} finally {
  await browser.close();
}
