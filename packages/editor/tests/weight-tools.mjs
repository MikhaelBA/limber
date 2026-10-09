import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: process.env.HEADLESS !== '0' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(process.env.SPRINE_URL ?? 'http://localhost:5173/');
  await page.waitForFunction(() => window.__ticks > 2);
  const bone = (id, x) => ({ id, name: id, parentId: null, length: 50,
    setupPose: { x, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 } });
  const fixture = { version: 2, skeleton: { bones: [bone('root', 0), bone('mid', 60), bone('tip', 120)],
    slots: [{ id: 'slot', name: 'weighted mesh', boneId: 'root', defaultAttachmentId: 'mesh', color: 0xffffffff }],
    attachments: [{ id: 'mesh', name: 'mesh', type: 'mesh', textureId: '',
      meshVertices: [-50, -30, 50, -30, 50, 30, -50, 30], meshUVs: [0, 0, 1, 0, 1, 1, 0, 1],
      meshTriangles: [0, 1, 2, 0, 2, 3], meshHull: [0, 1, 2, 3],
      weights: Array.from({ length: 4 }, () => [3, 0, 0.2, 1, 0.3, 2, 0.5]).flat() }],
    ikConstraints: [], skins: [], activeSkin: '' },
    animations: [{ name: 'idle', duration: 1, loop: true, timelines: [] }], assetManifest: {} };
  let lastDownload = 0;
  const open = async (project) => {
    // Every later import follows a saved snapshot. Await its distinct status so a
    // repeated error cannot satisfy the next assertion before File.text() finishes.
    // Use the real UI rather than a dev-server-only source-module import.
    if (lastDownload > 0) await page.locator('footer').getByText(/^Project saved/).waitFor();
    await page.locator('input[type=file]').setInputFiles({ name: 'weights.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
    await page.locator('footer').getByText(/Opened weights.json|Open failed:/).waitFor();
  };
  const save = async () => {
    // This suite intentionally downloads many tiny snapshots. Pace those downloads
    // so fast CI machines do not exercise Chromium's automatic-download limiter.
    await page.waitForTimeout(Math.max(0, 150 - (Date.now() - lastDownload)));
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const download = await pending;
    lastDownload = Date.now();
    return JSON.parse(readFileSync(await download.path(), 'utf8'));
  };
  await open(fixture);
  await page.getByText(/^weighted mesh/).first().click();
  const before = await save();
  await page.getByLabel('Maximum mesh influences', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Prune weights', exact: true }).click();
  const pruned = await save();
  assert.deepEqual(pruned.artboards[0].nodes[0].skeleton.attachments[0].weights, Array.from({ length: 4 }, () => [1, 2, 1]).flat());
  await page.waitForFunction(() => Math.abs(window.__slotMesh0?.[0] - 70) < 0.001);
  await page.keyboard.press('Control+z'); assert.deepEqual(await save(), before);
  await page.keyboard.press('Control+y'); assert.deepEqual(await save(), pruned);
  await page.getByLabel('Maximum mesh influences', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Prune weights', exact: true }).click();
  await page.locator('footer').getByText(/Invalid influence limit/).waitFor();
  assert.deepEqual(await save(), pruned);
  await page.getByRole('button', { name: 'Normalize weights', exact: true }).click();
  assert.deepEqual(await save(), pruned);
  await open(pruned);
  await page.getByText(/^weighted mesh/).first().click();
  assert.deepEqual(await save(), pruned);
  const broken = structuredClone(pruned);
  broken.artboards[0].nodes[0].skeleton.attachments[0].weights.pop();
  await open(broken);
  await page.locator('footer').getByText(/malformed weights/).waitFor();
  assert.deepEqual(await save(), pruned);
  for (const corrupt of [
    (mesh) => { mesh.meshTriangles = [0, 1, 2]; },
    (mesh) => { mesh.meshVertices[0] = mesh.meshVertices[2]; mesh.meshVertices[1] = mesh.meshVertices[3]; },
    (mesh) => { mesh.meshUVs.pop(); },
    (mesh) => { mesh.meshHull = null; },
  ]) {
    const badGeometry = structuredClone(pruned);
    corrupt(badGeometry.artboards[0].nodes[0].skeleton.attachments[0]);
    await open(badGeometry);
    await page.locator('footer').getByText(/invalid geometry/i).waitFor();
    assert.deepEqual(await save(), pruned, 'invalid geometry leaves the active project intact');
  }
  await page.getByRole('button', { name: 'Animate', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Prune weights', exact: true }).isDisabled(), true);
  assert.deepEqual(await save(), pruned);
  const animated = structuredClone(pruned);
  animated.artboards[0].nodes[0].animations[0].timelines.push({ kind: 'deform', attachmentId: 'mesh', keyframes: [
    { time: 0, offsets: null, curve: { type: 'bezier', c1: 1 / 3, c2: 0, c3: 2 / 3, c4: 0 } },
    { time: 1, offsets: [8, 0, 8, 0, 8, 0, 8, 0], curve: { type: 'linear' } },
  ] });
  await open(animated);
  await page.getByRole('button', { name: 'Animate', exact: true }).click();
  await page.locator('.cursor-ew-resize').first().click({ position: { x: 50, y: 12 } });
  await page.waitForFunction(() => Math.abs(window.__slotMesh0?.[0] - 71) < 0.01);
  assert.deepEqual(await save(), animated, 'Bezier sampling preserves authored source');
  for (const corrupt of [
    (track) => { track.keyframes[1].offsets.pop(); },
    (track) => { track.keyframes[1].offsets[0] = 1e40; },
    (track) => { track.keyframes[1].time = 0; },
    (track) => { track.keyframes[0].curve.c1 = -1; },
  ]) {
    const invalid = structuredClone(animated);
    corrupt(invalid.artboards[0].nodes[0].animations[0].timelines[0]);
    await open(invalid);
    await page.locator('footer').getByText(/Invalid Deform/).waitFor();
    assert.deepEqual(await save(), animated, 'malformed Deform import retains active project');
  }
  assert.deepEqual(errors, []);
  await page.screenshot({ path: 'packages/editor/.smoke/mesh-weights.png' });
  console.log('PASS: weight pruning, sampled vertices, atomic invalid edits/import, exact history, native roundtrip and setup isolation');
} finally { await browser.close(); }
