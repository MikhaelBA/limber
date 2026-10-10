import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { logicWorkspaceFixture } from '../../../tools/logic-workspace-fixture.mjs';
const project = logicWorkspaceFixture(),
  board = project.artboards[0],
  rig = board.nodes.find((node) => node.type === 'rig');
project.assetManifest = {};
project.components = [];
board.width = 400;
board.height = 300;
delete board.logic;
board.clips = [];
board.nodes = [rig];
rig.transform = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0, pivotX: 0, pivotY: 0 };
rig.animations = [
  {
    name: 'reorder',
    duration: 1,
    loop: false,
    timelines: [
      {
        kind: 'drawOrder',
        keyframes: [{ time: 0, slotOrder: [1, 0, 2, 3, 4, 5], curve: { type: 'stepped' } }],
      },
    ],
  },
];
rig.logic = {
  id: 'graph',
  name: 'Render goldens',
  enabled: true,
  entryStateId: 'idle',
  parameters: [],
  states: [{ id: 'idle', name: 'Idle', clip: null, loop: false }],
  transitions: [],
};
const slot = (id, attachment, color = 0xffffffff) => ({
  id,
  name: id,
  boneId: 'root',
  defaultAttachmentId: attachment,
  color,
});
const region = (id, vertices) => ({
  id,
  name: id,
  type: 'region',
  textureId: '',
  vertices,
  uvs: [0, 0, 1, 0, 1, 1, 0, 1],
});
rig.skeleton = {
  bones: [
    {
      id: 'root',
      name: 'root',
      parentId: null,
      length: 20,
      setupPose: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 },
    },
  ],
  slots: [
    slot('clip-slot', 'clip'),
    slot('green-slot', 'green', 0x00ff00ff),
    slot('red-slot', 'red', 0xff000080),
    slot('second-clip-slot', 'second-clip'),
    slot('blue-slot', 'blue', 0x0000ffff),
    slot('unused-clip-slot', 'unused-clip'),
  ],
  attachments: [
    {
      id: 'clip',
      name: 'clip',
      type: 'clipping',
      textureId: '',
      meshVertices: [-100, -100, 0, -100, 0, 100, -100, 100],
      meshHull: [0, 1, 2, 3],
      endSlotId: 'red-slot',
    },
    region('green', [-80, -40, 80, -40, 80, 40, -80, 40]),
    region('red', [30, -30, 90, -30, 90, 30, 30, 30]),
    {
      id: 'second-clip',
      name: 'second clip',
      type: 'clipping',
      textureId: '',
      meshVertices: [-100, 60, 0, 60, 0, 100, -100, 100],
      meshHull: [0, 1, 2, 3],
      endSlotId: null,
    },
    region('blue', [-80, 60, 80, 60, 80, 100, -80, 100]),
    {
      id: 'unused-clip',
      name: 'unused',
      type: 'clipping',
      textureId: '',
      meshVertices: [-90, 120, 90, 120, 90, 140, -90, 140],
      meshHull: [0, 1, 2, 3],
      endSlotId: null,
    },
  ],
  skins: [],
  activeSkin: '',
  ikConstraints: [],
};
mkdirSync('packages/editor/.smoke', { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } }),
    errors = [];
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(process.env.SPRINE_URL ?? 'http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__ticks > 2);
  await page.locator('input[type=file][accept^=".bbbproj"]').setInputFiles({
    name: 'render-goldens.bbbproj',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.locator('footer').getByText('Opened render-goldens.bbbproj', { exact: false }).waitFor();
  const save = async () => {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    return JSON.parse(readFileSync(await (await download).path(), 'utf8'));
  };
  await page.getByRole('button', { name: 'Logic', exact: true }).click();
  await page.getByLabel('Logic owner', { exact: true }).selectOption(rig.id);
  await page.waitForFunction(() => window.__logicCapture?.().rigs[0]?.meshes.length === 3);
  const preview = page.getByTestId('logic-preview'),
    canvas = preview.locator('canvas');
  const sample = async () =>
    page.evaluate(
      async (data) => {
        const image = new Image();
        image.src = `data:image/png;base64,${data}`;
        await image.decode();
        const copy = document.createElement('canvas');
        copy.width = image.width;
        copy.height = image.height;
        const ctx = copy.getContext('2d');
        ctx.drawImage(image, 0, 0);
        const scale = Math.min((copy.width - 40) / 400, (copy.height - 40) / 300);
        const pixel = (x, y) =>
          Array.from(
            ctx.getImageData(
              Math.round(copy.width / 2 + x * scale),
              Math.round(copy.height / 2 + y * scale),
              1,
              1,
            ).data,
          ).slice(0, 3);
        return {
          green: pixel(-40, 0),
          clipped: pixel(10, 0),
          red: pixel(60, 0),
          blue: pixel(-40, 80),
          secondClipped: pixel(40, 80),
          unused: pixel(0, 130),
        };
      },
      (await canvas.screenshot()).toString('base64'),
    );
  const golden = {
    green: [0, 255, 0],
    clipped: [32, 36, 44],
    red: [144, 18, 22],
    blue: [0, 0, 255],
    secondClipped: [32, 36, 44],
    unused: [32, 36, 44],
  };
  assert.deepEqual(
    await sample(),
    golden,
    'stencil, exclusive clip end, RGBA color/alpha and unused-mask pixels',
  );
  const inspect = await page.evaluate(() => window.__logicCapture().rigs[0]);
  assert.equal(inspect.meshes.find((m) => m.attachmentId === 'green').masked, true);
  assert.equal(inspect.meshes.find((m) => m.attachmentId === 'red').masked, false);
  assert.equal(inspect.meshes.find((m) => m.attachmentId === 'green').tint, 0x00ff00);
  assert.equal(inspect.meshes.find((m) => m.attachmentId === 'red').alpha, 128 / 255);
  await page.getByRole('button', { name: 'Step Logic', exact: true }).click();
  assert.deepEqual(
    await sample(),
    golden,
    'steady frame retains mask membership without rendering unused clips',
  );
  assert.deepEqual(await save(), project);
  await page.screenshot({ path: 'packages/editor/.smoke/logic-rendering.png' });
  await page.getByRole('button', { name: 'Character', exact: true }).click();
  await page.getByText(/^red-slot/).click();
  const picker = page.locator('input[type=color]');
  assert.equal(await picker.inputValue(), '#ff0000');
  await picker.fill('#0000ff');
  const blue = await save();
  assert.equal(blue.artboards[0].nodes[0].skeleton.slots.find((s) => s.id === 'red-slot').color, 0x0000ff80);
  const raw = page.locator('canvas');
  const positions = await raw.evaluate((c) => {
    const rect = c.getBoundingClientRect();
    return [
      [-40, 10],
      [60, 10],
      [-40, 80],
    ].map(([x, y]) => {
      const p = window.__worldToScreen(x, y);
      return [p[0] - rect.left, p[1] - rect.top];
    });
  });
  const rawPixels = await page.evaluate(
    async ({ data, positions }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const c = document.createElement('canvas');
      c.width = image.width;
      c.height = image.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(image, 0, 0);
      return positions.map(([x, y]) =>
        Array.from(ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data).slice(0, 3),
      );
    },
    { data: (await raw.screenshot()).toString('base64'), positions },
  );
  assert.deepEqual(rawPixels[0], [0, 255, 0], 'raw Character renderer keeps opaque green RGBA');
  assert.ok(
    rawPixels[1][2] > 100 && rawPixels[1][0] < 60 && rawPixels[1][1] < 60,
    `raw Character renderer shows the translucent blue channel: ${rawPixels[1]}`,
  );
  assert.deepEqual(
    rawPixels[2],
    [0, 0, 255],
    'raw Character renderer retains an independent second clipping mask',
  );
  await page.keyboard.press('Control+z');
  assert.deepEqual(await save(), project);
  await page.keyboard.press('Control+y');
  assert.deepEqual(await save(), blue);
  await picker.fill('#ff0000');
  assert.equal(
    (await save()).artboards[0].nodes[0].skeleton.slots.find((s) => s.id === 'red-slot').color,
    0xff000080,
  );
  await page.getByRole('button', { name: 'Animate', exact: true }).click();
  const reordered = await page.evaluate(
    async (data) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const c = document.createElement('canvas');
      c.width = image.width;
      c.height = image.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(image, 0, 0);
      const rect = document.querySelector('canvas').getBoundingClientRect(),
        p = window.__worldToScreen(10, 10);
      return Array.from(
        ctx.getImageData(Math.round(p[0] - rect.left), Math.round(p[1] - rect.top), 1, 1).data,
      ).slice(0, 3);
    },
    (await raw.screenshot()).toString('base64'),
  );
  assert.deepEqual(reordered, [0, 255, 0], 'animated draw order releases meshes that precede the clip slot');
  assert.deepEqual(await save(), project, 'raw posing preserves color and authored animation');
  await page.getByRole('button', { name: 'Logic', exact: true }).click();
  await page.getByLabel('Logic owner', { exact: true }).selectOption(rig.id);
  await page.waitForFunction(() => window.__logicCapture?.().rigs[0]?.meshes.length === 3);
  assert.deepEqual(await sample(), golden, 'unsigned color edits return to the same portable render');
  assert.deepEqual(errors, []);
  console.log(
    'PASS: actual stencil pixels, exclusive clipping boundary, unused-mask suppression, RGBA color/alpha and character picker/native history parity',
  );
} finally {
  await browser.close();
}
