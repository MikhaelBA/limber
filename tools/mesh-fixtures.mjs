import { CURRENT_SOURCE_SCHEMA } from './project-schema.mjs';
import { readFileSync } from 'node:fs';

/** Reproducible spec Standard/Heavy geometry, no random input or external artwork. */
export function meshFixture(kind) {
  if (!['Standard', 'Heavy'].includes(kind)) throw new Error('Unknown mesh fixture');
  const source = JSON.parse(readFileSync('fixtures/bbbproj-v5-bind-mesh.json', 'utf8'));
  const rig = source.artboards[0].nodes[0],
    mesh = rig.skeleton.attachments[0];
  const side = kind === 'Standard' ? 50 : 100,
    boneCount = kind === 'Standard' ? 60 : 120;
  rig.skeleton.bones = Array.from({ length: boneCount }, (_, index) => ({
    id: index === 0 ? 'root' : `bone-${index}`,
    name: `bone ${index}`,
    parentId: null,
    length: 20,
    setupPose: {
      x: (index % 12) * 40,
      y: Math.floor(index / 12) * 40,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      shearX: 0,
      shearY: 0,
    },
  }));
  mesh.meshVertices = [];
  mesh.meshUVs = [];
  mesh.meshTriangles = [];
  mesh.meshHull = [];
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side; x++) {
      mesh.meshVertices.push((x * 480) / (side - 1), (y * 400) / (side - 1));
      mesh.meshUVs.push(x / (side - 1), y / (side - 1));
      if (x < side - 1 && y < side - 1) {
        const i = y * side + x;
        mesh.meshTriangles.push(i, i + 1, i + side + 1, i, i + side + 1, i + side);
      }
    }
  for (let x = 0; x < side; x++) mesh.meshHull.push(x);
  for (let y = 1; y < side; y++) mesh.meshHull.push(y * side + side - 1);
  for (let x = side - 2; x >= 0; x--) mesh.meshHull.push((side - 1) * side + x);
  for (let y = side - 2; y > 0; y--) mesh.meshHull.push(y * side);
  mesh.boneBindings = rig.skeleton.bones.map((bone) => ({
    boneId: bone.id,
    matrix: [1, 0, 0, 1, -bone.setupPose.x, -bone.setupPose.y],
  }));
  delete mesh.weights;
  rig.animations = [{ name: 'idle', duration: 1, loop: true, timelines: [] }];
  return source;
}

/** Full spec playback profiles, with owned geometry and deterministic authored motion. */
export function playbackFixture(kind) {
  const project = meshFixture(kind);
  const profile = JSON.parse(readFileSync(`fixtures/mesh-${kind.toLowerCase()}-v1.json`, 'utf8'));
  if (profile.fixtureVersion !== 1 || profile.kind !== kind)
    throw new Error('Unknown playback fixture version');
  project.schemaVersion = CURRENT_SOURCE_SCHEMA;
  project.name = `${kind} character benchmark v1`;
  const rig = project.artboards[0].nodes[0],
    data = rig.skeleton,
    mesh = data.attachments[0];
  if (data.bones.length !== profile.bones || mesh.meshVertices.length / 2 !== profile.side ** 2)
    throw new Error('Playback profile geometry mismatch');
  const targets = [];
  for (let index = 0; index < profile.constraints; index++) {
    const parent = data.bones[1 + index * 2],
      child = data.bones[2 + index * 2];
    child.parentId = parent.id;
    child.setupPose.x = parent.length;
    child.setupPose.y = 0;
    const target = data.bones[profile.bones - profile.constraints + index];
    target.setupPose.x = parent.setupPose.x + 30;
    target.setupPose.y = parent.setupPose.y + 10;
    targets.push(target);
    data.ikConstraints.push({
      id: `benchmark-ik-${index}`,
      bones: [parent.id, child.id],
      targetId: target.id,
      poleVectorId: null,
      bendDirection: 1,
      mix: 0.7,
      softness: 0,
      order: index,
    });
  }
  const setupWorld = new Map();
  mesh.boneBindings = data.bones.map((bone) => {
    const parent = setupWorld.get(bone.parentId) ?? [0, 0];
    const position = [parent[0] + bone.setupPose.x, parent[1] + bone.setupPose.y];
    setupWorld.set(bone.id, position);
    return { boneId: bone.id, matrix: [1, 0, 0, 1, -position[0] || 0, -position[1] || 0] };
  });
  mesh.weights = [];
  for (let index = 0; index < profile.side ** 2; index++) {
    mesh.weights.push(profile.influences);
    for (let influence = 0; influence < profile.influences; influence++)
      mesh.weights.push((index + influence) % profile.bones, 1 / profile.influences);
  }
  const curve = { type: 'linear' };
  rig.animations = Array.from({ length: profile.animations }, (_, clipIndex) => {
    const timelines = data.bones.map((bone, index) => ({
      kind: 'boneProperty',
      boneId: bone.id,
      property: 'rotation',
      keyframes: [
        { time: 0, value: 0, curve },
        { time: 1, value: ((index % 7) - 3) * (clipIndex + 1) * 0.015, curve },
        { time: 2, value: 0, curve },
      ],
    }));
    for (const target of targets)
      timelines.push({
        kind: 'boneProperty',
        boneId: target.id,
        property: 'x',
        keyframes: [
          { time: 0, value: target.setupPose.x, curve },
          { time: 1, value: target.setupPose.x + 5 + clipIndex, curve },
          { time: 2, value: target.setupPose.x, curve },
        ],
      });
    if (profile.deform)
      timelines.push({
        kind: 'deform',
        attachmentId: mesh.id,
        keyframes: [
          { time: 0, offsets: null, curve },
          {
            time: 1,
            offsets: mesh.meshVertices.map((value, index) =>
              index % 2 ? Math.sin(value / 40) * 8 : Math.cos(value / 50) * 4,
            ),
            curve,
          },
          { time: 2, offsets: null, curve },
        ],
      });
    return {
      name: `benchmark-${String(clipIndex).padStart(2, '0')}`,
      duration: profile.duration,
      loop: true,
      timelines,
    };
  });
  if (profile.clipping) {
    data.attachments.push({
      id: 'benchmark-clip',
      name: 'benchmark clip',
      type: 'clipping',
      textureId: '',
      meshVertices: [-20, -20, 500, -20, 500, 420, -20, 420],
      meshHull: [0, 1, 2, 3],
      endSlotId: null,
    });
    data.slots.unshift({
      id: 'benchmark-clip-slot',
      name: 'benchmark clip slot',
      boneId: 'root',
      defaultAttachmentId: 'benchmark-clip',
      color: 0xffffffff,
    });
  }
  return project;
}
