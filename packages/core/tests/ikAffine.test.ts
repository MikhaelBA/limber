import { describe, expect, it } from 'vitest';
import {
  Skeleton,
  solveFK,
  solveConstraints,
  resetPose,
  transformPoint,
  type SkeletonData,
  type Transform,
  type IKConstraintData,
} from '../src/index';
import { RuntimePlayer } from '../../runtime/src/player';
import { makeBone, makeSkeletonData } from './helpers';

const constraint = (): IKConstraintData => ({
  id: 'ik',
  bones: ['upper', 'lower'],
  targetId: 'target',
  poleVectorId: null,
  bendDirection: 1,
  mix: 1,
  softness: 0,
  order: 0,
});
function rig(
  parent: Partial<Transform> = {},
  upper: Partial<Transform> = {},
  lower: Partial<Transform> = {},
) {
  const data = makeSkeletonData([
    makeBone('body', null, parent),
    makeBone('upper', 'body', { x: 12, y: 9, ...upper }),
    makeBone('lower', 'upper', { x: 40, y: 0, ...lower }),
    makeBone('target', null, { x: 50, y: 20 }),
    makeBone('pole', null, { x: 0, y: 100 }),
  ]);
  data.bones[1]!.length = 40;
  data.bones[2]!.length = 30;
  return data;
}
function tip(sk: Skeleton) {
  const out = { x: 0, y: 0 };
  transformPoint(
    sk.pose.worldMatrices,
    sk.boneIndexMap.get('lower')!,
    sk.data.bones.find((b) => b.id === 'lower')!.length,
    0,
    out,
  );
  return out;
}
function solve(data: SkeletonData) {
  const sk = new Skeleton(data);
  solveFK(sk.data, sk.boneIndexMap, sk.pose);
  solveConstraints(sk);
  return sk;
}
function reachable(data: SkeletonData) {
  const sk = solve(structuredClone(data)),
    target = tip(sk);
  const t = data.bones.find((b) => b.id === 'target')!;
  t.setupPose.x = target.x;
  t.setupPose.y = target.y;
  data.bones.find((b) => b.id === 'upper')!.setupPose.rotation = -0.3;
  data.bones.find((b) => b.id === 'lower')!.setupPose.rotation = 0.4;
  data.ikConstraints = [constraint()];
  return target;
}
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

describe('affine IK numerical contract', () => {
  it.each([
    [{ scaleX: 1.9, scaleY: 0.6, rotation: 0.8, shearX: 0.3, shearY: -0.2 }, {}, {}],
    [
      { scaleX: -1.5, scaleY: 0.7, rotation: -0.6 },
      { scaleX: 1.3, scaleY: 0.5, shearX: 0.35 },
      { scaleX: 0.8, shearY: 0.25 },
    ],
    [
      { scaleX: 1.2, scaleY: -0.8, shearX: 0.2 },
      { scaleX: -1.1, scaleY: 1.8, shearY: -0.4 },
      { scaleX: -0.9, shearX: -0.25, shearY: 0.2 },
    ],
    [
      { scaleX: -1, scaleY: -1 },
      { scaleX: 0.5, scaleY: 2 },
      { x: 31, y: 12, scaleX: 1.4 },
    ],
  ] as const)('reaches through scaled, reflected and sheared matrices: %j', (parent, upper, lower) => {
    const data = rig(parent, { ...upper, rotation: 0.8 }, { ...lower, rotation: -1.3 });
    const target = reachable(data),
      source = structuredClone(data),
      sk = solve(data);
    expect(distance(tip(sk), target)).toBeLessThan(0.0002);
    for (let i = 0; i < sk.data.bones.length; i++) {
      const b = sk.data.bones[i]!,
        original = source.bones.find((x) => x.id === b.id)!;
      expect(b.setupPose).toEqual(original.setupPose);
      const { rotation: _rotation, ...values } = sk.pose.bones[i]!.local;
      const { rotation: _setup, ...setup } = original.setupPose;
      expect(values).toEqual(setup);
    }
    expect(
      Array.from(
        new RuntimePlayer({ skeleton: structuredClone(source), animations: [] }).getWorldTransforms(),
      ),
    ).toEqual(Array.from(sk.pose.worldMatrices));
  });
  it('reaches 400 deterministic FK-generated targets across arbitrary affine chains', () => {
    let seed = 481516;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    for (let i = 0; i < 400; i++) {
      const affine = (): Partial<Transform> => ({
        rotation: random() * 5 - 2.5,
        scaleX: (random() < 0.5 ? -1 : 1) * (0.4 + random() * 1.8),
        scaleY: (random() < 0.5 ? -1 : 1) * (0.4 + random() * 1.8),
        shearX: random() * 0.8 - 0.4,
        shearY: random() * 0.8 - 0.4,
      });
      const data = rig(affine(), affine(), { ...affine(), x: 5 + random() * 50, y: random() * 30 - 15 });
      const target = reachable(data),
        sk = solve(data);
      expect(distance(tip(sk), target), `case ${i}`).toBeLessThan(0.0003);
      expect(Array.from(sk.pose.worldMatrices).every(Number.isFinite)).toBe(true);
    }
  });
  it.each([1, -1] as const)('bend/pole select the world-space side under reflection %i', (reflection) => {
    const data = rig({ scaleX: reflection, scaleY: 0.8 }, { x: 0, y: 0 }, { x: 40, y: 0 });
    data.bones.find((b) => b.id === 'target')!.setupPose = { ...data.bones[3]!.setupPose, x: 30, y: 12 };
    data.ikConstraints = [constraint()];
    for (const side of [1, -1] as const) {
      data.ikConstraints[0]!.bendDirection = side;
      const sk = solve(structuredClone(data)),
        joint = sk.boneIndexMap.get('lower')! * 6;
      expect(
        (30 * sk.pose.worldMatrices[joint + 5]! - 12 * sk.pose.worldMatrices[joint + 4]!) * side,
      ).toBeGreaterThan(1);
    }
    data.ikConstraints[0]!.poleVectorId = 'pole';
    for (const y of [100, -100]) {
      data.bones.find((b) => b.id === 'pole')!.setupPose.y = y;
      const sk = solve(structuredClone(data)),
        joint = sk.boneIndexMap.get('lower')! * 6;
      expect(
        (30 * sk.pose.worldMatrices[joint + 5]! - 12 * sk.pose.worldMatrices[joint + 4]!) * Math.sign(y),
      ).toBeGreaterThan(1);
    }
  });
  it('single-bone aim compensates its own shear, signed scale and affine parent', () => {
    const data = rig(
      { scaleX: -2, scaleY: 0.7, shearX: 0.3, rotation: 0.5 },
      { scaleX: -1.3, shearX: 0.2, shearY: 0.4 },
    );
    data.ikConstraints = [{ ...constraint(), bones: ['upper'] }];
    const sk = solve(data),
      o = sk.boneIndexMap.get('upper')! * 6,
      t = sk.boneIndexMap.get('target')! * 6;
    const dx = sk.pose.worldMatrices[t + 4]! - sk.pose.worldMatrices[o + 4]!,
      dy = sk.pose.worldMatrices[t + 5]! - sk.pose.worldMatrices[o + 5]!;
    expect(Math.abs(dx * sk.pose.worldMatrices[o + 1]! - dy * sk.pose.worldMatrices[o]!)).toBeLessThan(
      0.0001,
    );
    expect(dx * sk.pose.worldMatrices[o]! + dy * sk.pose.worldMatrices[o + 1]!).toBeGreaterThan(0);
  });
  it('uses exact radial reach bounds of a nonuniform upper bone for unreachable targets', () => {
    const data = rig({}, { x: 0, y: 0, scaleX: 2, scaleY: 0.5 }, { x: 40, y: 0 });
    data.ikConstraints = [constraint()];
    data.bones.find((b) => b.id === 'target')!.setupPose.x = 1000;
    data.bones.find((b) => b.id === 'target')!.setupPose.y = 0;
    const sk = solve(data);
    expect(tip(sk).x).toBeCloseTo(140, 4);
    expect(tip(sk).y).toBeCloseTo(0, 4);
    data.bones.find((b) => b.id === 'target')!.setupPose.x = 1;
    const near = solve(data);
    expect(tip(near).x).toBeCloseTo(20, 4);
  });
  it('softness has a continuous exponential approach, never changes authored lengths/scales', () => {
    const data = rig({}, { x: 0, y: 0 }, { x: 40, y: 0 });
    data.ikConstraints = [{ ...constraint(), softness: 10 }];
    const target = data.bones.find((b) => b.id === 'target')!;
    target.setupPose.y = 0;
    const reaches = [];
    for (const x of [50, 60, 70, 80, 100]) {
      target.setupPose.x = x;
      const sk = solve(structuredClone(data));
      reaches.push(tip(sk).x);
      const expected = x <= 60 ? x : 70 - 10 * Math.exp(-(x - 60) / 10);
      expect(tip(sk).x).toBeCloseTo(expected, 4);
      expect(sk.data.bones.find((b) => b.id === 'lower')!.length).toBe(30);
    }
    expect(reaches.every((v, i) => i === 0 || v > reaches[i - 1]!)).toBe(true);
    target.setupPose.x = 70;
    data.ikConstraints[0]!.softness = 0;
    expect(tip(solve(data)).x).toBeCloseTo(70, 4);
  });
  it('holds singular parents and handles collapsed/zero/near-zero geometry deterministically', () => {
    for (const parent of [{ scaleX: 0 }, { scaleX: 1e-14, scaleY: 1 }]) {
      const data = rig(parent);
      data.ikConstraints = [constraint()];
      const sk = new Skeleton(data);
      solveFK(sk.data, sk.boneIndexMap, sk.pose);
      const before = [...sk.pose.worldMatrices];
      solveConstraints(sk);
      expect([...sk.pose.worldMatrices]).toEqual(before);
    }
    for (const mode of ['zero-lower', 'zero-joint', 'collapsed-upper', 'origin', 'tiny']) {
      const data = rig({}, { x: 0, y: 0 }, { x: 40, y: 0 });
      data.ikConstraints = [constraint()];
      if (mode === 'zero-lower') data.bones[2]!.length = 0;
      if (mode === 'zero-joint') data.bones[2]!.setupPose.x = 0;
      if (mode === 'collapsed-upper') data.bones[1]!.setupPose.scaleX = 0;
      if (mode === 'origin') {
        data.bones[2]!.length = 40;
        data.bones[3]!.setupPose.x = 0;
        data.bones[3]!.setupPose.y = 0;
      }
      if (mode === 'tiny') {
        data.bones[2]!.length = 1e-10;
        data.bones[2]!.setupPose.x = 1e-10;
      }
      const sk = solve(data);
      expect(Array.from(sk.pose.worldMatrices).every(Number.isFinite)).toBe(true);
      const first = [...sk.pose.worldMatrices];
      resetPose(sk.data, sk.pose);
      solveFK(sk.data, sk.boneIndexMap, sk.pose);
      solveConstraints(sk);
      expect([...sk.pose.worldMatrices]).toEqual(first);
      if (mode === 'origin') expect(Math.hypot(tip(sk).x, tip(sk).y)).toBeLessThan(0.0001);
    }
  });
});
