// Rebuild the editable example from the unchanged Image Generation PNG.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const scratch = join(root, '.smoke/face-weights');
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
  ['head', 'Head / rigid base', null, 0, 0, 42],
  ['jaw', 'Jaw', 'head', 0, 100, 35],
  ['cheek-left', 'Cheek L', 'head', -78, 48, 20],
  ['cheek-right', 'Cheek R', 'head', 78, 48, 20],
  ['brow-left', 'Brow L', 'head', -62, -49, 20],
  ['brow-right', 'Brow R', 'head', 62, -49, 20],
].map(([id, name, parentId, x, y, length]) => ({ id, name, parentId, length, setupPose: pose(x, y) }));

const meshVertices = [],
  meshUVs = [],
  meshTriangles = [],
  meshHull = [],
  weights = [];
const cells = 24,
  edge = 420;
const smoothstep = (x) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};
const gaussian = (x, y, cx, cy, sx, sy) => Math.exp(-0.5 * (((x - cx) / sx) ** 2 + ((y - cy) / sy) ** 2));
for (let row = 0; row <= cells; row++) {
  for (let col = 0; col <= cells; col++) {
    const x = (col / cells - 0.5) * edge,
      y = (row / cells - 0.5) * edge;
    meshVertices.push(x, y);
    meshUVs.push(col / cells, row / cells);
    // Keep the two strongest facial influences and the rigid head baseline.
    // Every vertex is normalized; all coordinates remain in the original mesh space.
    const local = [
      [1, 0.9 * smoothstep((y - 35) / 105) * Math.exp(-((x / 120) ** 4))],
      [2, 0.82 * gaussian(x, y, -78, 48, 34, 35)],
      [3, 0.82 * gaussian(x, y, 78, 48, 34, 35)],
      [4, 0.72 * gaussian(x, y, -62, -49, 39, 15)],
      [5, 0.72 * gaussian(x, y, 62, -49, 39, 15)],
    ]
      .filter(([, w]) => w > 0.001)
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, 2);
    const total = local.reduce((sum, [, w]) => sum + w, 0);
    const scale = total > 0.95 ? 0.95 / total : 1;
    const influences = [[0, 1 - total * scale], ...local.map(([i, w]) => [i, w * scale])].sort(
      (a, b) => a[0] - b[0],
    );
    weights.push(influences.length, ...influences.flat());
  }
}
for (let row = 0; row < cells; row++)
  for (let col = 0; col < cells; col++) {
    const a = row * (cells + 1) + col,
      b = a + 1,
      c = a + cells + 1,
      d = c + 1;
    meshTriangles.push(a, b, d, a, d, c);
  }
for (let col = 0; col <= cells; col++) meshHull.push(col);
for (let row = 1; row <= cells; row++) meshHull.push(row * (cells + 1) + cells);
for (let col = cells - 1; col >= 0; col--) meshHull.push(cells * (cells + 1) + col);
for (let row = cells - 1; row > 0; row--) meshHull.push(row * (cells + 1));

const attachment = {
  id: 'face-mesh',
  name: 'Face weighted mesh',
  type: 'mesh',
  textureId: 'face-image',
  meshVertices,
  meshUVs,
  meshTriangles,
  meshHull,
  weights,
};
const skeleton = {
  bones,
  slots: [
    {
      id: 'face-slot',
      name: 'Face mesh — paint here',
      boneId: 'head',
      defaultAttachmentId: attachment.id,
      color: 0xffffffff,
    },
  ],
  attachments: [attachment],
  ikConstraints: [],
  skins: [],
  activeSkin: '',
};
const setup = new core.Skeleton(structuredClone(skeleton));
core.solveFK(setup.data, setup.boneIndexMap, setup.pose);
attachment.boneBindings = bones.map((bone) => {
  const inverse = new Float64Array(6);
  assert.ok(core.invertAffine(inverse, 0, setup.pose.worldMatrices, setup.boneIndexMap.get(bone.id) * 6));
  return { boneId: bone.id, matrix: Array.from(inverse) };
});
const times = [0, 0.8, 1.6, 2.4, 3.2, 4];
const track = (boneId, property, values) => ({
  kind: 'boneProperty',
  boneId,
  property,
  keyframes: values.map((value, index) => ({
    time: times[index],
    value,
    curve: { type: 'bezier', c1: 0.35, c2: 0, c3: 0.65, c4: 1 },
  })),
});
const animations = [
  {
    name: 'Face — weights demo',
    duration: 4,
    loop: true,
    timelines: [
      track('jaw', 'y', [100, 90, 100, 124, 100, 100]),
      track('cheek-left', 'x', [-78, -90, -78, -82, -78, -78]),
      track('cheek-right', 'x', [78, 90, 78, 82, 78, 78]),
      track('cheek-left', 'y', [48, 36, 48, 49, 48, 48]),
      track('cheek-right', 'y', [48, 36, 48, 49, 48, 48]),
      track('brow-left', 'y', [-49, -53, -49, -64, -49, -49]),
      track('brow-right', 'y', [-49, -53, -49, -64, -49, -49]),
    ],
  },
];
const bytes = readFileSync(join(here, 'face.png'));
assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
const project = {
  format: core.PROJECT_FORMAT,
  schemaVersion: core.PROJECT_SCHEMA_VERSION,
  projectId: 'face-weights-example',
  name: 'Face — weight painting test',
  assetManifest: {
    'face-image': {
      name: 'face.png',
      source: 'embedded',
      dataUrl: 'data:image/png;base64,' + bytes.toString('base64'),
    },
  },
  editor: { activeArtboardId: 'face-artboard', activeRigId: 'face-rig' },
  artboards: [
    {
      id: 'face-artboard',
      name: 'Face weights',
      width: 640,
      height: 640,
      nodes: [
        {
          id: 'face-rig',
          name: 'Face weights rig',
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
const json = core.serializeProject(project);
assert.deepEqual(JSON.parse(core.serializeProject(core.deserializeProject(json))), JSON.parse(json));
writeFileSync(join(here, 'Face-Weights.bbbproj'), json + '\n');
console.log(
  `Face-Weights.bbbproj: ${bones.length} bones, ${meshVertices.length / 2} weighted vertices, ${meshTriangles.length / 3} triangles, one 4-second looping clip; texture ${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)} embedded.`,
);
