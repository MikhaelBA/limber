import { describe, expect, it } from 'vitest';
import {
  Skeleton,
  solveFK,
  solveConstraints,
  serializeProject,
  deserializeProject,
  projectFromLegacy,
  type IKConstraintData,
  type SkeletonData,
} from '../src/index';
import { RuntimePlayer } from '../../runtime/src/player';
import { makeBone, makeSkeletonData } from './helpers';

const ik = (id: string, bones: string[], targetId: string, order = 0): IKConstraintData => ({
  id,
  bones,
  targetId,
  order,
  poleVectorId: null,
  mix: 1,
  bendDirection: 1,
  softness: 0,
});
function valid(): SkeletonData {
  const data = makeSkeletonData([
    makeBone('root', null),
    makeBone('end', 'root', { x: 40 }),
    makeBone('target', null, { x: 50, y: 20 }),
  ]);
  data.bones[0]!.length = 40;
  data.bones[1]!.length = 30;
  data.ikConstraints = [ik('limb', ['root', 'end'], 'target')];
  return data;
}

describe('constraint publication contract', () => {
  it.each([
    { mix: NaN },
    { mix: Infinity },
    { mix: -0.01 },
    { mix: 1.01 },
    { bendDirection: 0 },
    { order: NaN },
    { order: Infinity },
    { order: -1 },
    { order: 0.5 },
    { order: Number.MAX_SAFE_INTEGER + 1 },
    { softness: 3 },
    { softness: NaN },
    { poleVectorId: 'target' },
  ])('rejects unsupported/invalid parameters before runtime construction: %j', (patch) => {
    const data = valid();
    Object.assign(data.ikConstraints[0]!, patch);
    expect(() => new Skeleton(data)).toThrow(/IK constraint/);
    expect(() => new RuntimePlayer({ skeleton: data, animations: [] })).toThrow(/IK constraint/);
  });
  it('rejects repeated IDs/orders, invalid chains and target feedback', () => {
    for (const second of [
      ik('limb', ['root', 'end'], 'target', 1),
      ik('other', ['root', 'end'], 'target', 0),
    ]) {
      const data = valid();
      data.ikConstraints.push(second);
      expect(() => new Skeleton(data)).toThrow(/unique/);
    }
    for (const targetId of ['root', 'end', 'descendant']) {
      const data = valid();
      data.bones.push(makeBone('descendant', 'end'));
      data.ikConstraints[0]!.targetId = targetId;
      expect(() => new Skeleton(data)).toThrow(/feedback cycle/);
    }
    const data = valid();
    data.ikConstraints[0]!.bones = ['end', 'root'];
    expect(() => new Skeleton(data)).toThrow(/direct child/);
  });
  it('rejects mutually dependent targets, independently of supplied order', () => {
    const data = makeSkeletonData([
      makeBone('a', null),
      makeBone('a-target', 'a'),
      makeBone('b', null),
      makeBone('b-target', 'b'),
    ]);
    data.ikConstraints = [ik('a-ik', ['a'], 'b-target'), ik('b-ik', ['b'], 'a-target', 1)];
    expect(() => new Skeleton(data)).toThrow(/dependency cycle/);
  });
  it('requires a solved target writer before its reader and preserves native/runtime parity', () => {
    const data = makeSkeletonData([
      makeBone('a', null),
      makeBone('a-end', 'a', { x: 50 }),
      makeBone('b', null, { x: 70 }),
      makeBone('moving-target', 'b', { x: 10 }),
      makeBone('b-target', null, { x: 70, y: 20 }),
    ]);
    data.bones[0]!.length = 50;
    data.bones[1]!.length = 50;
    data.bones[2]!.length = 20;
    data.ikConstraints = [
      ik('reader', ['a', 'a-end'], 'moving-target', 0),
      ik('writer', ['b'], 'b-target', 1),
    ];
    expect(() => new Skeleton(structuredClone(data))).toThrow(/must run after/);
    data.ikConstraints[0]!.order = 1;
    data.ikConstraints[1]!.order = 0;
    const project = projectFromLegacy(
      { skeleton: data, animations: [], assetManifest: {} },
      'Ordered fixture',
    );
    const reopened = deserializeProject(serializeProject(project));
    const rig = reopened.artboards[0]!.nodes[0]!;
    if (rig.type !== 'rig') throw new Error('Expected fixture rig');
    const sk = new Skeleton(structuredClone(rig.skeleton));
    solveFK(sk.data, sk.boneIndexMap, sk.pose);
    solveConstraints(sk);
    const m = sk.pose.worldMatrices,
      e = sk.boneIndexMap.get('a-end')! * 6;
    expect(m[e]! * 50 + m[e + 4]!).toBeCloseTo(70, 4);
    expect(m[e + 1]! * 50 + m[e + 5]!).toBeCloseTo(10, 4);
    const player = new RuntimePlayer({ skeleton: structuredClone(rig.skeleton), animations: [] });
    expect(Array.from(player.getWorldTransforms())).toEqual(Array.from(m));
    expect(sk.data.ikConstraints.map((c) => c.id)).toEqual(['writer', 'reader']);
  });
  it('rejects a later parent writer and permits explicit sequential overlapping writers', () => {
    const data = makeSkeletonData([
      makeBone('parent', null),
      makeBone('child', 'parent'),
      makeBone('target', null, { x: 30, y: 10 }),
    ]);
    data.ikConstraints = [
      ik('child-first', ['child'], 'target', 0),
      ik('parent-last', ['parent'], 'target', 1),
    ];
    expect(() => new Skeleton(data)).toThrow(/must run after/);
    const overlaps = valid();
    overlaps.ikConstraints.push(ik('later', ['root', 'end'], 'target', 7));
    expect(new Skeleton(overlaps).data.ikConstraints.map((c) => c.order)).toEqual([0, 7]);
  });
  it('rejects invalid/overflowing setup numerics but permits finite degenerate geometry', () => {
    for (const patch of [
      { length: -1 },
      { length: Infinity },
      { setupPose: { ...valid().bones[0]!.setupPose, x: NaN } },
      { setupPose: { ...valid().bones[0]!.setupPose, x: 1e40 } },
    ]) {
      const data = valid();
      Object.assign(data.bones[0]!, patch);
      expect(() => new Skeleton(data)).toThrow(/Bone/);
    }
    const data = valid();
    data.bones[0]!.length = 0;
    data.bones[0]!.setupPose.scaleX = 0;
    const sk = new Skeleton(data);
    solveFK(sk.data, sk.boneIndexMap, sk.pose);
    solveConstraints(sk);
    expect(Array.from(sk.pose.worldMatrices).every(Number.isFinite)).toBe(true);
    const overflow = valid();
    overflow.bones[0]!.setupPose.scaleX = 1e30;
    overflow.bones[1]!.setupPose.scaleX = 1e30;
    expect(() => new Skeleton(overflow)).toThrow(/setup world transforms/);
  });
});
