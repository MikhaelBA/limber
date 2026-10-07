import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: process.env.HEADLESS !== '0' });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(process.env.SPRINE_URL ?? 'http://localhost:5173/');
  await page.waitForFunction(() => window.__ticks > 2);
  const original = JSON.parse(readFileSync('fixtures/bbbproj-v3-reward.json', 'utf8'));
  const open = async (project) => {
    await page.locator('input[accept=".bbbproj,.json,application/json"]').setInputFiles({
      name: 'reward.bbbproj',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(project)),
    });
    await page.getByText(/Opened reward.bbbproj/).waitFor();
    await page.getByTestId('scene-canvas').locator('canvas').waitFor();
    await page.getByRole('button', { name: 'Game UI', exact: true }).click();
  };
  const save = async () => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    return JSON.parse(readFileSync(await (await pending).path(), 'utf8'));
  };
  const canvas = page.getByTestId('scene-canvas').locator('canvas');
  const near = (actual, expected) => expected.every((value, i) => Math.abs(value - actual[i]) < 8);
  await open(original);
  await page.getByRole('button', { name: 'Fit artboard', exact: true }).click();
  for (const [i, width, height, safe] of [
    [0, 390, 844, [0, 0, 47, 34]],
    [1, 844, 390, [47, 47, 0, 21]],
    [2, 1024, 768, [0, 0, 24, 20]],
    [3, 1280, 720, [0, 0, 0, 0]],
  ]) {
    await page.getByRole('combobox', { name: 'Device preset' }).selectOption(String(i));
    await page.getByRole('button', { name: 'Fit artboard', exact: true }).click();
    const pixels = await page.evaluate(
      async ({ data, width, height, safe }) => {
        const image = new Image();
        image.src = `data:image/png;base64,${data}`;
        await image.decode();
        const c = document.createElement('canvas');
        c.width = image.width;
        c.height = image.height;
        const context = c.getContext('2d');
        context.drawImage(image, 0, 0);
        const scale = Math.min(16, (c.width - 80) / width, (c.height - 80) / height),
          popupWidth = Math.min(480, width - safe[0] - safe[1] - 32),
          cx = c.width / 2 + ((safe[0] - safe[1]) / 2) * scale,
          cy = c.height / 2 + ((safe[2] - safe[3]) / 2) * scale;
        const sample = (x, y) =>
          Array.from(context.getImageData(Math.round(x), Math.round(y), 1, 1).data).slice(0, 3);
        return {
          corner: sample(cx - (popupWidth / 2) * scale + 4 * scale, cy - 120 * scale + 4 * scale),
          center: sample(cx, cy),
        };
      },
      { data: (await canvas.screenshot()).toString('base64'), width, height, safe },
    );
    assert.ok(near(pixels.corner, [247, 200, 91]), `Preset ${i}: corner pixels retained (${pixels.corner})`);
    assert.ok(near(pixels.center, [38, 43, 58]), `Preset ${i}: panel center preserved (${pixels.center})`);
    await canvas.screenshot({ path: `packages/editor/.smoke/reward-${i}.png` });
  }
  await page.getByRole('combobox', { name: 'Localization preview' }).selectOption('long');
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="scene-canvas"]').dataset.textOverflow.includes('reward-title'),
  );
  assert.equal(
    (await save()).artboards[0].nodes.find((n) => n.type === 'text').text,
    original.artboards[0].nodes.find((n) => n.type === 'text').text,
  );
  await page.getByRole('combobox', { name: 'Localization preview' }).selectOption('expected');
  await page.getByRole('button', { name: 'claim-button instance', exact: true }).click();
  const override = page.getByRole('textbox', { name: 'Override label', exact: true });
  await override.fill('دریافت جایزه');
  await override.press('Tab');
  let saved = await save();
  assert.equal(saved.artboards[0].nodes.find((n) => n.type === 'instance').overrides.label, 'دریافت جایزه');
  await open(saved);
  assert.deepEqual((await save()).artboards, saved.artboards);
  assert.deepEqual((await save()).components, saved.components);
  await page.getByText('Components', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Component node', exact: true }).selectOption('button-label');
  const definitionText = page.getByRole('textbox', { name: 'UI text', exact: true });
  await definitionText.fill('Default changed');
  await definitionText.press('Tab');
  saved = await save();
  assert.equal(saved.components[0].nodes.find((n) => n.id === 'button-label').text, 'Default changed');
  assert.equal(saved.artboards[0].nodes.find((n) => n.type === 'instance').overrides.label, 'دریافت جایزه');
  await page.getByRole('button', { name: 'Add instance', exact: true }).click();
  assert.equal((await save()).artboards[0].nodes.filter((n) => n.type === 'instance').length, 2);
  await page.getByText('Components', { exact: true }).click();
  const masked = structuredClone(original),
    board = masked.artboards[0];
  board.width = 400;
  board.height = 400;
  delete board.safeArea;
  const base = (id, type, parentId = null) => ({
    id,
    name: id,
    type,
    parentId,
    transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0, pivotX: 0, pivotY: 0 },
    opacity: 1,
    visible: true,
  });
  board.nodes = [
    { ...base('mask-a', 'mask'), width: 160, height: 100 },
    { ...base('mask-b', 'mask', 'mask-a'), width: 80, height: 160 },
    { ...base('masked-red', 'shape', 'mask-b'), width: 240, height: 240, radius: 0, color: 0xff0000 },
  ];
  board.nodes[1].transform.x = 30;
  await open(masked);
  await page.getByRole('button', { name: 'Fit artboard', exact: true }).click();
  const maskPixels = await page.evaluate(
    async (data) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const c = document.createElement('canvas');
      c.width = image.width;
      c.height = image.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(image, 0, 0);
      const scale = Math.min((c.width - 80) / 400, (c.height - 80) / 400),
        sample = (x, y) =>
          Array.from(
            ctx.getImageData(Math.round(c.width / 2 + x * scale), Math.round(c.height / 2 + y * scale), 1, 1)
              .data,
          ).slice(0, 3);
      return { inside: sample(0, 0), outsideInner: sample(-30, 0), outsideOuter: sample(0, 70) };
    },
    (await canvas.screenshot()).toString('base64'),
  );
  assert.ok(near(maskPixels.inside, [255, 0, 0]));
  assert.ok(near(maskPixels.outsideInner, [32, 36, 44]));
  assert.ok(near(maskPixels.outsideOuter, [32, 36, 44]));
  const bounds = await canvas.boundingBox(),
    scale = Math.min((bounds.width - 80) / 400, (bounds.height - 80) / 400);
  await page.mouse.click(bounds.x + bounds.width / 2 - 30 * scale, bounds.y + bounds.height / 2);
  assert.equal(
    await page.getByRole('textbox', { name: 'Scene name', exact: true }).inputValue(),
    'mask-a',
    'Clipped child cannot be selected outside its mask',
  );
  await canvas.screenshot({ path: 'packages/editor/.smoke/ui-masks.png' });
  await page.getByRole('button', { name: 'Add reward template', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('[aria-label="Active artboard"]')?.options.length === 2,
  );
  assert.equal(
    (await save()).components.length,
    2,
    'Template merges fresh IDs without replacing the current project',
  );
  await page.getByRole('button', { name: 'reward-popup group', exact: true }).click();
  await page.getByText('Components', { exact: true }).click();
  await page.getByRole('button', { name: 'Make component from selection', exact: true }).click();
  saved = await save();
  const active = saved.artboards.find((board) => board.id === saved.editor.activeArtboardId);
  assert.equal(active.nodes.length, 1);
  const outer = saved.components.find((component) => component.id === active.nodes[0].componentId);
  const nested = saved.components.find(
    (component) => component.id === outer.nodes.find((node) => node.type === 'instance').componentId,
  );
  assert.deepEqual(
    outer.nodes.find((node) => node.type === 'nineSlice').borders,
    original.artboards[0].nodes.find((node) => node.type === 'nineSlice').borders,
  );
  await page.getByRole('combobox', { name: 'Component definition', exact: true }).selectOption(nested.id);
  await page
    .getByRole('combobox', { name: 'Component node', exact: true })
    .selectOption(nested.nodes.find((node) => node.type === 'shape').id);
  const fill = page.getByLabel('UI fill', { exact: true });
  await fill.fill('#33cc66');
  await fill.press('Tab');
  await page.getByText('Components', { exact: true }).click();
  const nestedPixel = await page.evaluate(
    async (data) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const c = document.createElement('canvas');
      c.width = image.width;
      c.height = image.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(image, 0, 0);
      const scale = Math.min((c.width - 80) / 390, (c.height - 80) / 844);
      return Array.from(
        ctx.getImageData(Math.round(c.width / 2 - 70 * scale), Math.round(c.height / 2 + 66.5 * scale), 1, 1)
          .data,
      ).slice(0, 3);
    },
    (await canvas.screenshot()).toString('base64'),
  );
  assert.ok(
    near(nestedPixel, [51, 204, 102]),
    `Nested definition edits propagate to rendered instances (${nestedPixel})`,
  );
  const rtl = await page.evaluate(async () => {
    const { ensureUIFonts, rasterizeUIText } = await import('/src/rendering/UITextAdapter.ts');
    await ensureUIFonts();
    const node = {
      text: 'پاداش ۱۲۳ — Level 7',
      fontFamilies: ['Noto Sans Arabic'],
      fontSize: 28,
      lineHeight: 40,
      direction: 'rtl',
      align: 'start',
      color: 0xffffff,
    };
    return rasterizeUIText(node, { width: 360, height: 60 }).canvas.toDataURL();
  });
  const actual = Buffer.from(rtl.split(',')[1], 'base64');
  const path = 'fixtures/ui-rtl-v1.png';
  if (process.env.UPDATE_UI_GOLDEN === '1') writeFileSync(path, actual);
  const difference = await page.evaluate(
    async ({ actual, expected }) => {
      const decode = async (data) => {
        const image = new Image();
        image.src = `data:image/png;base64,${data}`;
        await image.decode();
        const c = document.createElement('canvas');
        c.width = image.width;
        c.height = image.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(image, 0, 0);
        return { width: c.width, height: c.height, pixels: ctx.getImageData(0, 0, c.width, c.height).data };
      };
      const a = await decode(actual),
        b = await decode(expected);
      if (a.width !== b.width || a.height !== b.height) return 1;
      let changed = 0;
      for (let i = 0; i < a.pixels.length; i += 4)
        if (Math.abs(a.pixels[i + 3] - b.pixels[i + 3]) > 16) changed++;
      return changed / (a.width * a.height);
    },
    { actual: actual.toString('base64'), expected: readFileSync(path).toString('base64') },
  );
  assert.ok(difference < 0.015, `RTL golden changed: ${difference * 100}%`);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: reward at four aspect ratios, nine-slice corners, localization isolation, component edits/overrides, nested masks/picking, additive template, RTL golden',
  );
} finally {
  await browser.close();
}
