import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url)),
  root = resolve(here, '../..');
const scratch = join(root, '.smoke/face-weights');
mkdirSync(scratch, { recursive: true });
const alias = {
  '@limber/core': join(root, 'packages/core/src/index.ts'),
  '@limber/mesh': join(root, 'packages/mesh/src/index.ts'),
};
for (const [name, source] of [
  ['core', 'packages/core/src/index.ts'],
  ['runtime', 'packages/runtime/src/index.ts'],
  ['editor', 'packages/editor/src/engine/EditorEngine.ts'],
]) {
  await build({
    entryPoints: [join(root, source)],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: join(scratch, name + '.mjs'),
    alias,
  });
}
const core = await import(pathToFileURL(join(scratch, 'core.mjs')));
const runtime = await import(pathToFileURL(join(scratch, 'runtime.mjs')));
const { EditorEngine } = await import(pathToFileURL(join(scratch, 'editor.mjs')));
const json = readFileSync(join(here, 'Face-Weights.bbbproj'), 'utf8');
const project = core.deserializeProject(json),
  rig = project.artboards[0].nodes[0],
  mesh = rig.skeleton.attachments[0];
assert.deepEqual(JSON.parse(core.serializeProject(project)), JSON.parse(json));
assert.ok(
  Buffer.from(project.assetManifest['face-image'].dataUrl.split(',')[1], 'base64').equals(
    readFileSync(join(here, 'face.png')),
  ),
);
assert.equal(mesh.meshVertices.length / 2, 625);
assert.equal(mesh.meshTriangles.length / 3, 1152);
let at = 0,
  mixedVertices = 0;
for (let v = 0; v < 625; v++) {
  const count = mesh.weights[at++];
  assert.ok(count >= 1 && count <= 3);
  if (count > 1) mixedVertices++;
  let sum = 0;
  for (let i = 0; i < count; i++) {
    assert.ok(mesh.weights[at] >= 0 && mesh.weights[at] < 6);
    sum += mesh.weights[at + 1];
    at += 2;
  }
  assert.ok(Math.abs(sum - 1) < 1e-12);
}
assert.equal(at, mesh.weights.length);
assert.ok(mixedVertices > 200);
assert.equal(
  rig.animations[0].timelines.some((track) => track.kind === 'deform' || track.boneId === 'head'),
  false,
);
const { program, diagnostics } = runtime.compileRuntime(project);
assert.equal(diagnostics.filter((d) => d.severity === 'error').length, 0);
const native = new runtime.NativeRigPlayer(runtime.loadRuntime(runtime.encodeRuntime(program)), rig.id);
const engine = new EditorEngine();
engine.loadProject(structuredClone(project));
engine.mode = 'animate';
engine.setAnimation(rig.animations[0].name);
engine.tick(0);
const setup = Array.from(native.getDeformedVertices(mesh.id));
setup.forEach((value, i) => assert.ok(Math.abs(value - mesh.meshVertices[i]) < 0.0001));
const rigidProject = structuredClone(project);
delete rigidProject.artboards[0].nodes[0].skeleton.attachments[0].weights;
const control = new EditorEngine();
control.loadProject(rigidProject);
control.mode = 'animate';
control.setAnimation(rig.animations[0].name);
native.play(rig.animations[0].name);
native.pause();
let maxParityError = 0,
  maxWeightedMovement = 0,
  maxRigidMovement = 0;
for (let tick = 1; tick <= 960; tick++) {
  native.step();
  const time = (tick % 480) / 120;
  engine.scrub(time);
  engine.tick(0);
  control.scrub(time);
  control.tick(0);
  const vertices = native.getDeformedVertices(mesh.id);
  const expected = engine.skeleton.pose.attachments.get(mesh.id).verts;
  const unweighted = control.skeleton.pose.attachments.get(mesh.id).verts;
  for (let i = 0; i < vertices.length; i++) {
    assert.ok(Number.isFinite(vertices[i]));
    maxParityError = Math.max(maxParityError, Math.abs(vertices[i] - expected[i]));
    maxWeightedMovement = Math.max(maxWeightedMovement, Math.abs(vertices[i] - setup[i]));
    maxRigidMovement = Math.max(maxRigidMovement, Math.abs(unweighted[i] - setup[i]));
  }
}
assert.ok(maxParityError < 0.001, `Native/editor error ${maxParityError}`);
assert.ok(maxWeightedMovement > 18, `Weighted movement ${maxWeightedMovement}`);
assert.ok(
  maxRigidMovement < 0.0001,
  'Facial animation without weights must leave this stationary head image unchanged',
);
assert.equal(
  core.serializeProject(project),
  core.serializeProject(core.deserializeProject(json)),
  'Verification preserves source',
);
const report = {
  roundTrip: 'passed',
  embeddedOriginalPNG: 'passed',
  bindPose: 'passed',
  bones: 6,
  vertices: 625,
  triangles: 1152,
  mixedVertices,
  runtimeFrames: 960,
  maxParityError,
  maxWeightedMovement,
  maxRigidMovement,
  noDeformOrHeadAnimation: true,
};
writeFileSync(join(here, 'validation.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
