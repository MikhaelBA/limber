import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
mkdirSync(join(here, 'previews'), { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } }),
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(process.env.SPRINE_URL ?? 'http://127.0.0.1:5196');
  await page.waitForFunction(() => window.__ticks > 2);
  await page.locator('input[type=file]').setInputFiles(join(here, 'Face-Performance.bbbproj'));
  await page
    .locator('footer')
    .getByText(/Opened Face-Performance.bbbproj/)
    .waitFor();
  await page.getByRole('button', { name: 'Animate', exact: true }).click();
  const animation = page.locator('select').filter({ has: page.locator('option', { hasText: /^Talking$/ }) });
  const canvas = page.locator('canvas').first();
  for (const [name, time] of [
    ['Talking', 0.4],
    ['Crying', 2.5],
    ['Head Tilt', 0.9],
    ['Laughing', 1.2],
  ]) {
    await animation.selectOption(name);
    await page
      .locator('.cursor-ew-resize')
      .first()
      .click({ position: { x: time * 100, y: 12 } });
    await page.waitForTimeout(150);
    await canvas.screenshot({
      path: join(here, 'previews', name.replaceAll(' ', '-').toLowerCase() + '.png'),
    });
  }
  assert.deepEqual(errors, []);
  writeFileSync(
    join(here, 'browser-validation.json'),
    JSON.stringify(
      { clips: ['Talking', 'Crying', 'Head Tilt', 'Laughing'], realEditorCanvas: true, errors },
      null,
      2,
    ) + '\n',
  );
  console.log('Four facial clips rendered on the real editor canvas.');
} finally {
  await browser.close();
}
