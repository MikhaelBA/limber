// Verifies the DOCKERIZED build (nginx on :8080) boots and renders bones —
// catches production-build-only regressions the dev-server smoke can't.
import { chromium } from 'playwright';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '.smoke');
const URL = process.env.SPRINE_URL ?? 'http://localhost:8080/';
const log = (m) => process.stdout.write(`[docker] ${m}\n`);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 150)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 150));
});
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(2500);
const state = await page.evaluate(() => ({
  rootChildren: document.getElementById('root')?.children.length ?? -1,
  canvases: document.querySelectorAll('canvas').length,
  buttons: document.querySelectorAll('button').length,
}));
await page.screenshot({ path: join(OUT, 'docker-verify.png') });
log(JSON.stringify(state));
if (state.rootChildren === 0 || state.canvases === 0) {
  log('FAIL: app did not mount');
  process.exitCode = 1;
} else if (errors.length) {
  log(`FAIL: console errors: ${JSON.stringify(errors.slice(0, 3))}`);
  process.exitCode = 1;
} else {
  log('OK — dockerized app mounts, no console errors');
}
await browser.close();
