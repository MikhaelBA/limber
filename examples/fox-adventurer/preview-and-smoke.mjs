import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const here = dirname(fileURLToPath(import.meta.url));
const scratch = resolve(here, '../../.smoke/fox-adventurer');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(process.env.SPRINE_URL ?? 'http://127.0.0.1:5173/');
  await page.getByRole('button', { name: 'Open…', exact: true }).waitFor();
  await page.locator('input[type=file]').setInputFiles(join(here, 'Fox-Adventurer.bbbproj'));
  await page
    .getByText('Opened Fox-Adventurer.bbbproj — 2 embedded texture(s) restored', { exact: true })
    .waitFor();
  const canvas = page.locator('canvas').first();
  await canvas.waitFor();
  await page.screenshot({ path: join(here, 'editor-preview.png') });
  await page.getByRole('button', { name: 'Animate', exact: true }).click();
  const animation = page.locator('select').filter({ has: page.locator('option[value="Wave (IK)"]') });
  const skins = page.locator('select').filter({ has: page.locator('option[value="Plum / gold scarf"]') });
  for (const skin of ['Teal / red scarf', 'Plum / gold scarf']) {
    await skins.selectOption(skin);
    for (const clip of ['Idle', 'Wave (IK)', 'March', 'Cloth demo']) {
      await animation.selectOption(clip);
      await page.getByTitle('Play/Pause (Space)', { exact: true }).click();
      await page.waitForTimeout(800);
      if (clip === 'Wave (IK)')
        await page.screenshot({
          path: join(here, skin.startsWith('Plum') ? 'editor-wave-gold.png' : 'editor-wave.png'),
        });
      await page.getByTitle('Stop (back to 0)', { exact: true }).click();
    }
  }
  await page.getByRole('button', { name: 'Setup', exact: true }).click();
  await skins.selectOption('Teal / red scarf');
  await page.getByText('Scarf — weighted cloth', { exact: false }).first().click();
  await page.getByRole('button', { name: '◈ Mesh', exact: true }).click();
  await page.getByText(/mesh — 35 vertices/).waitFor();
  await page.screenshot({ path: join(here, 'editor-mesh.png') });
  await page.getByRole('button', { name: '⚖ Weights', exact: true }).click();
  await page.getByTitle('Paint vertex weights toward the selected bone (W)', { exact: true }).waitFor();
  // A real UI Save must preserve the embedded assets and native shared geometry.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Save', exact: true }).click(),
  ]);
  const saved = join(scratch, 'editor-saved.bbbproj');
  await download.saveAs(saved);
  const roundtrip = JSON.parse(readFileSync(saved, 'utf8'));
  assert.equal(Object.keys(roundtrip.assetManifest).length, 2);
  assert.equal(roundtrip.artboards[0].nodes[0].skeleton.attachments.length, 32);
  for (const a of roundtrip.artboards[0].nodes[0].skeleton.attachments.filter((a) => a.meshSourceId))
    assert.equal(a.meshVertices, undefined);
  await page.locator('input[type=file]').setInputFiles(saved);
  await page.getByText(/Opened editor-saved.bbbproj — 2 embedded texture/).waitFor();
  assert.deepEqual(errors, []);
  const report = JSON.parse(readFileSync(join(here, 'validation.json'), 'utf8'));
  report.browser = {
    open: 'passed',
    playback: '4 animations × 2 skins',
    meshAndWeightsInspector: 'passed; 35-vertex scarf mesh selected',
    saveAndReopen: 'passed',
    pageErrors: errors,
  };
  writeFileSync(join(here, 'validation.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('Editor smoke passed: open, 8 playback combinations, Save, reopen, zero page errors.');

  // Render a clean preview using vertices posed by the real runtime, without editor gizmos.
  const preview = JSON.parse(readFileSync(join(scratch, 'preview-poses.json'), 'utf8'));
  const p = await browser.newPage({ viewport: { width: 1240, height: 620 }, deviceScaleFactor: 1 });
  await p.setContent('<canvas id="preview" width="1240" height="620"></canvas><style>body{margin:0}</style>');
  await p.evaluate(async ({ captures, assetManifest }) => {
    const images = {};
    for (const [id, meta] of Object.entries(assetManifest)) {
      const im = new Image();
      im.src = meta.dataUrl;
      await im.decode();
      images[id] = im;
    }
    const ctx = document.getElementById('preview').getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 1240, 620);
    gradient.addColorStop(0, '#142a32');
    gradient.addColorStop(1, '#2d203d');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1240, 620);
    ctx.fillStyle = '#f1ece2';
    ctx.font = '600 27px sans-serif';
    ctx.fillText('FOX ADVENTURER', 35, 47);
    ctx.fillStyle = '#adbbbf';
    ctx.font = '15px sans-serif';
    ctx.fillText('16 layers  ·  19 bones  ·  weighted meshes  ·  cloth Deform  ·  IK  ·  2 skins', 35, 76);
    const positions = [155, 445, 750, 1040];
    for (let n = 0; n < captures.length; n++) {
      const cap = captures[n];
      ctx.save();
      ctx.translate(positions[n], 365);
      ctx.scale(1.13, 1.13);
      for (const layer of cap.layers) {
        const im = images[layer.textureId],
          verts = layer.verts,
          uvs = layer.uvs;
        for (let j = 0; j < layer.triangles.length; j += 3) {
          const indices = layer.triangles.slice(j, j + 3);
          const src = indices.map((i) => [uvs[i * 2] * im.width, uvs[i * 2 + 1] * im.height]);
          const dst = indices.map((i) => [verts[i * 2], verts[i * 2 + 1]]);
          const [a, b, c] = src,
            [p, q, r] = dst;
          const det = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
          if (Math.abs(det) < 1e-8) continue;
          const A = ((q[0] - p[0]) * (c[1] - a[1]) - (r[0] - p[0]) * (b[1] - a[1])) / det;
          const C = ((r[0] - p[0]) * (b[0] - a[0]) - (q[0] - p[0]) * (c[0] - a[0])) / det;
          const B = ((q[1] - p[1]) * (c[1] - a[1]) - (r[1] - p[1]) * (b[1] - a[1])) / det;
          const D = ((r[1] - p[1]) * (b[0] - a[0]) - (q[1] - p[1]) * (c[0] - a[0])) / det;
          // Extend the clip by half a preview pixel to avoid Canvas2D AA cracks
          // between adjacent triangles sampling the same atlas. Mesh data is unchanged.
          const center = [(p[0] + q[0] + r[0]) / 3, (p[1] + q[1] + r[1]) / 3];
          const clip = [p, q, r].map((v) => {
            const dx = v[0] - center[0],
              dy = v[1] - center[1],
              len = Math.hypot(dx, dy);
            return [v[0] + (dx / len) * 0.45, v[1] + (dy / len) * 0.45];
          });
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(...clip[0]);
          ctx.lineTo(...clip[1]);
          ctx.lineTo(...clip[2]);
          ctx.closePath();
          ctx.clip();
          ctx.transform(A, B, C, D, p[0] - A * a[0] - C * a[1], p[1] - B * a[0] - D * a[1]);
          ctx.drawImage(im, 0, 0);
          ctx.restore();
        }
      }
      ctx.restore();
      ctx.fillStyle = '#f1ece2';
      ctx.font = '600 17px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(cap.animation, positions[n], 578);
      ctx.fillStyle = '#adbbbf';
      ctx.font = '13px sans-serif';
      ctx.fillText(cap.skin, positions[n], 601);
      ctx.textAlign = 'left';
    }
  }, preview);
  await p.locator('#preview').screenshot({ path: join(here, 'character-preview.png') });
} finally {
  await browser.close();
}
