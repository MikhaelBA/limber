// Rebuild the native sample from unchanged generated atlases. Run from repo root:
// node examples/fox-adventurer/build-project.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const scratch = join(root, '.smoke/fox-adventurer');
mkdirSync(scratch, { recursive: true });
await build({
  entryPoints: [join(root, 'packages/core/src/index.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: join(scratch, 'core.mjs'),
  alias: { '@limber/mesh': join(root, 'packages/mesh/src/index.ts') },
});
const core = await import(pathToFileURL(join(scratch, 'core.mjs')));

const t = (x = 0, y = 0, rotation = 0) => ({ x, y, rotation, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 });
const multiply = (a, b) => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];
const inverse = (a) => {
  const d = a[0] * a[3] - a[1] * a[2];
  return [
    a[3] / d,
    -a[1] / d,
    -a[2] / d,
    a[0] / d,
    (a[2] * a[5] - a[3] * a[4]) / d,
    (a[1] * a[4] - a[0] * a[5]) / d,
  ];
};
const point = (a, x, y) => [a[0] * x + a[2] * y + a[4], a[1] * x + a[3] * y + a[5]];
const matrices = new Map();
const bones = [];
function bone(id, parentId, x, y, angle, length) {
  const parent = matrices.get(parentId);
  const p = parent ? point(inverse(parent), x, y) : [x, y];
  const rotation = angle - (parent ? Math.atan2(parent[1], parent[0]) : 0);
  bones.push({ id, name: id, parentId, length, setupPose: t(p[0], p[1], rotation) });
  matrices.set(id, [Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), x, y]);
}
const UP = -Math.PI / 2,
  DOWN = Math.PI / 2;
bone('Root', null, 0, 0, 0, 18);
bone('Spine', 'Root', 0, -10, UP, 45);
bone('Chest', 'Spine', 0, -55, UP, 37);
bone('Head', 'Chest', 0, -92, UP, 65);
bone('Scarf upper', 'Chest', 0, -94, DOWN, 50);
bone('Scarf tip', 'Scarf upper', 0, -44, DOWN, 45);
for (const [side, x] of [
  ['L', -45],
  ['R', 45],
]) {
  bone(`Upper arm ${side}`, 'Chest', x, -89, DOWN, 41);
  bone(`Forearm ${side}`, `Upper arm ${side}`, x, -48, DOWN, 41);
  bone(`Hand ${side}`, `Forearm ${side}`, x, -7, DOWN, 23);
}
for (const [side, x] of [
  ['L', -20],
  ['R', 20],
]) {
  bone(`Thigh ${side}`, 'Root', x, 16, DOWN, 46);
  bone(`Shin ${side}`, `Thigh ${side}`, x, 62, DOWN, 48);
  bone(`Foot ${side}`, `Shin ${side}`, x, 110, DOWN, 32);
}
bone('Hand IK target', 'Chest', 45, -7, 0, 8);
const index = new Map(bones.map((b, i) => [b.id, i]));
const uvBounds = JSON.parse(readFileSync(join(here, 'uv-bounds.json'), 'utf8'));
// Select fur/clothing rather than the flat stump caps painted for atlas readability.
// UV selection leaves both original PNGs untouched.
for (const cell of [4, 5, 6, 7, 10, 11, 12, 13]) {
  uvBounds[cell][1] += [5, 7].includes(cell) ? 26 : 18;
  uvBounds[cell][3] -= 15;
}
for (const cell of [8, 9]) uvBounds[cell][1] += 18;
// The hips layer supplies the single belt; don't duplicate the tunic's painted belt.
uvBounds[1][3] = 229;
const atlasSize = 1254;
const attachments = [],
  slots = [],
  variants = {};
const uv = (cell, u, v) => {
  const [l, top, r, bottom] = uvBounds[cell];
  return [(l - 2 + (r - l + 4) * u) / atlasSize, (top - 2 + (bottom - top + 4) * v) / atlasSize];
};
function layer(name, boneId, cell, rect, mesh = null) {
  const id = `part-${cell}`,
    slotId = `layer-${cell}`;
  const [x0, y0, x1, y1] = rect;
  const invSlot = inverse(matrices.get(boneId));
  const att = { id, name, type: mesh ? 'mesh' : 'region', textureId: 'fox-teal' };
  if (!mesh) {
    att.vertices = [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ].flatMap((p) => point(invSlot, ...p));
    att.uvs = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ].flatMap((p) => uv(cell, ...p));
  } else {
    const { cols, rows, influences } = mesh;
    att.meshVertices = [];
    att.meshUVs = [];
    att.meshTriangles = [];
    att.meshHull = [];
    att.weights = [];
    for (let row = 0; row <= rows; row++)
      for (let col = 0; col <= cols; col++) {
        const u = col / cols,
          v = row / rows;
        att.meshVertices.push(...point(invSlot, x0 + (x1 - x0) * u, y0 + (y1 - y0) * v));
        att.meshUVs.push(...uv(cell, u, v));
        const weights = influences(v).filter(([, w]) => w > 1e-7);
        att.weights.push(weights.length, ...weights.flatMap(([id, w]) => [index.get(id), w]));
      }
    const stride = cols + 1;
    for (let row = 0; row < rows; row++)
      for (let col = 0; col < cols; col++) {
        const i = row * stride + col;
        att.meshTriangles.push(i, i + 1, i + stride + 1, i, i + stride + 1, i + stride);
      }
    for (let c = 0; c <= cols; c++) att.meshHull.push(c);
    for (let r = 1; r <= rows; r++) att.meshHull.push(r * stride + cols);
    for (let c = cols - 1; c >= 0; c--) att.meshHull.push(rows * stride + c);
    for (let r = rows - 1; r > 0; r--) att.meshHull.push(r * stride);
    const ids = new Set([boneId, ...[0, 0.25, 0.5, 0.75, 1].flatMap((v) => influences(v).map(([id]) => id))]);
    att.boneBindings = [...ids].map((id) => ({
      boneId: id,
      matrix: multiply(inverse(matrices.get(id)), matrices.get(boneId)),
    }));
    att._grid = { cols, rows };
  }
  const alt = structuredClone(att);
  alt.id = `${id}-gold`;
  alt.name = `${name} — plum / gold`;
  alt.textureId = 'fox-gold';
  if (mesh) {
    alt.meshSourceId = id;
    delete alt.meshVertices;
    delete alt.meshUVs;
    delete alt.meshTriangles;
    delete alt.meshHull;
  }
  attachments.push(att, alt);
  slots.push({ id: slotId, name, boneId, defaultAttachmentId: id, color: 0xffffffff });
  variants[slotId] = alt.id;
}
// Slots are back-to-front; caps overlap at joints, and clothing covers their roots.
for (const [side, x, thighCell, shinCell, bootCell] of [
  ['L', -20, 10, 12, 14],
  ['R', 20, 11, 13, 15],
]) {
  layer(`Boot ${side}`, `Foot ${side}`, bootCell, [x - 15, 104, x + 15, 153]);
  layer(`Shin ${side}`, `Shin ${side}`, shinCell, [x - 10, 59, x + 10, 114]);
  layer(`Thigh ${side}`, `Thigh ${side}`, thighCell, [x - 14, 12, x + 14, 68]);
}
for (const [side, x, upperCell, foreCell, handCell] of [
  ['L', -45, 4, 5, 8],
  ['R', 45, 6, 7, 9],
]) {
  layer(`Glove ${side}`, `Hand ${side}`, handCell, [x - 12, -12, x + 12, 32]);
  layer(`Forearm ${side}`, `Forearm ${side}`, foreCell, [x - 9, -53, x + 9, -3]);
  layer(`Sleeve / upper arm ${side}`, `Upper arm ${side}`, upperCell, [x - 12, -94, x + 12, -44]);
}
layer('Belt / hips', 'Root', 2, [-36, -28, 36, 30]);
layer('Tunic — weighted mesh', 'Chest', 1, [-40, -103, 40, -27], {
  cols: 4,
  rows: 5,
  influences: (v) => [
    ['Chest', 1 - v],
    ['Root', v],
  ],
});
layer('Scarf — weighted cloth', 'Scarf upper', 3, [-26, -102, 54, -9], {
  cols: 4,
  rows: 6,
  influences: (v) => {
    const w = Math.max(0, (v - 0.25) / 0.75);
    return [
      ['Scarf upper', 1 - w],
      ['Scarf tip', w],
    ];
  },
});
layer('Face / ears', 'Head', 0, [-57, -188, 57, -77]);

const ease = { type: 'bezier', c1: 0.42, c2: 0, c3: 0.58, c4: 1 };
const track = (boneId, property, times, values) => ({
  kind: 'boneProperty',
  boneId,
  property,
  keyframes: times.map((time, i) => ({ time, value: values[i], curve: { ...ease } })),
});
const base = (id, property) => bones[index.get(id)].setupPose[property];
const delta = (id, property, times, values) =>
  track(
    id,
    property,
    times,
    values.map((v) => base(id, property) + v),
  );
function deform(id, times, amplitudes, mode) {
  const source = attachments.find((a) => a.id === id);
  const { cols, rows } = source._grid;
  const slot = slots.find((s) => s.defaultAttachmentId === id);
  const invSlot = inverse(matrices.get(slot.boneId));
  const offsets = (amp) => {
    if (amp === 0) return null;
    const out = [];
    for (let r = 0; r <= rows; r++)
      for (let c = 0; c <= cols; c++) {
        const u = c / cols,
          v = r / rows;
        const dx = mode === 'cloth' ? amp * Math.pow(v, 1.8) : amp * (u * 2 - 1) * Math.sin(Math.PI * v);
        const dy = mode === 'cloth' ? Math.abs(amp) * 0.08 * v : 0;
        out.push(invSlot[0] * dx + invSlot[2] * dy, invSlot[1] * dx + invSlot[3] * dy);
      }
    return out;
  };
  return [id, `${id}-gold`].map((attachmentId) => ({
    kind: 'deform',
    attachmentId,
    keyframes: times.map((time, i) => ({ time, offsets: offsets(amplitudes[i]), curve: { ...ease } })),
  }));
}
const idleTimes = [0, 0.6, 1.2, 1.8, 2.4];
const idle = {
  name: 'Idle',
  duration: 2.4,
  loop: true,
  timelines: [
    track('Root', 'y', idleTimes, [0, -1.5, 0, -1.5, 0]),
    delta('Chest', 'rotation', idleTimes, [0, 0.022, 0, -0.022, 0]),
    delta('Head', 'rotation', idleTimes, [0, -0.035, 0, 0.035, 0]),
    delta('Scarf upper', 'rotation', idleTimes, [0, 0.035, 0, -0.035, 0]),
    ...deform('part-1', idleTimes, [0, 1.4, 0, 1.4, 0], 'body'),
    ...deform('part-3', idleTimes, [0, 4, 0, -4, 0], 'cloth'),
  ],
};
const waveTimes = [0, 0.45, 0.8, 1.15, 1.5, 1.95, 2.4];
const wave = {
  name: 'Wave (IK)',
  duration: 2.4,
  loop: true,
  timelines: [
    track(
      'Hand IK target',
      'x',
      waveTimes,
      [-7, -115, -150, -135, -150, -115, -7].map((y) => -55 - y),
    ),
    track('Hand IK target', 'y', waveTimes, [45, 94, 84, 100, 84, 94, 45]),
    delta('Hand R', 'rotation', waveTimes, [0, -0.22, 0.2, -0.22, 0.2, -0.22, 0]),
    delta('Head', 'rotation', [0, 0.8, 1.6, 2.4], [0, -0.055, -0.055, 0]),
    ...deform('part-3', [0, 0.6, 1.2, 1.8, 2.4], [0, -6, 6, -6, 0], 'cloth'),
    {
      kind: 'event',
      keyframes: [{ time: 1.15, eventName: 'hello', payload: 'Fox waves', curve: { type: 'stepped' } }],
    },
  ],
};
const marchTimes = [0, 0.3, 0.6, 0.9, 1.2];
const march = {
  name: 'March',
  duration: 1.2,
  loop: true,
  timelines: [
    track('Root', 'y', marchTimes, [0, -3, 0, -3, 0]),
    delta('Thigh L', 'rotation', marchTimes, [0, 0.13, 0, -0.13, 0]),
    delta('Thigh R', 'rotation', marchTimes, [0, -0.13, 0, 0.13, 0]),
    delta('Thigh L', 'y', marchTimes, [0, -7, 0, 0, 0]),
    delta('Thigh R', 'y', marchTimes, [0, 0, 0, -7, 0]),
    delta('Shin L', 'rotation', marchTimes, [0, -0.22, 0, 0, 0]),
    delta('Shin R', 'rotation', marchTimes, [0, 0, 0, -0.22, 0]),
    delta('Foot L', 'rotation', marchTimes, [0, 0.09, 0, 0.13, 0]),
    delta('Foot R', 'rotation', marchTimes, [0, 0.13, 0, 0.09, 0]),
    delta('Upper arm L', 'rotation', marchTimes, [0, -0.12, 0, 0.12, 0]),
    track(
      'Hand IK target',
      'x',
      marchTimes,
      [-7, -11, -7, -11, -7].map((y) => -55 - y),
    ),
    track('Hand IK target', 'y', marchTimes, [45, 51, 45, 39, 45]),
    ...deform('part-3', marchTimes, [0, 7, 0, -7, 0], 'cloth'),
    {
      kind: 'event',
      keyframes: [0.3, 0.9].map((time, i) => ({
        time,
        eventName: 'footstep',
        payload: i ? 'R' : 'L',
        curve: { type: 'stepped' },
      })),
    },
  ],
};
const clothTimes = [0, 0.75, 1.5, 2.25, 3];
const cloth = {
  name: 'Cloth demo',
  duration: 3,
  loop: true,
  timelines: [
    delta('Scarf upper', 'rotation', clothTimes, [0, 0.075, 0, -0.075, 0]),
    delta('Scarf tip', 'rotation', clothTimes, [0, -0.12, 0, 0.12, 0]),
    ...deform('part-3', clothTimes, [0, -12, 0, 12, 0], 'cloth'),
    ...deform('part-1', clothTimes, [0, 1.6, 0, 1.6, 0], 'body'),
  ],
};
for (const att of attachments) delete att._grid;
const skeleton = {
  bones,
  slots,
  attachments,
  ikConstraints: [
    {
      id: 'ik-hand-r',
      bones: ['Upper arm R', 'Forearm R'],
      targetId: 'Hand IK target',
      poleVectorId: null,
      bendDirection: -1,
      mix: 1,
      softness: 0,
      order: 0,
    },
  ],
  skins: [
    {
      name: 'Teal / red scarf',
      attachments: Object.fromEntries(slots.map((s) => [s.id, s.defaultAttachmentId])),
    },
    { name: 'Plum / gold scarf', attachments: variants },
  ],
  activeSkin: 'Teal / red scarf',
  markers: [
    { id: 'marker-hand-socket', name: 'Hand socket', kind: 'socket', boneId: 'Hand R', transform: t(16, 0) },
    {
      id: 'marker-hand-spawn',
      name: 'Hand FX spawn',
      kind: 'spawnPoint',
      boneId: 'Hand R',
      transform: t(28, 0),
    },
    {
      id: 'marker-body-hurtbox',
      name: 'Body hurtbox',
      kind: 'hurtbox',
      boneId: 'Chest',
      transform: t(5, 0, Math.PI / 2),
      shape: { type: 'rectangle', width: 72, height: 90 },
    },
    { id: 'marker-ground', name: 'Ground contact', kind: 'point', boneId: 'Root', transform: t(0, 153) },
  ],
};
const project = {
  format: 'bonebybone-project',
  schemaVersion: 6,
  projectId: 'fox-adventurer-sample',
  name: 'Fox Adventurer — layered animation sample',
  assetManifest: Object.fromEntries(
    [
      ['fox-teal', 'fox-atlas.png'],
      ['fox-gold', 'fox-atlas-golden.png'],
    ].map(([id, name]) => [
      id,
      {
        name,
        source: 'embedded',
        dataUrl: 'data:image/png;base64,' + readFileSync(join(here, name)).toString('base64'),
      },
    ]),
  ),
  editor: { activeArtboardId: 'fox-stage', activeRigId: 'fox-rig' },
  artboards: [
    {
      id: 'fox-stage',
      name: 'Fox character',
      width: 960,
      height: 720,
      nodes: [
        {
          id: 'fox-rig',
          name: 'Fox Adventurer',
          type: 'rig',
          parentId: null,
          transform: { ...t(), pivotX: 0, pivotY: 0 },
          opacity: 1,
          visible: true,
          skeleton,
          animations: [idle, wave, march, cloth],
        },
      ],
    },
  ],
};
const json = core.serializeProject(project);
core.deserializeProject(json);
writeFileSync(join(here, 'Fox-Adventurer.bbbproj'), json + '\n', 'utf8');
console.log(
  `Created Fox-Adventurer.bbbproj: ${bones.length} bones, ${slots.length} layers, ${attachments.length} attachments, 4 animations, 2 skins.`,
);
