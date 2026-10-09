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
