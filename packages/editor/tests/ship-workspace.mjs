import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
mkdirSync('packages/editor/.smoke', { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } }),
    errors = [];
  page.setDefaultTimeout(30000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(process.env.SPRINE_URL ?? 'http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__ticks > 2);
  await page.locator('input[accept=".bbbproj,.json,application/json"]').setInputFiles({
    name: 'reward.bbbproj',
    mimeType: 'application/json',
    buffer: readFileSync('fixtures/bbbproj-v3-reward.json'),
  });
  await page
    .locator('footer')
    .getByText(/Opened reward.bbbproj/)
    .waitFor();
  const download = async (name) => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name, exact: true }).click();
    const file = await pending;
    return { bytes: readFileSync(await file.path()), filename: file.suggestedFilename() };
  };
  const save = async () => JSON.parse((await download('Save')).bytes.toString());
  const before = await save();
  const sourceFaces = await page.evaluate(() => document.fonts.size);
  await page.getByRole('button', { name: 'Ship', exact: true }).click();
  assert(await page.getByRole('button', { name: 'Download .bbb', exact: true }).isDisabled());
  await page.getByRole('button', { name: 'Prepare native export', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="native-preview"]')?.dataset.ready === 'true',
  );
  await page.getByRole('button', { name: 'Pause native', exact: true }).click();
  const tick = await page.getByTestId('native-preview').getAttribute('data-tick');
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)));
  assert.equal(await page.getByTestId('native-preview').getAttribute('data-tick'), tick);
  await page.getByRole('button', { name: 'Step native', exact: true }).click();
  assert.equal(Number(await page.getByTestId('native-preview').getAttribute('data-tick')), Number(tick) + 1);
  await page.getByRole('button', { name: 'Stop native', exact: true }).click();
  assert.equal(await page.getByTestId('native-preview').getAttribute('data-tick'), '0');
  await page.getByText('Atlas inspection (1 pages)', { exact: true }).click();
  const atlas = page.getByRole('img', { name: 'Atlas page 1', exact: true });
  await atlas.waitFor();
  assert(await atlas.evaluate((image) => image.complete && image.naturalWidth > 0));
  const regions = page.getByRole('button', { name: /^Atlas region / });
  assert((await regions.count()) > 0);
  await regions.first().focus();
  await page.keyboard.press('Enter');
  const regionName = (await regions.first().getAttribute('aria-label')).slice('Atlas region '.length);
  assert.equal(await regions.first().getAttribute('stroke'), '#fbbf24');
  await page.getByLabel('Atlas inspection', { exact: true }).evaluate((details) => {
    details.open = false;
  });
  const originalPixels = await page.getByTestId('native-preview').locator('canvas').screenshot();
  const shipped = await download('Download .bbb'),
    debug = JSON.parse((await download('Download debug JSON')).bytes.toString());
  assert(shipped.filename.endsWith('.bbb'));
  assert.equal(debug.format, 'bonebybone-runtime');
  assert.equal(debug.version, 1);
  assert(debug.fonts.length > 0 && debug.atlasPages.length > 0);
  assert(!('editor' in debug) && !('assetManifest' in debug));
  assert(debug.fonts[0].license.text.includes('SIL OPEN FONT LICENSE'));
  assert.deepEqual(await save(), before, 'export/playback leaves authoring truth and selection unchanged');
  await page.getByText('Custom warning thresholds', { exact: true }).click();
  const memory = page.getByLabel('Ship limit textureBytes', { exact: true });
  await memory.fill('0');
  await memory.press('Tab');
  assert.equal(await page.getByLabel('Ship platform', { exact: true }).inputValue(), 'custom');
  await page.getByText('BUDGET_TEXTURE_BYTES', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Scene', exact: true }).click();
  await page.waitForFunction((expected) => document.fonts.size === expected, sourceFaces);
  await page.getByRole('button', { name: 'Ship', exact: true }).click();
  assert.equal(await page.getByLabel('Ship platform', { exact: true }).inputValue(), 'custom');
  await page.getByText('Custom warning thresholds', { exact: true }).click();
  assert.equal(await memory.inputValue(), '0');
  await page
    .getByLabel('Open native asset', { exact: true })
    .setInputFiles({ name: 'reloaded.bbb', mimeType: 'application/octet-stream', buffer: shipped.bytes });
  await page.waitForFunction(
    () => document.querySelector('[data-testid="native-preview"]')?.dataset.ready === 'true',
  );
  await page.getByRole('button', { name: 'Pause native', exact: true }).click();
  await page.getByRole('button', { name: 'Stop native', exact: true }).click();
  const reloadedPixels = await page.getByTestId('native-preview').locator('canvas').screenshot();
  assert(originalPixels.equals(reloadedPixels), 'download→upload uses the same actual packaged pixels');
  await page
    .getByLabel('Open native asset', { exact: true })
    .setInputFiles({ name: 'bad.bbb', mimeType: 'application/octet-stream', buffer: Buffer.from('invalid') });
  await page
    .locator('footer')
    .getByText(/Native open failed/)
    .waitFor();
  assert(
    (await download('Download .bbb')).bytes.equals(shipped.bytes),
    'failed native open retains the last validated publication',
  );
  assert.deepEqual(await save(), before);

  // Hold real worker font I/O to verify owned active cancellation through the Ship controls.
  let release, entered;
  const requested = new Promise((resolve) => {
    entered = resolve;
  });
  await page.route('**/fonts/NotoSansArabic.ttf', async (route) => {
    entered();
    await new Promise((resolve) => {
      release = resolve;
    });
    try {
      await route.continue();
    } catch {
      /* Request was cancelled with its worker. */
    }
  });
  await page.getByRole('button', { name: 'Prepare native export', exact: true }).click();
  await requested;
  await page.getByRole('button', { name: 'Cancel native export', exact: true }).click();
  await page.locator('footer').getByText('Native export cancelled.', { exact: true }).waitFor();
  release();
  await page.unroute('**/fonts/NotoSansArabic.ttf');
  assert(await page.getByRole('button', { name: 'Prepare native export', exact: true }).isEnabled());
  assert.deepEqual(await save(), before);
  await page.getByRole('button', { name: 'Scene', exact: true }).click();
  await page.waitForFunction((expected) => document.fonts.size === expected, sourceFaces);
  assert.deepEqual(errors, []);
  writeFileSync(
    'packages/editor/.smoke/ship-workspace.json',
    JSON.stringify(
      {
        name: debug.name,
        pages: debug.atlasPages.length,
        fonts: debug.fonts.length,
        regionName,
        sourceUnchanged: true,
        exactReloadPixels: true,
        cancellation: true,
        savedCustomBudget: true,
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS: Ship worker→packaged preview→.bbb/debug download→actual reload pixels, play/pause/step/stop, keyboard atlas inspection, persisted custom warnings, rejected native file ownership and active font-I/O cancellation.',
  );
} finally {
  await browser.close();
}
