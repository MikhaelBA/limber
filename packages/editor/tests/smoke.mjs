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

// 6. Translate tool: click a bone — selection indicator + properties panel.
await page.getByRole('button', { name: /Translate/ }).click();
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

// 12. Phase 5 chunk 2 — hull mesh: undo the grid mesh (slot shows the region
//     again), Mesh tool, click 4 hull points, close on the first point.
await page.keyboard.press('Control+z'); // undo AddMeshCommand
await page.waitForTimeout(300);
const regionVerts = await page.evaluate(() => window.__slotMeshVerts0 ?? -1);
if (regionVerts !== 4) fail(`expected the region quad back after undo, got ${regionVerts}`);
else log('grid mesh undone — region restored');
await page.locator('span', { hasText: /^slot@root$/ }).first().click();
await page.waitForTimeout(200);
await page.keyboard.press('m'); // Mesh tool
await page.waitForTimeout(200);
const toScreen = async (wx, wy) => page.evaluate(([x, y]) => window.__worldToScreen(x, y), [wx, wy]);
const tlw = await page.evaluate(() => window.__slotMesh0 ?? null); // world TL of the 64×32 region
if (!Array.isArray(tlw)) fail(`lost the region position: ${JSON.stringify(tlw)}`);
const corners = [
  [tlw[0], tlw[1]],
  [tlw[0] + 64, tlw[1]],
  [tlw[0] + 64, tlw[1] + 32],
  [tlw[0], tlw[1] + 32],
];
for (const [wx, wy] of corners) {
  const [sx, sy] = await toScreen(wx, wy);
  await page.mouse.click(sx, sy);
  await page.waitForTimeout(120);
}
const [fx, fy] = await toScreen(tlw[0], tlw[1]);
await page.mouse.click(fx + 3, fy + 3); // click near the first point → close the hull
await page.waitForTimeout(500);
const hullVerts = await page.evaluate(() => window.__slotMeshVerts0 ?? -1);
log('hull mesh vertices rendering:', hullVerts);
if (hullVerts !== 4) fail(`expected a 4-vertex hull mesh, got ${hullVerts}`);
else log('hull mesh drawn and closed on the first vertex');
await shot('11-hullmesh.png');

// 13. Deform auto-key: Animate mode, drag a hull vertex — one deform keyframe
//     must appear at the playhead and the mesh must follow through skinning.
await page.getByRole('button', { name: /Animate/ }).click();
await page.waitForTimeout(400);
const [bxs, bys] = await toScreen(corners[2][0], corners[2][1]); // BR vertex
await page.mouse.move(bxs, bys);
await page.mouse.down();
await page.mouse.move(bxs + 30, bys - 20, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(500);
const deformKeys = await page.evaluate(() => window.__deformKeyframes ?? -1);
log('deform keyframes after animate-mode drag:', deformKeys);
if (deformKeys < 1) fail(`expected >=1 deform keyframe after the drag, got ${deformKeys}`);
else log('deform auto-key verified');
await shot('12-deform-keyed.png');

// 13.5 Spine parity — Rotate tool: dragging in EMPTY SPACE adjusts the
//      selected bone; a swing around the root must change its world angle.
await page.getByRole('button', { name: /Setup/ }).click();
await page.waitForTimeout(300);
await rootBoneRow.click();
await page.waitForTimeout(200);
await page.keyboard.press('c'); // Rotate tool
await page.waitForTimeout(150);
const angleBefore = await page.evaluate(() => window.__boneAngle0 ?? NaN);
const [ex1, ey1] = await toScreen(0, 150); // empty space far from any bone
const [ex2, ey2] = await toScreen(300, 150);
await page.mouse.move(ex1, ey1);
await page.mouse.down();
await page.mouse.move(ex2, ey2, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(400);
const angleAfter = await page.evaluate(() => window.__boneAngle0 ?? NaN);
log('root angle before/after empty-space rotate drag:', angleBefore, '→', angleAfter);
if (!(Math.abs(angleAfter - angleBefore) > 0.3)) {
  fail(`empty-space rotate drag should swing the selected bone, got ${angleBefore} → ${angleAfter}`);
} else log('rotate tool (empty-space drag) verified');
await page.keyboard.press('v'); // back to Translate for the IK step
await shot('12b-rotate-tool.png');

// 14. IK — add a constraint on the root bone (1-bone chain + auto target at
//     the tip), then drag the target: the root must rotate to follow it.
await page.getByRole('button', { name: /Setup/ }).click();
await page.waitForTimeout(300);
await rootBoneRow.click();
await page.waitForTimeout(200);
await page.getByRole('button', { name: '＋ Add IK' }).click();
await page.waitForTimeout(300);
const ikRow = page.locator('span', { hasText: /^⚙ root ⇢ root-ik$/ }).first();
if (!(await ikRow.count())) fail('IK row (root ⇢ root-ik) not visible in the hierarchy');
else log('IK constraint listed in hierarchy');
await page.keyboard.press('v'); // Translate tool — bones draggable again.
const target0 = await page.evaluate(() => window.__ikTarget0 ?? null); // root moved earlier — read the live position.
if (!Array.isArray(target0)) fail(`no __ikTarget0 exposed: ${JSON.stringify(target0)}`);
const [tx0, ty0] = await toScreen(target0[0], target0[1]);
await page.mouse.move(tx0, ty0);
await page.mouse.down();
await page.mouse.move(tx0 + 40, ty0 + 30, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(400);
const { rootAngle, expectedAngle } = await page.evaluate(() => {
  const t = window.__ikTarget0 ?? [0, 0];
  const o = window.__boneOrigin0 ?? [0, 0];
  return {
    rootAngle: window.__boneAngle0 ?? NaN,
    expectedAngle: Math.atan2(t[1] - o[1], t[0] - o[0]),
  };
});
log('root world angle after target drag:', rootAngle, 'expected:', expectedAngle);
if (!(Math.abs(rootAngle - expectedAngle) < 0.01)) {
  fail(`root should point at the live IK target (${expectedAngle.toFixed(3)}) after the drag, got ${rootAngle}`);
} else log('IK target drag verified — chain follows');
await shot('13-ik-follow.png');

// 15. Autosave — after the debounce window, IndexedDB must hold the document
//     (with its bones) as a crash-safe record.
await page.waitForTimeout(2200);
const autosaved = await page.evaluate(
  () =>
    new Promise((res) => {
      const rq = indexedDB.open('limber-autosave');
      rq.onsuccess = () => {
        const db = rq.result;
        try {
          const get = db.transaction('kv').objectStore('kv').get('current');
          get.onsuccess = () =>
            res(!!get.result && typeof get.result.json === 'string' && get.result.json.includes('"bones"'));
          get.onerror = () => res(null);
        } catch {
          res(null);
        }
      };
      rq.onerror = () => res(null);
    }),
);
if (autosaved !== true) fail('autosave record not found in IndexedDB');
else log('autosave verified in IndexedDB');

// 16. Event keying — Animate mode, type a name, key it, verify the dopesheet row.
await page.getByRole('button', { name: /Animate/ }).click();
await page.waitForTimeout(300);
await page.locator('input[title="Event name"]').fill('boom');
await page.getByRole('button', { name: /⚡ Event/ }).click();
await page.waitForTimeout(300);
const eventKeys = await page.evaluate(() => window.__eventKeys ?? -1);
log('event keyframes after keying:', eventKeys);
if (eventKeys < 1) fail(`expected >=1 event keyframe after keying, got ${eventKeys}`);
else log('event keying verified');
await shot('14-event-keyed.png');

// 17. Ghosting — toggle with G in Animate mode: future ghosts (past depends on
//     the playhead) must evaluate; toggling off clears them.
await page.keyboard.press('g');
await page.waitForTimeout(400);
const ghostsOn = await page.evaluate(() => window.__ghostCount ?? -1);
log('ghosts drawn after G:', ghostsOn);
if (ghostsOn < 3) fail(`expected >=3 ghosts (future side) after enabling ghosting, got ${ghostsOn}`);
else log('ghosting enabled — outlines drawn');
await shot('15-ghosting.png');
await page.keyboard.press('g');
await page.waitForTimeout(300);
const ghostsOff = await page.evaluate(() => window.__ghostCount ?? -1);
if (ghostsOff !== 0) fail(`ghosts should clear after toggling off, got ${ghostsOff}`);
else log('ghosting toggled off cleanly');

if (consoleErrors.length) fail(`console errors: ${JSON.stringify(consoleErrors.slice(0, 5))}`);
else log('no console errors');

await browser.close();
process.stdout.write(`[smoke] DONE ${failed ? 'WITH FAILURES' : '— all checks passed'}\n`);
process.exit(failed ? 1 : 0);
