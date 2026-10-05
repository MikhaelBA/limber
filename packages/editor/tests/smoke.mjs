// Phase 2 smoke test (DESIGN.md §8.7): boots the editor in real Chromium,
// captures console errors, drives the bone workflow end-to-end, and saves
// screenshots for visual inspection. Run: node tests/smoke.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.SPRINE_URL ?? 'http://localhost:5173/';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '.smoke');
mkdirSync(OUT, { recursive: true });

const log = (...a) => process.stdout.write(`[smoke] ${a.join(' ')}\n`);
let failed = false;
const fail = (msg) => {
  process.stdout.write(`[smoke] FAIL: ${msg}\n`);
  failed = true;
};

log('starting; OUT=', OUT);
// HEADLESS=0 runs the probe with a real GPU (TODO.md gotcha #2: ANGLE/D3D11
// does not tolerate what SwiftShader shrugs off — always verify rendering changes headed).
const browser = await chromium.launch({ headless: process.env.HEADLESS !== '0' });
log('browser launched');
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(15000);
log('page created');

const consoleErrors = [];
// Headed browsers request the favicon outside the page network stack; if it
// 404s the generic console error is environment noise, not an app failure.
let sawFavicon404 = false;
page.on('response', (res) => {
  if (res.status() === 404 && res.url().endsWith('/favicon.ico')) sawFavicon404 = true;
});
page.on('console', (msg) => {
  const text = msg.text();
  // SwiftShader/StrictMode destroy noise — not app failures either.
  if (msg.type() === 'error' && /404/.test(text) && sawFavicon404) return;
  if (msg.type() === 'error' && !/shader|WebGL context/i.test(text)) consoleErrors.push(text);
});
page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

const shot = (name) => page.screenshot({ path: join(OUT, name) });
const boneCount = () =>
  page.evaluate(() => document.body.innerText.match(/(\d+) bones/)?.[1] ?? '?');

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 20000 });
log('page loaded');
await page.waitForTimeout(2500);

// 1. App mounted with panels and a live Pixi ticker.
const mounted = await page.evaluate(() => ({
  rootChildren: document.getElementById('root')?.children.length ?? -1,
  ticks: window.__ticks ?? -1,
  limberState: window.__limber ?? 'unset',
}));
if (mounted.rootChildren === 0) fail(`React did not mount: ${JSON.stringify(mounted)}`);
else log(`app mounted (pixi=${mounted.limberState}, ticks=${mounted.ticks})`);
await shot('01-initial.png');
log('screenshot 01 saved');

// 2. Hierarchy shows the default root bone.
const hierarchy = page.getByText('Hierarchy').first();
if (!(await hierarchy.isVisible())) fail('Hierarchy panel not visible');
const rootBoneRow = page.getByText('root', { exact: true }).first();
if (!(await rootBoneRow.isVisible())) fail('root bone not listed in hierarchy');
else log('hierarchy lists root bone');

// 3. Create bones with the Bone tool: click toolbar, then the canvas twice.
await page.getByRole('button', { name: /Bone/ }).click();
log('bone tool activated');
const canvas = page.locator('canvas').first();
const box = await canvas.boundingBox();
if (!box) fail('viewport canvas not found');
await canvas.click({ position: { x: box.width * 0.55, y: box.height * 0.4 } });
await canvas.click({ position: { x: box.width * 0.7, y: box.height * 0.6 } });
await page.waitForTimeout(500);
await shot('02-bones-created.png');
const afterCreate = await boneCount();
log('bones after create:', afterCreate);
if (afterCreate !== '3') fail(`expected 3 bones after two clicks, got ${afterCreate}`);

// 4. Undo twice via keyboard — created bones disappear, root remains.
await page.keyboard.press('Control+z');
await page.keyboard.press('Control+z');
await page.waitForTimeout(400);
const afterUndo = await boneCount();
log('bones after undo x2:', afterUndo);
if (afterUndo !== '1') fail(`expected 1 bone after undo x2, got ${afterUndo}`);

// 5. Redo once.
await page.keyboard.press('Control+y');
await page.waitForTimeout(300);
const afterRedo = await boneCount();
if (afterRedo !== '2') fail(`expected 2 bones after redo, got ${afterRedo}`);
else log('undo/redo verified');

// 6. Select tool: click a bone — selection indicator + properties panel.
await page.getByRole('button', { name: /Select/ }).click();
await canvas.click({ position: { x: box.width * 0.55, y: box.height * 0.4 } });
await page.waitForTimeout(400);
await shot('03-selected.png');
const selected = await page.evaluate(() => document.body.innerText.includes('◉'));
log('selection indicator shown:', selected);
if (!selected) fail('no selection indicator after clicking a bone');

// 7. Edit rotation through the properties panel (X, Y, then Rot ° fields).
const rotField = page.locator('input[type="number"]').nth(2);
if ((await rotField.count()) > 0) {
  await rotField.fill('45');
  await rotField.press('Enter');
  await page.waitForTimeout(300);
  await shot('04-rotated.png');
  log('rotation edited to 45deg');
} else {
  fail('properties panel number fields not found');
}

// 8. Phase 3 — animation workflow: create an animation, enter Animate mode,
//    auto-key a drag, then play. (Runs BEFORE pan/zoom so viewport click
//    coordinates still hit the bones.)
await page.getByRole('button', { name: 'Animate' }).click();
await page.waitForTimeout(300);
const animOptions = await page.locator('select option').allTextContents();
log('animations after Animate bootstrap:', JSON.stringify(animOptions));
if (!animOptions.some((t) => t.includes('animation'))) fail('Animate mode did not bootstrap an animation');

// Select a bone in the viewport and drag it — auto-key writes x/y keys.
await canvas.click({ position: { x: box.width * 0.55, y: box.height * 0.4 } });
await page.mouse.down();
await page.mouse.move(box.x + box.width * 0.55 + 60, box.y + box.height * 0.4 - 30, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(400);
await shot('06-autokeyed.png');
const diamonds = await page.locator('[class*="rotate-45"]').count();
log('keyframe diamonds visible:', diamonds);
if (diamonds < 2) fail(`expected keyframe diamonds after auto-key drag, got ${diamonds}`);

// Undo removes the keys again.
await page.keyboard.press('Control+z');
await page.waitForTimeout(300);
const diamondsAfterUndo = await page.locator('[class*="rotate-45"]').count();
if (diamondsAfterUndo !== 0) fail(`undo should remove auto-keyed diamonds, got ${diamondsAfterUndo}`);
else log('auto-key undo verified');

// Redo, then play briefly via Space.
await page.keyboard.press('Control+y');
await page.waitForTimeout(300);
const timeline = await page.getByText('Timeline').first().isVisible();
if (!timeline) fail('timeline panel missing');
await page.keyboard.press(' ');
await page.waitForTimeout(700);
await page.keyboard.press(' ');
await page.waitForTimeout(300);
await shot('07-played.png');
log('play/pause via Space executed');

// 9. Back to Setup mode, then pan (middle mouse) and zoom (wheel).
await page.getByRole('button', { name: /Setup/ }).click();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down({ button: 'middle' });
await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 40, { steps: 4 });
await page.mouse.up({ button: 'middle' });
await page.mouse.wheel(0, -240);
await page.waitForTimeout(400);
await shot('05-panzoom.png');
log('pan/zoom executed');

// 10. Phase 4 — drop an image file onto the viewport: texture registers, a
//     slot + region attachment appear bound to the selected bone (root), and
//     the sprite follows the bone. File dialogs are unsupported in automation,
//     so the drop is synthesized via DataTransfer (evaluate).
await rootBoneRow.click(); // Select the root bone (drop targets the selection).
await page.waitForTimeout(200);
const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
const pngFile = await page.evaluateHandle(async () => {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#e0533f';
  g.fillRect(0, 0, 64, 32);
  g.fillStyle = '#3f7ee0';
  g.fillRect(8, 8, 20, 12);
  const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
  return new File([blob], 'spot.png', { type: 'image/png' });
});
await dataTransfer.evaluateHandle((dt, f) => {
  dt.items.add(f);
  return dt;
}, pngFile);
await canvas.dispatchEvent('drop', { dataTransfer, bubbles: true, cancelable: true });
log('drop dispatched');
await page.waitForFunction(() => window.__slotMeshes === 1, null, { timeout: 10000 }).catch(() => {});
await page.waitForTimeout(600);
const meshes = await page.evaluate(() => window.__slotMeshes ?? -1);
const mesh0 = await page.evaluate(() => window.__slotMesh0 ?? null);
log('slot meshes after drop:', meshes, 'first vertex:', JSON.stringify(mesh0));
if (meshes !== 1) fail(`expected 1 slot mesh after drop, got ${meshes}`);
if (!Array.isArray(mesh0) || mesh0.length !== 2) fail(`expected a visible slot mesh position, got ${JSON.stringify(mesh0)}`);
await shot('08-dropped.png');

// The sprite must follow the bone: select root, move it via X, re-read vertex.
await rootBoneRow.click();
await page.waitForTimeout(200);
const xField = page.locator('input[type="number"]').nth(0);
await xField.fill('120');
await xField.press('Enter');
await page.waitForTimeout(400);
const mesh0Moved = await page.evaluate(() => window.__slotMesh0 ?? null);
log('first vertex after bone X=120:', JSON.stringify(mesh0Moved));
const dx = Array.isArray(mesh0Moved) && Array.isArray(mesh0) ? mesh0Moved[0] - mesh0[0] : NaN;
if (!(Math.abs(dx - 120) < 1.5)) fail(`sprite did not follow the bone: dx=${dx}`);
else log('sprite-follows-bone verified');

// Undo removes everything: first the X edit, then the whole drop (one
// composite command). Redo restores both.
await page.keyboard.press('Control+z'); // undo SetBoneProps (X=120)
await page.waitForTimeout(200);
await page.keyboard.press('Control+z'); // undo the drop composite
await page.waitForTimeout(300);
const meshesAfterUndo = await page.evaluate(() => window.__slotMeshes ?? -1);
if (meshesAfterUndo !== 0) fail(`undo should remove the dropped slot mesh, got ${meshesAfterUndo}`);
await page.keyboard.press('Control+y');
await page.waitForTimeout(200);
await page.keyboard.press('Control+y');
await page.waitForTimeout(300);
const meshesAfterRedo = await page.evaluate(() => window.__slotMeshes ?? -1);
if (meshesAfterRedo !== 1) fail(`redo should restore the dropped slot mesh, got ${meshesAfterRedo}`);
else log('drop undo/redo verified');
await shot('09-redropped.png');

// 11. Phase 5 — convert the slot to a grid mesh: the same texture now renders
//     through the skinning cache as a 3×3-vertex mesh.
// After the double undo/redo the slot selection was cleared — re-select it.
await page.locator('span', { hasText: /^slot@root$/ }).first().click();
await page.waitForTimeout(200);
await page.getByRole('button', { name: 'Grid mesh' }).click();
await page.waitForTimeout(500);
const meshVerts = await page.evaluate(() => window.__slotMeshVerts0 ?? -1);
log('grid mesh vertices rendering:', meshVerts);
if (meshVerts !== 9) fail(`expected 9 grid-mesh vertices after convert, got ${meshVerts}`);
await shot('10-gridmesh.png');

if (consoleErrors.length) fail(`console errors: ${JSON.stringify(consoleErrors.slice(0, 5))}`);
else log('no console errors');

await browser.close();
process.stdout.write(`[smoke] DONE ${failed ? 'WITH FAILURES' : '— all checks passed'}\n`);
process.exit(failed ? 1 : 0);
