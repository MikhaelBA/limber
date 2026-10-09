// Tests the delivered native project using the application's actual core/runtime.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..'),
  scratch = join(root, '.smoke/fox-adventurer');
mkdirSync(scratch, { recursive: true });
await build({
  entryPoints: [join(root, 'packages/runtime/src/player.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: join(scratch, 'runtime.mjs'),
  alias: {
    '@limber/core': join(root, 'packages/core/src/index.ts'),
    '@limber/mesh': join(root, 'packages/mesh/src/index.ts'),
  },
});
const core = await import(pathToFileURL(join(scratch, 'core.mjs')));
const { RuntimePlayer } = await import(pathToFileURL(join(scratch, 'runtime.mjs')));
const json = readFileSync(join(here, 'Fox-Adventurer.bbbproj'), 'utf8');
const project = core.deserializeProject(json);
assert.deepEqual(JSON.parse(core.serializeProject(project)), JSON.parse(json));
const rig = project.artboards[0].nodes[0],
  data = rig.skeleton;
assert.equal(data.slots.length, 16);
assert.equal(Object.keys(project.assetManifest).length, 2);
for (const meta of Object.values(project.assetManifest)) {
  const bytes = Buffer.from(meta.dataUrl.split(',')[1], 'base64');
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  assert.equal(bytes.readUInt32BE(16), 1254);
  assert.equal(bytes.readUInt32BE(20), 1254);
  assert.ok(bytes.equals(readFileSync(join(here, meta.name))));
}
// At setup, bind matrices must reproduce the original local geometry in world space.
const skeleton = new core.Skeleton(structuredClone(data));
core.solveFK(skeleton.data, skeleton.boneIndexMap, skeleton.pose);
core.updateSkinning(skeleton);
for (const slot of skeleton.data.slots) {
  const att = skeleton.data.attachments.find((a) => a.id === slot.defaultAttachmentId);
  const source = att.type === 'mesh' ? att.meshVertices : att.vertices;
  const world = skeleton.pose.attachments.get(att.id).verts;
  const m = skeleton.pose.worldMatrices.subarray(
    skeleton.boneIndexMap.get(slot.boneId) * 6,
    skeleton.boneIndexMap.get(slot.boneId) * 6 + 6,
  );
  for (let i = 0; i < source.length; i += 2) {
    const x = m[0] * source[i] + m[2] * source[i + 1] + m[4];
    const y = m[1] * source[i] + m[3] * source[i + 1] + m[5];
    assert.ok(Math.hypot(world[i] - x, world[i + 1] - y) < 1e-4, `Bind drift: ${att.name}`);
  }
}
const captures = [];
let totalFrames = 0,
  maxIKError = 0;
const results = [];
for (const skin of data.skins)
  for (const anim of rig.animations) {
    const player = new RuntimePlayer({ skeleton: structuredClone(data), animations: rig.animations });
    player.setSkin(skin.name);
    player.setAnimation(anim.name, { loop: true });
    player.update(0);
    const initial = Array.from(player.getDeformedVertices(skin.attachments['layer-3']));
    const events = [];
    player.onEvent((e) => events.push(e.eventName));
    let maxClothChange = 0;
    const n = Math.ceil(anim.duration * 120);
    for (let f = 0; f < n; f++) {
      player.update(1 / 60);
      totalFrames++;
      assert.ok(Array.from(player.getWorldTransforms()).every(Number.isFinite));
      for (const slot of data.slots) {
        const slotIndex = data.slots.indexOf(slot),
          id = player.getSlotAttachmentId(slotIndex);
        assert.equal(id, skin.attachments[slot.id]);
        assert.ok(Array.from(player.getDeformedVertices(id)).every(Number.isFinite));
      }
      const scarf = player.getDeformedVertices(skin.attachments['layer-3']);
      maxClothChange = Math.max(maxClothChange, ...Array.from(scarf, (v, i) => Math.abs(v - initial[i])));
      const m = player.getWorldTransforms(),
        end = data.bones.findIndex((b) => b.id === 'Forearm R') * 6;
      const target = data.bones.findIndex((b) => b.id === 'Hand IK target') * 6;
      const error = Math.hypot(
        m[end] * 41 + m[end + 4] - m[target + 4],
        m[end + 1] * 41 + m[end + 5] - m[target + 5],
      );
      maxIKError = Math.max(maxIKError, error);
      assert.ok(error < 0.002, `IK misses target in ${anim.name}: ${error}`);
      if (
        f === Math.round((anim.name === 'Wave (IK)' ? 0.8 : 0.6) * 60) - 1 &&
        (anim.name === 'Idle' || anim.name === 'Wave (IK)')
      ) {
        captures.push({
          skin: skin.name,
          animation: anim.name,
          layers: player.getDrawOrder().map((i) => {
            const id = player.getSlotAttachmentId(i),
              a = skeleton.data.attachments.find((a) => a.id === id);
            return {
              textureId: a.textureId,
              verts: Array.from(player.getDeformedVertices(id)),
              uvs: a.type === 'mesh' ? a.meshUVs : a.uvs,
              triangles: a.type === 'mesh' ? a.meshTriangles : [0, 1, 2, 0, 2, 3],
            };
          }),
        });
      }
    }
    assert.ok(maxClothChange > 1, `Cloth did not move in ${anim.name}`);
    if (anim.name === 'Wave (IK)') assert.ok(events.includes('hello'));
    if (anim.name === 'March') assert.ok(events.includes('footstep'));
    results.push({ skin: skin.name, animation: anim.name, frames: n, maxClothChange, events });
  }
const report = {
  nativeRoundTrip: 'passed',
  embeddedTextures: '2 PNGs, exact originals, 1254 × 1254',
  bindPose: '16 layers preserve authored setup geometry',
  totalFrames,
  maxIKError,
  results,
};
writeFileSync(join(here, 'validation.json'), JSON.stringify(report, null, 2) + '\n');
writeFileSync(
  join(scratch, 'preview-poses.json'),
  JSON.stringify({ captures, assetManifest: project.assetManifest }),
);
console.log(
  JSON.stringify(
    { ...report, results: results.map(({ skin, animation, frames }) => ({ skin, animation, frames })) },
    null,
    2,
  ),
);
