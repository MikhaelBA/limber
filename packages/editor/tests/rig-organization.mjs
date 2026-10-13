import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(process.env.SPRINE_URL ?? 'http://127.0.0.1:5183/');
  await page.waitForFunction(() => window.__ticks > 2);
  const bone = (id, parentId, x, length) => ({
    id,
    name: id,
    parentId,
    length,
    setupPose: { x, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 },
  });
  const curve = { type: 'stepped' };
  const fixture = {
    version: 2,
    skeleton: {
      bones: [bone('root', null, 0, 80), bone('child', 'root', 80, 50), bone('point', null, -120, 0)],
      slots: ['red', 'green', 'blue'].map((id, i) => ({
        id,
        name: id,
        boneId: 'root',
        defaultAttachmentId: 'art',
        color: [0xee4433ff, 0x44cc66ff, 0x3388ddff][i],
        blendMode: 'normal',
      })),
      attachments: [
        {
          id: 'art',
          name: 'art',
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
    animations: [
      {
        name: 'order',
        duration: 2,
        loop: false,
        timelines: [
          {
            kind: 'drawOrder',
            keyframes: [
              { time: 0, slotOrder: [0, 1, 2], curve },
              { time: 1, slotOrder: [2, 0, 1], curve },
            ],
          },
        ],
      },
      {
        name: 'other',
        duration: 2,
        loop: false,
        timelines: [{ kind: 'drawOrder', keyframes: [{ time: 0, slotOrder: [1, 2, 0], curve }] }],
      },
    ],
    assetManifest: {},
  };
  let openCount = 0;
  const open = async (project) => {
    const name = `organization-${++openCount}.bbbproj`;
    await page
      .locator('input[type=file]')
      .setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
    await page.locator('footer').getByText(`Opened ${name}`, { exact: false }).waitFor();
  };
  const save = async () => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    return JSON.parse(readFileSync(await (await pending).path(), 'utf8'));
  };
  const rig = (project) => project.artboards[0].nodes[0];
  const slotRow = (id) => page.locator(`[data-testid="slot-row"][data-slot-id="${id}"]`);
  const order = () => page.getByTestId('slot-row').evaluateAll((rows) => rows.map((r) => r.dataset.slotId));
  const expectOrder = async (ids) => {
    await page.waitForFunction(
      (ids) =>
        JSON.stringify(
          [...document.querySelectorAll('[data-testid="slot-row"]')].map((r) => r.dataset.slotId),
        ) === JSON.stringify(ids),
      ids,
    );
    assert.deepEqual(await order(), ids);
  };
  const screen = (x, y) => page.evaluate(([x, y]) => window.__worldToScreen(x, y), [x, y]);
  const canvas = page.locator('canvas');
  const canvasPixels = async () => {
    const png = (await canvas.screenshot()).toString('base64');
    const rect = await canvas.boundingBox(),
      center = await screen(0, 160);
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
        const all = ctx.getImageData(0, 0, c.width, c.height).data;
        let purple = 0;
        for (let i = 0; i < all.length; i += 4)
          if (Math.abs(all[i] - 138) < 5 && Math.abs(all[i + 1] - 78) < 5 && Math.abs(all[i + 2] - 255) < 5)
            purple++;
        return { center: [...ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data].slice(0, 3), purple };
      },
      { png, x: center[0] - rect.x, y: center[1] - rect.y },
    );
  };
  const expectPixel = async (rgb) =>
    assert(
      (await canvasPixels()).center.every((v, i) => Math.abs(v - rgb[i]) < 3),
      `topmost slot should be ${rgb}`,
    );
  const keyedIds = (project) => {
    const r = rig(project);
    return r.animations.map((a) =>
      a.timelines
        .filter((t) => t.kind === 'drawOrder')
        .map((t) => t.keyframes.map((k) => k.slotOrder.map((i) => r.skeleton.slots[i].id))),
    );
  };
  await open(fixture);
  const original = await save();
  await expectOrder(['red', 'green', 'blue']);
  await expectPixel([51, 136, 221]);
  await slotRow('blue').click();
  await page.getByRole('button', { name: 'Move backward', exact: true }).click();
  await expectOrder(['red', 'blue', 'green']);
  const moved = await save();
  assert.deepEqual(
    keyedIds(moved),
    keyedIds(original),
    'Setup reorder preserves keyed visual orders by identity',
  );
  await expectPixel([68, 204, 102]);
  await page.keyboard.press('Control+z');
  assert.deepEqual(await save(), original);
  await page.keyboard.press('Control+y');
  assert.deepEqual(await save(), moved);
  await page.getByRole('button', { name: 'Bring to front', exact: true }).click();
  await expectOrder(['red', 'green', 'blue']);
  await expectPixel([51, 136, 221]);

  // Native HTML drag uses real mouse input; dropping above a row inserts before it.
  const beforeDrag = await save();
  const from = await slotRow('blue').boundingBox(),
    to = await slotRow('red').boundingBox();
  await page.mouse.move(from.x + 55, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 55, from.y - 12, { steps: 5 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.deepEqual(await save(), beforeDrag, 'cancelling a native drag leaves source unchanged');
  await page.mouse.move(from.x + 55, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 55, from.y - 12, { steps: 5 });
  await page.mouse.move(to.x + 55, to.y + 3, { steps: 12 });
  await page.mouse.up();
  await expectOrder(['blue', 'red', 'green']);
  const dragged = await save();
  assert.deepEqual(keyedIds(dragged), keyedIds(beforeDrag));
  await page.keyboard.press('Control+z');
  assert.deepEqual(await save(), beforeDrag);
  await page.keyboard.press('Control+y');
  assert.deepEqual(await save(), dragged);
  await open(dragged);
  assert.deepEqual(await save(), dragged);

  await open(original);
  await page.getByRole('button', { name: 'Animate', exact: true }).click();
  const ruler = page.locator('.cursor-ew-resize').first();
  await ruler.click({ position: { x: 100, y: 12 } });
  await expectOrder(['blue', 'red', 'green']);
  await expectPixel([68, 204, 102]);
  const beforeKey = await save();
  await slotRow('blue').click();
  await page.getByRole('button', { name: 'Bring to front', exact: true }).click();
  await expectOrder(['red', 'green', 'blue']);
  await expectPixel([51, 136, 221]);
  const keyed = await save();
  assert.deepEqual(rig(keyed).skeleton, rig(beforeKey).skeleton, 'Animate must not change Setup order');
  assert.deepEqual(rig(keyed).animations[1], rig(beforeKey).animations[1], 'other clips stay unchanged');
  assert.deepEqual(
    rig(keyed).animations[0].timelines[0].keyframes[0],
    rig(beforeKey).animations[0].timelines[0].keyframes[0],
  );
  assert.deepEqual(rig(keyed).animations[0].timelines[0].keyframes[1].slotOrder, [0, 1, 2]);
  await ruler.click({ position: { x: 0, y: 12 } });
  await page.keyboard.press('Control+z');
  assert.deepEqual(await save(), beforeKey);
  await page.keyboard.press('Control+y');
  assert.deepEqual(await save(), keyed, 'redo keeps the captured key time after scrubbing');
  await page.getByRole('button', { name: 'Setup', exact: true }).click();
  await expectOrder(['red', 'green', 'blue']);

  const boneRow = (name) =>
    page.locator('[draggable=true]').filter({ has: page.getByText(name, { exact: true }) });
  assert.equal(await boneRow('root').getByRole('img', { name: 'root bone icon' }).count(), 1);
  assert.equal(await boneRow('child').getByRole('img', { name: 'bone bone icon' }).count(), 1);
  assert.equal(await boneRow('point').getByRole('img', { name: 'point bone icon' }).count(), 1);
  await boneRow('root').click();
  const beforeColor = await save();
  await page.getByLabel('Bone color', { exact: true }).fill('#8a4eff');
  const colored = await save();
  assert.equal(rig(colored).skeleton.bones[0].color, 0x8a4eff);
  assert.deepEqual(rig(colored).animations, rig(beforeColor).animations);
  assert.equal(
    await boneRow('root')
      .locator('svg')
      .evaluate((svg) => svg.style.color),
    'rgb(138, 78, 255)',
  );
  await page.mouse.click(...(await screen(-180, 200)));
  await page.mouse.move(...(await screen(-180, 260)));
  assert((await canvasPixels()).purple > 15, 'custom bone color appears in actual canvas pixels');
  await boneRow('root').click();
  await page.getByRole('button', { name: 'Reset color', exact: true }).click();
  assert.deepEqual(await save(), beforeColor);
  await page.keyboard.press('Control+z');
  assert.deepEqual(await save(), colored);
  await page.keyboard.press('Control+z');
  assert.deepEqual(await save(), beforeColor);
  await page.keyboard.press('Control+y');
  assert.deepEqual(await save(), colored);
  await open(colored);
  assert.deepEqual(await save(), colored);
  await boneRow('child').click();
  await page.getByTitle('Add IK controlling the selected bone (+ its parent)', { exact: true }).click();
  assert.equal(await page.getByRole('img', { name: 'target bone icon' }).count(), 1);
  await page.keyboard.press('Control+z');
  assert.deepEqual(await save(), colored);
  mkdirSync('packages/editor/.smoke', { recursive: true });
  await boneRow('root').click();
  await page.screenshot({ path: 'packages/editor/.smoke/rig-organization.png' });
  assert.deepEqual(errors, []);
  console.log(
    'PASS: real slot drag, front/back pixels, Setup remapping, isolated animated order, scrub/history, saved bone colors, canvas/icon pixels and root/bone/point/IK icons.',
  );
} finally {
  await browser.close();
}
