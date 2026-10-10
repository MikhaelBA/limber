import { playbackFixture } from './mesh-fixtures.mjs';
/** Existing weighted profiles plus reproducible IK/follow/path/spring interaction. */
export function constraintFixture(kind) {
  const project = playbackFixture(kind),
    rig = project.artboards[0].nodes[0],
    data = rig.skeleton;
  project.name = `${kind} combined constraints v1`;
  const identity = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 };
  const bone = (id, parentId = null, setup = {}) => ({
    id,
    name: id,
    parentId,
    length: 30,
    setupPose: { ...identity, ...setup },
  });
  data.bones.push(
    bone('curve-owner'),
    bone('path-root', null, { scaleX: -1.2, shearY: 0.3 }),
    bone('path-child', 'path-root', { x: 30, shearX: 0.2 }),
    bone('progress'),
  );
  const followOrder = data.ikConstraints.length;
  data.transformConstraints = [
    {
      id: 'combined-follow',
      boneId: 'curve-owner',
      targetId: 'bone-1',
      space: 'world',
      offset: { ...identity, x: 60, y: 100 },
      mixTranslation: 1,
      mixRotation: 1,
      mixScale: 1,
      mixShear: 1,
      order: followOrder,
    },
  ];
  data.paths = [
    {
      id: 'combined-path',
      name: 'Combined loop',
      boneId: 'curve-owner',
      closed: true,
      segments: [
        [0, 0, 60, -20, 140, -20, 200, 0],
        [200, 0, 240, 50, 240, 140, 200, 200],
        [200, 200, 70, 180, -60, 30, 0, 0],
      ],
    },
  ];
  data.pathConstraints = [
    {
      id: 'combined-path-follow',
      bones: ['path-root', 'path-child'],
      pathId: 'combined-path',
      progress: 0,
      driverId: 'progress',
      spacing: 30,
      mixTranslation: 1,
      mixRotation: 1,
      rotationOffset: 0,
      order: followOrder + 1,
    },
  ];
  const count = kind === 'Heavy' ? 20 : 10;
  data.secondaryConstraints = Array.from({ length: count }, (_, n) => ({
    id: `combined-spring-${n}`,
    boneId: `bone-${22 + n}`,
    preset: 'soft',
    frequency: 2,
    damping: 0.7,
    mix: 0.7,
    maxAngle: Math.PI / 2,
    order: followOrder + 2 + n,
  }));
  for (const id of ['path-root', 'path-child'])
    data.secondaryConstraints.push({
      id: `combined-spring-${id}`,
      boneId: id,
      preset: 'bouncy',
      frequency: 3,
      damping: 0.3,
      mix: 0.6,
      maxAngle: Math.PI / 2,
      order: followOrder + 2 + data.secondaryConstraints.length,
    });
  data.markers = ['curve-owner', 'path-root', 'path-child'].map((id) => ({
    id,
    name: id,
    kind: 'point',
    boneId: id,
    transform: { ...identity },
  }));
  for (const clip of rig.animations)
    clip.timelines.push({
      kind: 'boneProperty',
      boneId: 'progress',
      property: 'x',
      keyframes: [
        { time: 0, value: 0, curve: { type: 'linear' } },
        { time: 1, value: 50, curve: { type: 'linear' } },
        { time: 2, value: 100, curve: { type: 'linear' } },
      ],
    });
  return project;
}
