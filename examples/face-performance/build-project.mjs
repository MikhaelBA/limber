// Generated PNGs remain byte-for-byte unchanged. Sprite regions use mesh UVs.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url)),
  root = resolve(here, '../..'),
  scratch = join(root, '.smoke/face-performance');
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
const pose = (x = 0, y = 0) => ({ x, y, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 });
const bones = [
  ['neck', null, 0, 0, 30],
  ['head', 'neck', 0, 155, 45],
  ['jaw', 'head', 0, -55, 25],
  ['cheek-L', 'head', -78, -115, 20],
  ['cheek-R', 'head', 78, -115, 20],
  ['lip-L', 'head', -42, -83, 12],
  ['lip-R', 'head', 42, -83, 12],
  ['eye-L', 'head', -50, -173, 12],
  ['eye-R', 'head', 50, -173, 12],
  ['brow-L', 'head', -50, -205, 12],
  ['brow-R', 'head', 50, -205, 12],
  ['tear-L', 'head', -50, -149, 8],
  ['tear-R', 'head', 50, -149, 8],
].map(([id, parentId, x, y, length]) => ({ id, name: id, parentId, setupPose: pose(x, y), length }));
const index = new Map(bones.map((b, i) => [b.id, i]));
const attachments = [],
  slots = [];
const step = (x) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};
const gaussian = (x, y, cx, cy, sx, sy) => Math.exp(-0.5 * (((x - cx) / sx) ** 2 + ((y - cy) / sy) ** 2));
function mesh(id, textureId, slotBone, x, y, width, height, uv, cols, rows, influences) {
  const meshVertices = [],
    meshUVs = [],
    meshTriangles = [],
    meshHull = [],
    weights = [],
    weightEdges = [],
    bound = new Set();
  for (let r = 0; r <= rows; r++)
    for (let c = 0; c <= cols; c++) {
      const px = x + (c / cols - 0.5) * width,
        py = y + (r / rows - 0.5) * height;
      meshVertices.push(px, py);
      meshUVs.push(uv[0] + (c / cols) * (uv[2] - uv[0]), uv[1] + (r / rows) * (uv[3] - uv[1]));
      const row = influences(px, py).filter(([, w]) => w > 0.0001),
        sum = row.reduce((s, [, w]) => s + w, 0);
      weights.push(
        row.length,
        ...row.flatMap(([id, w]) => {
          bound.add(id);
          return [index.get(id), w / sum];
        }),
      );
      const v = r * (cols + 1) + c;
      if (c < cols) weightEdges.push(v, v + 1);
      if (r < rows) weightEdges.push(v, v + cols + 1);
    }
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c,
        b = a + 1,
        d = a + cols + 2;
      meshTriangles.push(a, b, d, a, d, d - 1);
    }
  for (let c = 0; c <= cols; c++) meshHull.push(c);
  for (let r = 1; r <= rows; r++) meshHull.push(r * (cols + 1) + cols);
  for (let c = cols - 1; c >= 0; c--) meshHull.push(rows * (cols + 1) + c);
  for (let r = rows - 1; r > 0; r--) meshHull.push(r * (cols + 1));
  const a = {
    id,
    name: id,
    type: 'mesh',
    textureId,
    meshVertices,
    meshUVs,
    meshTriangles,
    meshHull,
    weights,
    weightEdges,
  };
  a._bound = [...bound];
  a._slotBone = slotBone;
  attachments.push(a);
  return id;
}
const base = mesh('Face weighted base', 'base', 'neck', 0, 0, 420, 420, [0, 0, 1, 1], 24, 24, (x, y) => {
  const head = 1 - step((y - 120) / 75),
    jaw = 0.62 * step((y - 48) / 90) * Math.exp(-((x / 112) ** 4)) * head;
  const left = 0.25 * gaussian(x, y, -78, 40, 28, 28) * head,
    right = 0.25 * gaussian(x, y, 78, 40, 28, 28) * head;
  return [
    ['neck', 1 - head],
    ['head', Math.max(0.01 * head, head - jaw - left - right)],
    ['jaw', jaw],
    ['cheek-L', left],
    ['cheek-R', right],
  ];
});
function slot(id, boneId, attachment) {
  slots.push({ id, name: id, boneId, defaultAttachmentId: attachment, color: 0xffffffff });
}
slot('Face base — paint weights here', 'neck', base);
// Atlas cells are fixed UV windows. Individual left/right sprites receive their own layers.
const mouths = ['Rest', 'AH', 'EE', 'OH', 'OO', 'FV', 'MBP', 'Laugh'];
mouths.forEach((name, i) => {
  const col = i % 4,
    row = Math.floor(i / 4);
  mesh(
    `Mouth ${name}`,
    'features',
    'head',
    0,
    -83,
    108,
    108,
    [col / 4, row / 4, (col + 1) / 4, (row + 1) / 4],
    8,
    8,
    (x, y) => {
      const jaw = 0.65 * step((y + 102) / 65),
        left = 0.32 * gaussian(x, y, -40, -80, 17, 19),
        right = 0.32 * gaussian(x, y, 40, -80, 17, 19);
      return [
        ['head', Math.max(0.05, 1 - jaw - left - right)],
        ['jaw', jaw],
        ['lip-L', left],
        ['lip-R', right],
      ];
    },
  );
});
slot('Mouth — visemes', 'head', 'Mouth Rest');
for (const [side, sign] of [
  ['L', -1],
  ['R', 1],
]) {
  ['Open', 'Half', 'Closed', 'Sad'].forEach((name, col) =>
    mesh(
      `Eye ${side} ${name}`,
      'features',
      'head',
      sign * 50,
      -173,
      53,
      106,
      [(col + (side === 'L' ? 0 : 0.5)) / 4, 0.5, (col + (side === 'L' ? 0.5 : 1)) / 4, 0.75],
      4,
      6,
      () => [
        ['head', 0.25],
        [`eye-${side}`, 0.75],
      ],
    ),
  );
  slot(`Eye ${side} — lids`, 'head', `Eye ${side} Open`);
  ['Neutral', 'Sad', 'Joy'].forEach((name, col) =>
    mesh(
      `Brow ${side} ${name}`,
      'features',
      'head',
      sign * 50,
      -199,
      60,
      120,
      [(col + (side === 'L' ? 0 : 0.5)) / 4, 0.75, (col + (side === 'L' ? 0.5 : 1)) / 4, 1],
      4,
      5,
      () => [
        ['head', 0.2],
        [`brow-${side}`, 0.8],
      ],
    ),
  );
  slot(`Brow ${side} — expression`, 'head', `Brow ${side} Neutral`);
  mesh(
    `Tear ${side}`,
    'features',
    `tear-${side}`,
    0,
    0,
    25,
    50,
    [(3 + (side === 'L' ? 0 : 0.5)) / 4, 0.75, (3 + (side === 'L' ? 0.5 : 1)) / 4, 1],
    3,
    4,
    () => [[`tear-${side}`, 1]],
  );
  slot(`Tear ${side} — drops`, `tear-${side}`, null);
}
const skeleton = {
  bones,
  slots,
  attachments: attachments.map(({ _bound, _slotBone, ...a }) => a),
  ikConstraints: [],
  skins: [],
  activeSkin: '',
};
const setup = new core.Skeleton(structuredClone(skeleton));
core.solveFK(setup.data, setup.boneIndexMap, setup.pose);
for (let i = 0; i < skeleton.attachments.length; i++) {
  const a = skeleton.attachments[i],
    wm = setup.pose.worldMatrices,
    source = attachments[i],
    slotOffset = index.get(source._slotBone) * 6;
  const slotWorld = wm.slice(slotOffset, slotOffset + 6);
  a.boneBindings = source._bound.map((boneId) => {
    const inverse = new Float64Array(6);
    assert.ok(core.invertAffine(inverse, 0, wm, index.get(boneId) * 6));
    return {
      boneId,
      matrix: [
        inverse[0] * slotWorld[0] + inverse[2] * slotWorld[1],
        inverse[1] * slotWorld[0] + inverse[3] * slotWorld[1],
        inverse[0] * slotWorld[2] + inverse[2] * slotWorld[3],
        inverse[1] * slotWorld[2] + inverse[3] * slotWorld[3],
        inverse[0] * slotWorld[4] + inverse[2] * slotWorld[5] + inverse[4],
        inverse[1] * slotWorld[4] + inverse[3] * slotWorld[5] + inverse[5],
      ],
    };
  });
}
const smooth = { type: 'bezier', c1: 0.3, c2: 0, c3: 0.6, c4: 1 },
  stepped = { type: 'stepped' };
const boneTrack = (boneId, property, keys) => ({
  kind: 'boneProperty',
  boneId,
  property,
  keyframes: keys.map(([time, value]) => ({ time, value, curve: smooth })),
});
const attachmentTrack = (slotId, keys) => ({
  kind: 'slotAttachment',
  slotId,
  keyframes: keys.map(([time, attachmentId]) => ({ time, attachmentId, curve: stepped })),
});
const clip = (name, duration, timelines) => ({ name, duration, loop: true, timelines });
const blink = (side, times, duration, base = 'Open') =>
  attachmentTrack(`Eye ${side} — lids`, [
    [0, `Eye ${side} ${base}`],
    ...times.flatMap((t) => [
      [t, `Eye ${side} Half`],
      [t + 0.06, `Eye ${side} Closed`],
      [t + 0.12, `Eye ${side} Half`],
      [t + 0.18, `Eye ${side} ${base}`],
    ]),
    [duration, `Eye ${side} ${base}`],
  ]);
const talkingKeys = [
  [0, 'Rest'],
  [0.18, 'AH'],
  [0.35, 'EE'],
  [0.53, 'OH'],
  [0.72, 'Rest'],
  [0.95, 'OO'],
  [1.1, 'AH'],
  [1.28, 'EE'],
  [1.43, 'MBP'],
  [1.57, 'AH'],
  [1.74, 'Rest'],
  [2.05, 'MBP'],
  [2.15, 'OH'],
  [2.37, 'EE'],
  [2.52, 'Rest'],
  [2.68, 'FV'],
  [2.85, 'AH'],
  [3.05, 'MBP'],
  [3.14, 'AH'],
  [3.33, 'EE'],
  [3.48, 'Rest'],
  [4, 'Rest'],
];
const animations = [
  clip('Talking', 4, [
    attachmentTrack(
      'Mouth — visemes',
      talkingKeys.map(([t, shape]) => [t, `Mouth ${shape}`]),
    ),
    boneTrack(
      'jaw',
      'y',
      talkingKeys.map(([t, shape]) => [
        t,
        -55 + { Rest: 0, AH: 7, EE: 2, OH: 5, OO: 2, FV: 0.5, MBP: 0 }[shape],
      ]),
    ),
    boneTrack('head', 'rotation', [
      [0, 0],
      [0.8, -0.025],
      [1.6, 0.018],
      [2.3, -0.015],
      [3.2, 0.022],
      [4, 0],
    ]),
    ...['L', 'R'].map((side) => blink(side, [0.76, 2.72], 4)),
    ...['L', 'R'].map((side) =>
      boneTrack(`brow-${side}`, 'y', [
        [0, -205],
        [0.25, -209],
        [1.4, -205],
        [2.15, -211],
        [2.6, -205],
        [4, -205],
      ]),
    ),
  ]),
  clip('Crying', 5, [
    attachmentTrack('Mouth — visemes', [
      [0, 'Mouth Rest'],
      [0.6, 'Mouth MBP'],
      [1.3, 'Mouth OH'],
      [1.7, 'Mouth MBP'],
      [2.5, 'Mouth OH'],
      [2.9, 'Mouth MBP'],
      [3.7, 'Mouth OH'],
      [4.1, 'Mouth MBP'],
      [4.8, 'Mouth Rest'],
      [5, 'Mouth Rest'],
    ]),
    boneTrack('head', 'rotation', [
      [0, 0],
      [0.6, 0.065],
      [1.3, 0.04],
      [1.7, 0.07],
      [2.5, 0.045],
      [2.9, 0.072],
      [3.7, 0.03],
      [4.5, 0.025],
      [5, 0],
    ]),
    boneTrack('jaw', 'y', [
      [0, -55],
      [0.7, -51],
      [1.3, -49],
      [1.5, -53],
      [1.65, -50],
      [2, -54],
      [2.5, -48],
      [2.7, -52],
      [2.85, -49],
      [3.2, -54],
      [3.7, -49],
      [4.2, -52],
      [5, -55],
    ]),
    ...['L', 'R'].flatMap((side) => [
      blink(side, [1.55, 2.95], 5, 'Sad'),
      attachmentTrack(`Brow ${side} — expression`, [
        [0, `Brow ${side} Neutral`],
        [0.35, `Brow ${side} Sad`],
        [4.8, `Brow ${side} Neutral`],
        [5, `Brow ${side} Neutral`],
      ]),
      boneTrack(`lip-${side}`, 'y', [
        [0, -83],
        [0.4, -76],
        [1.4, -74],
        [1.6, -77],
        [2.5, -74],
        [2.7, -76],
        [3.8, -74],
        [5, -83],
      ]),
      attachmentTrack(`Tear ${side} — drops`, [
        [0, null],
        [side === 'L' ? 0.75 : 1.2, `Tear ${side}`],
        [4.55, null],
        [5, null],
      ]),
      boneTrack(`tear-${side}`, 'y', [
        [0, -149],
        [1.2, -149],
        [1.9, -95],
        [2, -149],
        [2.8, -93],
        [2.9, -149],
        [3.7, -94],
        [3.8, -149],
        [4.6, -90],
        [5, -149],
      ]),
    ]),
  ]),
  clip('Head Tilt', 4, [
    boneTrack('head', 'rotation', [
      [0, 0],
      [0.7, -0.16],
      [1.3, -0.16],
      [2, 0.13],
      [2.7, 0.13],
      [3.5, 0],
      [4, 0],
    ]),
    ...['L', 'R'].map((side) => blink(side, [1.48, 3.4], 4)),
    boneTrack('brow-L', 'y', [
      [0, -205],
      [0.7, -211],
      [1.3, -211],
      [2, -205],
      [4, -205],
    ]),
  ]),
  clip('Laughing', 4, [
    attachmentTrack('Mouth — visemes', [
      [0, 'Mouth Rest'],
      [0.3, 'Mouth EE'],
      [0.65, 'Mouth Laugh'],
      [2.85, 'Mouth EE'],
      [3.5, 'Mouth Rest'],
      [4, 'Mouth Rest'],
    ]),
    boneTrack('jaw', 'y', [
      [0, -55],
      [0.65, -49],
      [0.85, -43],
      [1.02, -50],
      [1.2, -43],
      [1.37, -50],
      [1.55, -44],
      [1.72, -51],
      [1.9, -44],
      [2.07, -51],
      [2.25, -45],
      [2.43, -52],
      [2.65, -47],
      [3.15, -54],
      [4, -55],
    ]),
    boneTrack('head', 'rotation', [
      [0, 0],
      [0.65, -0.055],
      [1.05, -0.02],
      [1.5, -0.055],
      [1.95, -0.015],
      [2.4, -0.06],
      [3.3, 0.02],
      [4, 0],
    ]),
    boneTrack('head', 'y', [
      [0, 155],
      [0.65, 152],
      [0.85, 155],
      [1.02, 152],
      [1.2, 155],
      [1.37, 152],
      [1.55, 155],
      [1.72, 152],
      [1.9, 155],
      [2.07, 152],
      [2.25, 155],
      [2.43, 152],
      [2.65, 155],
      [4, 155],
    ]),
    ...['L', 'R'].flatMap((side) => [
      attachmentTrack(`Eye ${side} — lids`, [
        [0, `Eye ${side} Open`],
        [0.5, `Eye ${side} Half`],
        [0.65, `Eye ${side} Closed`],
        [2.9, `Eye ${side} Half`],
        [3.3, `Eye ${side} Open`],
        [4, `Eye ${side} Open`],
      ]),
      attachmentTrack(`Brow ${side} — expression`, [
        [0, `Brow ${side} Neutral`],
        [0.5, `Brow ${side} Joy`],
        [3.2, `Brow ${side} Neutral`],
        [4, `Brow ${side} Neutral`],
      ]),
      boneTrack(`cheek-${side}`, 'y', [
        [0, -115],
        [0.6, -121],
        [2.7, -121],
        [3.4, -115],
        [4, -115],
      ]),
      boneTrack(`lip-${side}`, 'x', [
        [0, side === 'L' ? -42 : 42],
        [0.6, side === 'L' ? -46 : 46],
        [2.7, side === 'L' ? -46 : 46],
        [4, side === 'L' ? -42 : 42],
      ]),
    ]),
  ]),
];
const project = {
  format: core.PROJECT_FORMAT,
  schemaVersion: core.PROJECT_SCHEMA_VERSION,
  projectId: 'face-performance-example',
  name: 'Facial performance — practical weights',
  assetManifest: {},
  editor: { activeArtboardId: 'face-artboard', activeRigId: 'face-rig' },
  artboards: [
    {
      id: 'face-artboard',
      name: 'Facial performance',
      width: 640,
      height: 640,
      nodes: [
        {
          id: 'face-rig',
          name: 'Facial performance rig',
          type: 'rig',
          parentId: null,
          transform: { ...pose(320, 300), pivotX: 0, pivotY: 0 },
          opacity: 1,
          visible: true,
          skeleton,
          animations,
        },
      ],
    },
  ],
};
for (const id of ['base', 'features'])
  project.assetManifest[id] = {
    name: `${id}.png`,
    source: 'embedded',
    dataUrl: 'data:image/png;base64,' + readFileSync(join(here, `${id}.png`)).toString('base64'),
  };
const json = core.serializeProject(project);
assert.deepEqual(JSON.parse(core.serializeProject(core.deserializeProject(json))), JSON.parse(json));
writeFileSync(join(here, 'Face-Performance.bbbproj'), json + '\n');
console.log(
  `${bones.length} bones, ${slots.length} layers, ${attachments.length} UV sprites, four expressive clips; generated PNGs embedded unchanged.`,
);
