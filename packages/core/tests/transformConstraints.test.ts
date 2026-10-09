import { PROJECT_SCHEMA_VERSION } from '../src/project/model';
import { describe, expect, it } from 'vitest';
import {
  Skeleton,
  solveFK,
  solveConstraints,
  composeAffine,
  type TransformConstraintData,
  type SkeletonData,
  type Transform,
  projectFromLegacy,
  serializeProject,
  deserializeProject,
} from '../src/index';
import { makeBone, makeSkeletonData } from './helpers';
import { RuntimePlayer } from '../../runtime/src/player';
import { readFileSync } from 'node:fs';
import { exportSpineJson } from '../src/serialization/spineExport';
const offset: Transform = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 };
const follow = (patch: Partial<TransformConstraintData> = {}): TransformConstraintData => ({
  id: 'follow',
  boneId: 'bone',
  targetId: 'target',
  space: 'world',
  offset: { ...offset },
  mixTranslation: 1,
  mixRotation: 1,
  mixScale: 1,
  mixShear: 1,
  order: 0,
  ...patch,
});
function rig() {
  return makeSkeletonData([
    makeBone('body', null, { x: 10, y: 7, rotation: 0.6, scaleX: -1.7, scaleY: 0.8, shearX: 0.3 }),
    makeBone('bone', 'body', { x: 15, y: 12, rotation: -0.3, shearY: 0.25 }),
    makeBone('target-body', null, { x: 30, y: 50, rotation: -0.4, scaleX: 0.7, scaleY: 1.6, shearY: -0.2 }),
    makeBone('target', 'target-body', {
      x: 20,
      y: -10,
      rotation: 0.7,
      scaleX: -1.3,
      scaleY: 1.5,
      shearX: 0.2,
      shearY: 0.4,
    }),
  ]);
}
const run = (data: SkeletonData) => {
  const s = new Skeleton(data);
  solveFK(s.data, s.boneIndexMap, s.pose);
  solveConstraints(s);
  return s;
};
const world = (s: Skeleton, id: string) =>
  Array.from(s.pose.worldMatrices.slice(s.boneIndexMap.get(id)! * 6, s.boneIndexMap.get(id)! * 6 + 6));
const compare = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 4));
describe('transform follow solver and shared order', () => {
  it('holds the preceding valid pose if any constraint would overflow Float32 world storage', () => {
    for (const kind of ['follow', 'ik']) {
      const data = makeSkeletonData([
        makeBone(
          'body',
          null,
          kind === 'follow' ? { scaleX: 1e30, scaleY: 1e30 } : { scaleX: 1e38, scaleY: 1e30 },
        ),
        makeBone(
          'bone',
          'body',
          kind === 'follow'
            ? { scaleX: 0.001, scaleY: 0.001 }
            : { rotation: Math.PI / 2, scaleX: 1000, scaleY: 0.001 },
        ),
        makeBone('target', null, kind === 'follow' ? { scaleX: 1e30, scaleY: 1e30 } : { x: 1e38 }),
      ]);
      data.bones[1]!.length = 20;
      if (kind === 'follow')
        data.transformConstraints = [follow({ offset: { ...offset, scaleX: 1e30, scaleY: 1e30 } })];
      else
        data.ikConstraints = [
          {
            id: 'ik',
            bones: ['bone'],
            targetId: 'target',
            poleVectorId: null,
            bendDirection: 1,
            mix: 1,
            softness: 0,
            order: 0,
          },
        ];
      const s = new Skeleton(data);
      solveFK(s.data, s.boneIndexMap, s.pose);
      const before = Array.from(s.pose.worldMatrices),
        local = structuredClone(s.pose.bones[s.boneIndexMap.get('bone')!]!.local);
      solveConstraints(s);
      expect(Array.from(s.pose.worldMatrices)).toEqual(before);
      expect(s.pose.bones[s.boneIndexMap.get('bone')!]!.local).toEqual(local);
    }
  });
  it('loads the authored schema-7 fixture and follows an animated target in runtime', () => {
    const project = deserializeProject(readFileSync('fixtures/bbbproj-v7-transform-follow.json', 'utf8'));
    expect(deserializeProject(serializeProject(project))).toEqual(project);
    const node = project.artboards[0]!.nodes[0]!;
    if (node.type !== 'rig') throw new Error('Expected fixture rig');
    node.animations[0]!.timelines.push({
      kind: 'boneProperty',
      boneId: 'target',
      property: 'x',
      keyframes: [
        { time: 0, value: 52, curve: { type: 'linear' } },
        { time: 0.5, value: 80, curve: { type: 'linear' } },
      ],
    });
    const player = new RuntimePlayer({
      skeleton: structuredClone(node.skeleton),
      animations: node.animations,
    });
    const sk = new Skeleton(structuredClone(node.skeleton)),
      index = sk.boneIndexMap.get('follower')! * 6 + 4;
    player.setAnimation('Idle');
    player.update(0);
    const before = player.getWorldTransforms()[index]!;
    player.update(0.1);
    player.update(0.1);
    player.update(0.05);
    expect(player.getWorldTransforms()[index]).toBeCloseTo(before + 7, 4);
  });
  it('refuses unsupported compatibility export instead of silently dropping native follow', () => {
    const data = rig();
    data.transformConstraints = [follow()];
    expect(() => exportSpineJson({ skeleton: data, animations: [], assetManifest: {} })).toThrow(
      /native transform follow/,
    );
    delete data.transformConstraints;
    data.ikConstraints = [
      {
        id: 'ik',
        bones: ['bone'],
        targetId: 'target',
        poleVectorId: null,
        bendDirection: 1,
        mix: 1,
        softness: 1,
        order: 0,
      },
    ];
    expect(() => exportSpineJson({ skeleton: data, animations: [], assetManifest: {} })).toThrow(
      /native IK pole/,
    );
  });
  it('copies a full world affine through unrelated reflected/sheared parents and native/runtime parity', () => {
    const data = rig();
    data.transformConstraints = [follow()];
    const s = run(data);
    compare(world(s, 'bone'), world(s, 'target'));
    const project = projectFromLegacy({ skeleton: data, animations: [], assetManifest: {} }, 'Follow');
    const reopened = deserializeProject(serializeProject(project));
    expect(reopened).toEqual(project);
    expect(project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    const player = new RuntimePlayer({ skeleton: structuredClone(data), animations: [] });
    expect(Array.from(player.getWorldTransforms())).toEqual(Array.from(s.pose.worldMatrices));
  });
  it('composes offsets in the target basis, including translation and rotation', () => {
    const data = makeSkeletonData([
      makeBone('bone', null),
      makeBone('target', null, { x: 20, y: 30, rotation: Math.PI / 2, scaleX: 2, scaleY: 3 }),
    ]);
    data.transformConstraints = [follow({ offset: { ...offset, x: 10, y: 4, rotation: Math.PI / 2 } })];
    const m = world(run(data), 'bone');
    compare(m, [-3, 0, 0, -2, 8, 50]);
  });
  it('local copy uses the target local matrix without inheriting the target parent', () => {
    const data = rig();
    data.transformConstraints = [follow({ space: 'local' })];
    const expected = structuredClone(data);
    expected.transformConstraints = [];
    expected.bones.find((b) => b.id === 'bone')!.setupPose = {
      ...expected.bones.find((b) => b.id === 'target')!.setupPose,
    };
    compare(world(run(data), 'bone'), world(run(expected), 'bone'));
  });
  it('translation-only mixing retains signed scales and noncanonical shear exactly', () => {
    const data = makeSkeletonData([
      makeBone('bone', null, { x: -10, y: 5, rotation: 0.4, scaleX: -2, shearY: 0.3 }),
      makeBone('target', null, { x: 20, y: 30 }),
    ]);
    data.transformConstraints = [follow({ mixTranslation: 0.25, mixRotation: 0, mixScale: 0, mixShear: 0 })];
    const s = run(data),
      local = s.pose.bones[s.boneIndexMap.get('bone')!]!.local;
    expect(local).toEqual({ ...data.bones.find((b) => b.id === 'bone')!.setupPose, x: -2.5, y: 11.25 });
  });
  it('mixes shortest-arc rotation, signed scale and shear tangent independently', () => {
    const data = makeSkeletonData([
      makeBone('bone', null, { rotation: (179 * Math.PI) / 180, scaleX: 2, scaleY: 1, shearX: 0.2 }),
      makeBone('target', null, { rotation: (-179 * Math.PI) / 180, scaleX: 4, scaleY: -3, shearX: 0.8 }),
    ]);
    data.transformConstraints = [
      follow({ mixTranslation: 0, mixRotation: 0.5, mixScale: 0.5, mixShear: 0.5 }),
    ];
    const s = run(data),
      local = s.pose.bones[s.boneIndexMap.get('bone')!]!.local;
    expect(local.rotation).toBeCloseTo(Math.PI, 6);
    expect(local.scaleX).toBeCloseTo(3, 6);
    expect(local.scaleY).toBeCloseTo(-1, 6);
    expect(local.shearX).toBeCloseTo(Math.atan((Math.tan(0.2) + Math.tan(0.8)) * 0.5), 6);
  });
  it('zero mixes preserve exact matrices; singular basis/parent holds are finite and deterministic', () => {
    for (const mode of ['zero', 'target', 'parent']) {
      const data = rig();
      data.transformConstraints = [
        follow(mode === 'zero' ? { mixTranslation: 0, mixRotation: 0, mixScale: 0, mixShear: 0 } : {}),
      ];
      if (mode === 'target') data.bones.find((b) => b.id === 'target')!.setupPose.scaleX = 0;
      if (mode === 'parent') data.bones.find((b) => b.id === 'body')!.setupPose.scaleX = 0;
      const s = new Skeleton(data);
      solveFK(s.data, s.boneIndexMap, s.pose);
      const before = [...s.pose.worldMatrices];
      solveConstraints(s);
      expect([...s.pose.worldMatrices]).toEqual(before);
    }
  });
  it('evaluates a moving IK target after its transform writer and rejects reversed global order', () => {
    const data = makeSkeletonData([
      makeBone('upper', null),
      makeBone('lower', 'upper', { x: 20 }),
      makeBone('bone', null),
      makeBone('target', null, { x: 30, y: 10 }),
    ]);
    data.bones.find((b) => b.id === 'lower')!.length = 20;
    data.ikConstraints = [
      {
        id: 'ik',
        bones: ['upper', 'lower'],
        targetId: 'bone',
        poleVectorId: null,
        bendDirection: 1,
        mix: 1,
        softness: 0,
        order: 0,
      },
    ];
    data.transformConstraints = [follow({ order: 1 })];
    expect(() => new Skeleton(structuredClone(data))).toThrow(/must run after/);
    data.ikConstraints[0]!.order = 1;
    data.transformConstraints[0]!.order = 0;
    const s = run(data);
    expect(s.constraintOrder.map((e) => e.kind)).toEqual(['transform', 'ik']);
    const m = world(s, 'lower');
    expect(m[0]! * 20 + m[4]!).toBeCloseTo(30, 4);
    expect(m[1]! * 20 + m[5]!).toBeCloseTo(10, 4);
  });
  it('local reads ignore ancestor-only world writes; world reads require them first', () => {
    const data = makeSkeletonData([
      makeBone('body', null),
      makeBone('target', 'body', { x: 20 }),
      makeBone('bone', null),
      makeBone('goal', null, { x: 10, y: 20 }),
    ]);
    data.bones[0]!.length = 30;
    data.ikConstraints = [
      {
        id: 'ik',
        bones: ['body'],
        targetId: 'goal',
        poleVectorId: null,
        bendDirection: 1,
        mix: 1,
        softness: 0,
        order: 1,
      },
    ];
    data.transformConstraints = [follow({ space: 'local' })];
    expect(() => new Skeleton(structuredClone(data))).not.toThrow();
    data.transformConstraints[0]!.space = 'world';
    expect(() => new Skeleton(data)).toThrow(/must run after/);
  });
  it('rejects mixed cycles, repeated global identities/orders and invalid mixes/offsets', () => {
    const data = makeSkeletonData([
      makeBone('bone', null),
      makeBone('target', null),
      makeBone('descendant', 'bone'),
    ]);
    data.transformConstraints = [
      follow(),
      follow({ id: 'reverse', boneId: 'target', targetId: 'bone', order: 1 }),
    ];
    expect(() => new Skeleton(data)).toThrow(/dependency cycle/);
    const mixed = structuredClone(data);
    mixed.transformConstraints = [follow()];
    mixed.ikConstraints = [
      {
        id: 'writer',
        bones: ['target'],
        targetId: 'bone',
        poleVectorId: null,
        bendDirection: 1,
        mix: 1,
        softness: 0,
        order: 1,
      },
    ];
    expect(() => new Skeleton(mixed)).toThrow(/dependency cycle/);
    for (const patch of [
      { targetId: 'descendant' },
      { targetId: 'missing' },
      { mixTranslation: 2 },
      { mixScale: NaN },
      { space: 'invalid' },
      { offset: { ...offset, rotation: Infinity } },
    ]) {
      const candidate = structuredClone(data);
      candidate.transformConstraints = [follow(patch as Partial<TransformConstraintData>)];
      expect(() => new Skeleton(candidate)).toThrow(/Transform constraint/);
    }
    data.transformConstraints = [follow()];
    data.ikConstraints = [
      {
        id: 'ik',
        bones: ['target'],
        targetId: 'bone',
        poleVectorId: null,
        bendDirection: 1,
        mix: 1,
        softness: 0,
        order: 0,
      },
    ];
    expect(() => new Skeleton(data)).toThrow(/unique/);
  });
  it('reproduces arbitrary source matrices after canonical decomposition', () => {
    let seed = 17;
    const rand = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    for (let i = 0; i < 100; i++) {
      const data = rig();
      for (const b of data.bones)
        Object.assign(b.setupPose, {
          rotation: rand() * 6 - 3,
          scaleX: (rand() < 0.5 ? -1 : 1) * (0.5 + rand()),
          scaleY: (rand() < 0.5 ? -1 : 1) * (0.5 + rand()),
          shearX: rand() * 0.6 - 0.3,
          shearY: rand() * 0.6 - 0.3,
        });
      data.transformConstraints = [follow()];
      const s = run(data);
      compare(world(s, 'bone'), world(s, 'target'));
      const local = new Float64Array(6);
      composeAffine(s.pose.bones[s.boneIndexMap.get('bone')!]!.local, local);
      expect([...local].every(Number.isFinite)).toBe(true);
    }
  });
});
