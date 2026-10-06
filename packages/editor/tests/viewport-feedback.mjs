// Regression: input must draw even when both rAF and the watchdog are stalled.
// Run against the dev server: node packages/editor/tests/viewport-feedback.mjs
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: process.env.HEADLESS !== '0' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => raf((time) => {
      if (!window.freezeFrames) cb(time);
    });
    const interval = window.setInterval.bind(window);
    window.setInterval = (cb, delay, ...args) => interval(() => {
      if (!window.freezeFrames) cb(...args);
    }, delay);
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, options) {
      return getContext.call(this, type, /webgl/.test(type)
        ? { ...options, preserveDrawingBuffer: true } : options);
    };
  });
  await page.goto(process.env.SPRINE_URL ?? 'http://localhost:5173/');
  await page.waitForFunction(() => window.__ticks > 2);
  const fixture = {
    version: 2,
    skeleton: {
      bones: [{ id: 'root', name: 'root', parentId: null, length: 80,
        setupPose: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 } }],
      slots: [{ id: 'slot', name: 'test-mesh', boneId: 'root', defaultAttachmentId: 'mesh', color: 0xffffffff, blendMode: 'normal' }],
      attachments: [{ id: 'mesh', name: 'mesh', type: 'mesh', textureId: 'missing',
        meshVertices: [-100, 80, 100, 80, 100, 240, -100, 240],
        meshUVs: [0, 0, 1, 0, 1, 1, 0, 1], meshTriangles: [0, 1, 2, 0, 2, 3], meshHull: [0, 1, 2, 3] }],
      ikConstraints: [], skins: [], activeSkin: '',
    }, animations: [], assetManifest: {},
  };
  await page.locator('input[type=file]').setInputFiles({
    name: 'feedback.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await page.waitForFunction(() => window.__slotMeshVerts0 === 4);
  await page.evaluate(() => { window.freezeFrames = true; });
  await page.waitForTimeout(300);
  const ticks = await page.evaluate(() => window.__ticks);
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.__ticks), ticks, 'automatic frames really stopped');
  const screen = (x, y) => page.evaluate(([x, y]) => window.__worldToScreen(x, y), [x, y]);
  const image = () => page.locator('canvas').evaluate((c) => c.toDataURL());
  const near = (actual, expected) => actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 0.1, `${actual} != ${expected}`));

  // Consecutive moves in the SAME event turn expose dropped/throttled frames.
  await page.mouse.move(...await screen(0, 0));
  await page.mouse.down();
  const beforeBone = await image();
  const moved = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    return [[20, 10], [40, 20], [60, 30]].map(([x, y]) => {
      const [clientX, clientY] = window.__worldToScreen(x, y);
      canvas.dispatchEvent(new PointerEvent('pointermove', { clientX, clientY, pointerId: 1, buttons: 1 }));
      return [...window.__boneOrigin0];
    });
  });
  moved.forEach((point, i) => near(point, [[20, 10], [40, 20], [60, 30]][i]));
  assert.notEqual(await image(), beforeBone, 'bone drag changes rendered pixels before release');
  await page.mouse.up();
  await page.keyboard.press('Control+z');
  near(await page.evaluate(() => window.__boneOrigin0), [0, 0]);

  // A mesh can be picked on the canvas even with a bone selected.
  await page.mouse.click(...await screen(-60, 200));
  const selectedSlotId = await page.evaluate(async () => {
    const { useEditorStore } = await import('/src/store/editorStore.ts');
    return useEditorStore.getState().selectedSlotId;
  });
  assert.equal(selectedSlotId, 'slot');
  const beforeWire = await image();
  await page.keyboard.press('m');
  assert.notEqual(await image(), beforeWire, 'mesh tool draws wireframe immediately');
  // Center of the diagonal is far from vertex handles and bones.
  const diagonal = await page.evaluate(() => {
    const source = document.querySelector('canvas');
    const c = document.createElement('canvas'); c.width = source.width; c.height = source.height;
    const ctx = c.getContext('2d'); ctx.drawImage(source, 0, 0);
    const rect = source.getBoundingClientRect();
    const [sx, sy] = window.__worldToScreen(0, 160);
    const ratio = source.width / rect.width;
    const pixel = (dx) => [...ctx.getImageData(Math.round((sx - rect.left) * ratio + dx), Math.round((sy - rect.top) * ratio), 1, 1).data];
    return [pixel(0), pixel(5)];
  });
  assert.notDeepEqual(diagonal[0], diagonal[1], 'triangle diagonal is visible, not only handles');
  await page.mouse.move(...await screen(-100, 80));
  await page.mouse.down();
  const beforeVertex = await image();
  await page.mouse.move(...await screen(-125, 65));
  near(await page.evaluate(() => window.__slotMesh0), [-125, 65]);
  assert.notEqual(await image(), beforeVertex, 'vertex drag changes pixels before release');
  await page.mouse.up();
  await page.keyboard.press('Control+z');
  near(await page.evaluate(() => window.__slotMesh0), [-100, 80]);
  await page.keyboard.press('Control+y');
  near(await page.evaluate(() => window.__slotMesh0), [-125, 65]);

  // Topology edits refresh both geometry and handles without an animation tick.
  await page.mouse.dblclick(...await screen(-35, 170));
  assert.equal(await page.evaluate(() => window.__slotMeshVerts0), 5);
  await page.keyboard.down('Alt');
  await page.mouse.click(...await screen(-35, 170));
  await page.keyboard.up('Alt');
  assert.equal(await page.evaluate(() => window.__slotMeshVerts0), 4);
  await page.getByRole('button', { name: 'Animate', exact: true }).click();
  await page.mouse.move(...await screen(-125, 65));
  await page.mouse.down();
  await page.mouse.move(...await screen(-140, 50));
  near(await page.evaluate(() => window.__slotMesh0), [-140, 50]);
  await page.mouse.up();
  assert.ok(await page.evaluate(() => window.__deformKeyframes > 0));

  mkdirSync('packages/editor/.smoke', { recursive: true });
  writeFileSync('packages/editor/.smoke/viewport-feedback.png', Buffer.from((await image()).split(',')[1], 'base64'));

  // Hull rubber band and bone creation have previews before mouse release.
  fixture.skeleton.attachments = [{ id: 'mesh', name: 'region', type: 'region', textureId: 'missing',
    vertices: [-100, 80, 100, 80, 100, 240, -100, 240], uvs: [0, 0, 1, 0, 1, 1, 0, 1] }];
  await page.locator('input[type=file]').setInputFiles({
    name: 'region.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await page.locator('span', { hasText: /^test-mesh@root$/ }).first().click({ timeout: 3000 });
  await page.keyboard.press('m');
  await page.mouse.click(...await screen(-100, 80));
  const firstHull = await image();
  await page.mouse.move(...await screen(100, 80));
  assert.notEqual(await image(), firstHull, 'hull rubber band follows mouse without frames');
  await page.mouse.click(...await screen(100, 80));
  await page.mouse.click(...await screen(100, 240));
  await page.mouse.click(...await screen(-100, 240));
  await page.keyboard.press('Enter');
  await page.mouse.move(...await screen(-100, 80));
  await page.mouse.down();
  await page.mouse.move(...await screen(-110, 70));
  near(await page.evaluate(() => window.__slotMesh0), [-110, 70]);
  await page.mouse.up();
  await page.keyboard.press('b');
  await page.mouse.move(...await screen(-160, -70));
  await page.mouse.down();
  const firstBone = await image();
  await page.mouse.move(...await screen(-70, -110));
  assert.notEqual(await image(), firstBone, 'new bone preview follows mouse before release');
  await page.mouse.up();
  await page.keyboard.press('Control+z');
  const beforeZoom = await image();
  await page.mouse.wheel(0, -100);
  // Wheel delivery is asynchronous in Chromium; wait on the camera, not rAF.
  await page.waitForFunction((old) => document.querySelector('canvas').toDataURL() !== old, beforeZoom, { polling: 10 });
  assert.deepEqual(errors, []);
  console.log('PASS: stalled frames, live bone/mesh drag, wireframe pixels, canvas selection, topology, undo/redo, deform, hull, creation preview, zoom');
} finally {
  await browser.close();
}
