import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(process.env.SPRINE_URL ?? 'http://127.0.0.1:5183/');
  await page.waitForFunction(() => window.__ticks > 2);
  const open = async (project) => {
    await page.locator('input[accept=".bbbproj,.json,application/json"]').setInputFiles({
      name: 'selection.bbbproj',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(project)),
    });
    await page.getByText(/Opened selection.bbbproj/).waitFor();
  };
  const screen = (x, y) => page.evaluate(([x, y]) => window.__worldToScreen(x, y), [x, y]);
  // Check rendered pixels, independent of development modules and test-only selection data.
  const goldAt = async (canvas, client) => {
    const bounds = await canvas.boundingBox();
    const png = (await canvas.screenshot()).toString('base64');
    return page.evaluate(
      async ({ png, x, y }) => {
        const image = new Image();
        image.src = 'data:image/png;base64,' + png;
        await image.decode();
        const c = document.createElement('canvas');
        c.width = image.width;
        c.height = image.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(image, 0, 0);
        const pixels = ctx.getImageData(Math.round(x) - 3, Math.round(y) - 3, 7, 7).data;
        for (let i = 0; i < pixels.length; i += 4)
          if (pixels[i] > 225 && pixels[i + 1] > 150 && pixels[i + 1] < 215 && pixels[i + 2] < 100)
            return true;
        return false;
      },
      { png, x: client[0] - bounds.x, y: client[1] - bounds.y },
    );
  };
  const project = {
    version: 2,
    skeleton: {
      bones: [
        {
          id: 'root',
          name: 'root',
          parentId: null,
          length: 80,
          setupPose: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 },
        },
      ],
      slots: [
        {
          id: 'slot',
          name: 'artwork',
          boneId: 'root',
          defaultAttachmentId: 'region',
          color: 0xffffffff,
          blendMode: 'normal',
        },
      ],
      attachments: [
        {
          id: 'region',
          name: 'region',
          type: 'region',
          textureId: 'missing',
          vertices: [-100, 80, 100, 80, 100, 240, -100, 240],
          uvs: [0, 0, 1, 0, 1, 1, 0, 1],
        },
      ],
      ikConstraints: [],
      skins: [],
      activeSkin: '',
    },
    animations: [],
    assetManifest: {},
  };
  await open(project);
  const canvas = page.locator('canvas');
  assert.equal(
    await goldAt(canvas, await screen(-100, 160)),
    false,
    'unselected artwork has no selection outline',
  );
  await page.mouse.click(...(await screen(-60, 200)));
  assert.equal(await goldAt(canvas, await screen(-100, 160)), true, 'canvas selection outlines region');
  await page.getByRole('button', { name: 'Bones', exact: true }).click();
  assert.equal(await goldAt(canvas, await screen(-100, 160)), true, 'outline survives hidden bones');
  await page.getByRole('button', { name: 'Animate', exact: true }).click();
  assert.equal(await goldAt(canvas, await screen(-100, 160)), true, 'outline survives Animate layout');
  await page.mouse.click(...(await screen(-160, 200)));
  assert.equal(await goldAt(canvas, await screen(-100, 160)), false, 'deselection removes outline');
  await page
    .locator('span', { hasText: /^artwork@root$/ })
    .first()
    .click();
  assert.equal(await goldAt(canvas, await screen(-100, 160)), true, 'Hierarchy selection outlines artwork');
  const beforeZoom = await screen(-100, 160);
  await page.mouse.move(...(await screen(0, 160)));
  await page.mouse.wheel(0, -200);
  await page.waitForFunction((old) => window.__worldToScreen(-100, 160)[0] !== old, beforeZoom[0]);
  assert.equal(await goldAt(canvas, await screen(-100, 160)), true, 'selection remains visible after zoom');
  await page.getByRole('button', { name: 'Setup', exact: true }).click();
  project.skeleton.slots[0].defaultAttachmentId = 'mesh';
  project.skeleton.attachments = [
    {
      id: 'mesh',
      name: 'mesh',
      type: 'mesh',
      textureId: 'missing',
      meshVertices: [0, 160, -100, 80, 100, 80, 100, 240, -100, 240],
      meshUVs: [0.5, 0.5, 0, 0, 1, 0, 1, 1, 0, 1],
      meshTriangles: [0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 1],
    },
  ];
  await open(project);
  await page.waitForFunction(() => window.__slotMeshVerts0 === 5);
  await page.mouse.click(...(await screen(-60, 200)));
  assert.equal(
    await goldAt(canvas, await screen(-100, 160)),
    true,
    'mesh without explicit hull outlines its boundary',
  );
  assert.equal(
    await goldAt(canvas, await screen(50, 200)),
    false,
    'interior triangle edges are not selection boundaries',
  );
  await page.keyboard.press('m');
  await page.mouse.move(...(await screen(-100, 80)));
  await page.mouse.down();
  await page.mouse.move(...(await screen(-140, 80)));
  await page.mouse.up();
  await page.keyboard.press('v');
  assert.equal(await goldAt(canvas, await screen(-120, 160)), true, 'outline follows edited mesh vertices');
  assert.equal(await goldAt(canvas, await screen(-100, 160)), false, 'old boundary is removed');
  await page.keyboard.press('Control+z');
  assert.equal(await goldAt(canvas, await screen(-100, 160)), true, 'undo restores the rendered outline');
  mkdirSync('packages/editor/.smoke', { recursive: true });
  await canvas.screenshot({ path: 'packages/editor/.smoke/selected-artwork.png' });

  const scene = JSON.parse(readFileSync('fixtures/scene-standard-v1.json', 'utf8'));
  await open(scene);
  const sceneCanvas = page.getByTestId('scene-viewport').locator('canvas');
  await sceneCanvas.waitFor();
  await page.getByRole('button', { name: 'Fit artboard', exact: true }).click();
  const bounds = await sceneCanvas.boundingBox();
  const scale = Math.min((bounds.width - 80) / 700, (bounds.height - 80) / 500);
  const point = (x, y) => [bounds.x + bounds.width / 2 + x * scale, bounds.y + bounds.height / 2 + y * scale];
  const node = scene.artboards[0].nodes[44];
  await page.mouse.click(...point(node.transform.x, node.transform.y));
  const edge = point(node.transform.x - node.width / 2, node.transform.y);
  assert.equal(await goldAt(sceneCanvas, edge), true, 'Scene selection has a high-contrast outline');
  await sceneCanvas.screenshot({ path: 'packages/editor/.smoke/selected-scene.png' });
  const reward = JSON.parse(readFileSync('fixtures/bbbproj-v3-reward.json', 'utf8'));
  const instance = reward.artboards[0].nodes.find((n) => n.type === 'instance');
  instance.parentId = null;
  instance.transform = { ...node.transform, x: 0, y: 0 };
  delete instance.layout;
  reward.artboards[0].nodes = [instance];
  reward.artboards[0].width = 400;
  reward.artboards[0].height = 400;
  delete reward.artboards[0].safeArea;
  await open(reward);
  await page.getByRole('button', { name: 'Fit artboard', exact: true }).click();
  await page.getByRole('button', { name: 'claim-button instance', exact: true }).click();
  const componentBounds = await sceneCanvas.boundingBox();
  const componentScale = Math.min((componentBounds.width - 80) / 400, (componentBounds.height - 80) / 400);
  assert.equal(
    await goldAt(sceneCanvas, [
      componentBounds.x + componentBounds.width / 2 - 100 * componentScale,
      componentBounds.y + componentBounds.height / 2,
    ]),
    true,
    'component instance outlines its expanded artwork',
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS: visible region/mesh/Scene selection, Hierarchy, mode and Bones visibility, no interior edges, changed geometry and Undo pixels.',
  );
} finally {
  await browser.close();
}
