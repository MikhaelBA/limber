import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const here = dirname(fileURLToPath(import.meta.url)),
  root = resolve(here, '../..'),
  scratch = join(root, '.smoke/face-performance');
mkdirSync(scratch, { recursive: true });
const alias = {
  '@limber/core': join(root, 'packages/core/src/index.ts'),
  '@limber/mesh': join(root, 'packages/mesh/src/index.ts'),
};
for (const [name, source] of [
  ['core', 'packages/core/src/index.ts'],
  ['runtime', 'packages/runtime/src/index.ts'],
  ['editor', 'packages/editor/src/engine/EditorEngine.ts'],
])
  await build({
    entryPoints: [join(root, source)],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: join(scratch, name + '.mjs'),
    alias,
  });
const core = await import(pathToFileURL(join(scratch, 'core.mjs'))),
  runtime = await import(pathToFileURL(join(scratch, 'runtime.mjs'))),
  { EditorEngine } = await import(pathToFileURL(join(scratch, 'editor.mjs')));
const json = readFileSync(join(here, 'Face-Performance.bbbproj'), 'utf8'),
  project = core.deserializeProject(json),
  rig = project.artboards[0].nodes[0];
assert.deepEqual(JSON.parse(core.serializeProject(project)), JSON.parse(json));
for (const id of ['base', 'features'])
  assert(
    Buffer.from(project.assetManifest[id].dataUrl.split(',')[1], 'base64').equals(
      readFileSync(join(here, id + '.png')),
    ),
  );
const { program, diagnostics } = runtime.compileRuntime(project);
assert.equal(diagnostics.filter((d) => d.severity === 'error').length, 0);
writeFileSync(join(scratch, 'program.json'), JSON.stringify(program));
const asset = runtime.loadRuntime(runtime.encodeRuntime(program)),
  engine = new EditorEngine(),
  control = new EditorEngine();
engine.loadProject(structuredClone(project));
engine.mode = 'animate';
const rigid = structuredClone(project);
rigid.artboards[0].nodes[0].skeleton.attachments.forEach((a) => {
  delete a.weights;
});
control.loadProject(rigid);
control.mode = 'animate';
const clips = [];
for (const clip of rig.animations) {
  const native = new runtime.NativeRigPlayer(asset, rig.id);
  native.play(clip.name);
  native.pause();
  engine.setAnimation(clip.name);
  control.setAnimation(clip.name);
  let parityError = 0,
    weightEffect = 0,
    frames = Math.round(clip.duration * 120);
  for (let frame = 1; frame <= frames; frame++) {
    native.step();
    const time = (frame % frames) / 120;
    engine.scrub(time);
    engine.tick(0);
    control.scrub(time);
    control.tick(0);
    const visible = new Set(engine.skeleton.pose.slots.map((slot) => slot.attachmentId).filter(Boolean));
    for (const attachment of rig.skeleton.attachments.filter((a) => visible.has(a.id))) {
      const actual = native.getDeformedVertices(attachment.id),
        expected = engine.skeleton.pose.attachments.get(attachment.id).verts,
        unweighted = control.skeleton.pose.attachments.get(attachment.id).verts;
      for (let i = 0; i < actual.length; i++) {
        assert(Number.isFinite(actual[i]));
        if (Math.abs(actual[i] - expected[i]) > 0.001)
          throw new Error(
            `${clip.name} frame ${frame} ${attachment.name} index ${i}: native ${actual[i]} source ${expected[i]}`,
          );
        parityError = Math.max(parityError, Math.abs(actual[i] - expected[i]));
        weightEffect = Math.max(weightEffect, Math.abs(actual[i] - unweighted[i]));
      }
    }
  }
  assert(parityError < 0.001, `${clip.name} parity ${parityError}`);
  assert(weightEffect > 1, `${clip.name} must visibly use mesh weights`);
  clips.push({
    name: clip.name,
    seconds: clip.duration,
    runtimeFrames: frames,
    maxParityError: parityError,
    maxWeightEffect: weightEffect,
  });
}
const report = {
  roundTrip: 'passed',
  originalGeneratedPixels: 'passed',
  bones: rig.skeleton.bones.length,
  layers: rig.skeleton.slots.length,
  attachments: rig.skeleton.attachments.length,
  clips,
};
writeFileSync(join(here, 'validation.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
