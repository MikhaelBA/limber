import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: process.env.HEADLESS !== '0' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(process.env.SPRINE_URL ?? 'http://localhost:5173/');
  await page.waitForFunction(() => window.__ticks > 2);
  const save = async () => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    return JSON.parse(readFileSync(await (await pending).path(), 'utf8'));
  };
  const scene = page.getByRole('region', { name: 'Scene workspace' });
  console.log('[scene] switching workspace');
  await page.getByRole('button', { name: 'Scene', exact: true }).click();
  await page.getByTestId('scene-viewport').locator('canvas').waitFor();
  await page.getByRole('button', { name: 'Add artboard', exact: true }).click();
  await page.getByRole('button', { name: 'Add group', exact: true }).click();
  const name = page.getByRole('textbox', { name: 'Scene name' });
  await name.fill('Reward group');
  await name.press('Tab');
  await page.getByRole('button', { name: 'Add rig', exact: true }).click();
  await page.getByRole('combobox', { name: 'Node parent' }).selectOption({ label: 'Reward group' });
  const x = page.getByRole('spinbutton', { name: 'Node x', exact: true });
  await x.fill('120');
  await page.getByRole('button', { name: 'Edit character rig', exact: true }).click();
  await page.getByRole('button', { name: '＋ Bone', exact: true }).click();
  const canvas = page.locator('canvas');
  const bounds = await canvas.boundingBox();
  await page.mouse.click(bounds.x + bounds.width / 2 + 80, bounds.y + bounds.height / 2 + 40);
  console.log('[scene] switching workspace');
  await page.getByRole('button', { name: 'Scene', exact: true }).click();
  console.log('[scene] saving edited rig');
  let project = await save();
  const artboard = project.artboards[1],
    rig = artboard.nodes.find((n) => n.type === 'rig');
  assert.equal(rig.skeleton.bones.length, 2);
  assert.equal(rig.transform.x, 120);
  assert.equal(project.artboards[0].nodes[0].skeleton.bones.length, 1);
  await page.getByRole('combobox', { name: 'Active artboard' }).selectOption(project.artboards[0].id);
  await scene.getByRole('button', { name: 'Undo', exact: true }).click();
  project = await save();
  assert.equal(project.editor.activeArtboardId, artboard.id);
  assert.equal(project.artboards[1].nodes.find((n) => n.type === 'rig').skeleton.bones.length, 1);
  await scene.getByRole('button', { name: 'Redo', exact: true }).click();
  await page.getByRole('button', { name: 'Add group', exact: true }).click();
  await name.fill('Temporary');
  await name.press('Tab');
  await scene.getByRole('button', { name: 'Delete nodes', exact: true }).click();
  await scene.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.ok((await save()).artboards[1].nodes.some((n) => n.name === 'Temporary'));
  await page.getByLabel('Import scene image', { exact: true }).setInputFiles({
    name: 'reward.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="120"><rect width="180" height="120" fill="#f7c85b"/></svg>',
    ),
  });
  await page.getByRole('button', { name: 'reward.svg image' }).waitFor();
  project = await save();
  const imageNode = project.artboards[1].nodes.find((n) => n.type === 'image');
  assert.equal(imageNode.width, 180);
  assert.ok(project.assetManifest[imageNode.textureId].dataUrl.startsWith('data:image/'));
  await page.locator('input[accept=".bbbproj,.json,application/json"]').setInputFiles({
    name: 'scene.bbbproj',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.getByText(/Opened scene.bbbproj/).waitFor();
  await page.getByTestId('scene-viewport').locator('canvas').waitFor();
  assert.deepEqual(await save(), project);
  await page.screenshot({ path: 'packages/editor/.smoke/scene-workspace.png' });
  const large = structuredClone(project);
  const target = large.artboards[1];
  target.nodes = Array.from({ length: 10000 }, (_, i) => ({
    id: `stress-${i}`,
    name: `Node ${i}`,
    type: 'group',
    parentId: null,
    transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0, pivotX: 0, pivotY: 0 },
    opacity: 1,
    visible: false,
  }));
  large.editor.activeRigId = null;
  await page
    .locator('input[accept=".bbbproj,.json,application/json"]')
    .setInputFiles({
      name: 'large.bbbproj',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(large)),
    });
  await page.getByText(/Opened large.bbbproj/).waitFor();
  const tree = page.getByLabel('Scene tree', { exact: true });
  assert.ok((await tree.getByRole('button').count()) <= 60);
  const started = Date.now();
  await tree.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await tree.getByRole('button', { name: '◌ Node 9999 group', exact: true }).click();
  await name.fill('Last node renamed');
  await name.press('Tab');
  await tree.getByRole('button', { name: '◌ Last node renamed group', exact: true }).waitFor();
  assert.ok(Date.now() - started < 5000, '10000-node hierarchy edit must complete within 5 seconds');
  console.log(`[scene] 10000-node hierarchy scroll/select/rename: ${Date.now() - started}ms`);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: scene hierarchy, properties, artboards, rig isolation, cross-rig undo/redo, native scene roundtrip',
  );
} finally {
  await browser.close();
}
