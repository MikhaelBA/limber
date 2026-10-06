import { describe, expect, it } from 'vitest';
import type { IKConstraintData, SkeletonData } from '../src/types/data';
import { createPose, resetPose } from '../src/skeleton/pose';
import { solveFK } from '../src/skeleton/FKSolver';
import { solveIK } from '../src/skeleton/IKSolver';
import { transformPoint } from '../src/skeleton/FKSolver';
import { Skeleton } from '../src/skeleton/Skeleton';

let idc = 0;
const nid = (p: string) => `${p}${idc++}`;

function bone(
  id: string,
  parentId: string | null,
  x = 0,
  y = 0,
  rotation = 0,
  length = 20,
): SkeletonData['bones'][number] {
  return {
    id,
    name: id,
    parentId,
    length,
    setupPose: { x, y, rotation, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 },
  };
}

function ik(bones: string[], targetId: string, bendDirection: 1 | -1 = 1, mix = 1): IKConstraintData {
  return {
    id: nid('ik'),
    bones,
    targetId,
    poleVectorId: null,
    bendDirection,
    mix,
    softness: 0,
    order: 0,
  };
}

/** A(0,0 len20) → B(child, at (20,0), len20), target T at (30,10). */
function rig() {
  const data: SkeletonData = {
    bones: [bone('a', null), bone('b', 'a', 20, 0), bone('t', null, 30, 10)],
    slots: [],
    attachments: [],
    ikConstraints: [],
    skins: [],
    activeSkin: '',
  };
  const skeleton = new Skeleton(data);
  resetPose(data, skeleton.pose);
  solveFK(data, skeleton.boneIndexMap, skeleton.pose);
  return { data, skeleton };
}

const tipOf = (skeleton: Skeleton, boneId: string) => {
  const out = { x: 0, y: 0 };
  transformPoint(skeleton.pose.worldMatrices, skeleton.boneIndexMap.get(boneId)!, 20, 0, out);
  return out;
};

describe('solveIK (2-bone)', () => {
  it('places the chain tip exactly on the target', () => {
    const { data, skeleton } = rig();
    data.ikConstraints.push(ik(['a', 'b'], 't'));
    solveIK(data, skeleton.boneIndexMap, skeleton.pose);
    const tip = tipOf(skeleton, 'b');
    expect(tip.x).toBeCloseTo(30, 6);
    expect(tip.y).toBeCloseTo(10, 6);
  });

  it('bendDirection flips the elbow side (tip stays on the target)', () => {
    const up = rig();
    up.data.ikConstraints.push(ik(['a', 'b'], 't', 1));
    solveIK(up.data, up.skeleton.boneIndexMap, up.skeleton.pose);
    const down = rig();
    down.data.ikConstraints.push(ik(['a', 'b'], 't', -1));
    solveIK(down.data, down.skeleton.boneIndexMap, down.skeleton.pose);
    // Joint (b's world origin) above / below the a→target line respectively.
    const jy = (s: ReturnType<typeof rig>) => s.skeleton.pose.worldMatrices[s.skeleton.boneIndexMap.get('b')! * 6 + 5]!;
    expect(jy(up)).toBeGreaterThan(0);
    expect(jy(down)).toBeLessThan(0);
    for (const s of [up, down]) {
      const tip = tipOf(s.skeleton, 'b');
      expect(tip.x).toBeCloseTo(30, 6);
      expect(tip.y).toBeCloseTo(10, 6);
    }
  });

  it('clamps an unreachable target: the chain fully extends toward it', () => {
    const { data, skeleton } = rig();
    const t = data.bones.find((b) => b.id === 't')!;
    t.setupPose.x = 100;
    t.setupPose.y = 0;
    resetPose(data, skeleton.pose);
    solveFK(data, skeleton.boneIndexMap, skeleton.pose);
    data.ikConstraints.push(ik(['a', 'b'], 't'));
    solveIK(data, skeleton.boneIndexMap, skeleton.pose);
    const tip = tipOf(skeleton, 'b');
    expect(tip.x).toBeCloseTo(40, 3); // L1+L2 straight along +x.
    expect(tip.y).toBeCloseTo(0, 3);
  });

  it('mix=0 leaves the pose untouched', () => {
    const { data, skeleton } = rig();
    const before = [...skeleton.pose.worldMatrices];
    data.ikConstraints.push(ik(['a', 'b'], 't', 1, 0));
    solveIK(data, skeleton.boneIndexMap, skeleton.pose);
    expect([...skeleton.pose.worldMatrices]).toEqual(before);
  });

  it('writes LOCAL rotations under a rotated parent (compensation)', () => {
    const data: SkeletonData = {
      bones: [bone('p', null, 0, 0, Math.PI / 2), bone('a', 'p', 0, 0), bone('t', null, 20, 0)],
      slots: [],
      attachments: [],
      ikConstraints: [],
      skins: [],
      activeSkin: '',
    };
    const skeleton = new Skeleton(data);
    resetPose(data, skeleton.pose);
    solveFK(data, skeleton.boneIndexMap, skeleton.pose);
    data.ikConstraints.push(ik(['a'], 't'));
    solveIK(data, skeleton.boneIndexMap, skeleton.pose);
    // Desired world angle atan2(0,20)=0; parent world angle +90° → local −90°.
    expect(skeleton.pose.bones[skeleton.boneIndexMap.get('a')!]!.local.rotation).toBeCloseTo(-Math.PI / 2, 6);
    const tip = tipOf(skeleton, 'a');
    expect(tip.x).toBeCloseTo(20, 6);
    expect(tip.y).toBeCloseTo(0, 6);
  });
});
