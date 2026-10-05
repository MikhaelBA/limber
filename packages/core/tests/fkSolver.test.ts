import { describe, expect, it } from 'vitest';
import {
  Skeleton,
  solveFK,
  transformPoint,
  type BoneData,
  type SkeletonData,
  type SkeletonPose,
  type Transform,
} from '@limber/core';
import { makeBone, makeSkeletonData } from './helpers';

/**
 * Naive, allocation-heavy reference implementation of the documented convention
 *   L = T(x, y) · R(rotation) · ShearX · ShearY · S(scaleX, scaleY)
 * built from 3x3 matrix products. Obvious on purpose — the production solver
 * must match it on gnarly nested chains.
 */
type Mat3 = number[][];
const mul = (a: Mat3, b: Mat3): Mat3 => {
  const r: Mat3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      for (let k = 0; k < 3; k++) r[i]![j]! += a[i]![k]! * b[k]![j]!;
    }
  }
  return r;
};
const localMatrix = (t: Transform): Mat3 => {
  const c = Math.cos(t.rotation);
  const s = Math.sin(t.rotation);
  const tx = Math.tan(t.shearX);
  const ty = Math.tan(t.shearY);
  return mul(
    mul(
      mul(
        mul(
          [
            [1, 0, t.x],
            [0, 1, t.y],
            [0, 0, 1],
          ],
          [
            [c, -s, 0],
            [s, c, 0],
            [0, 0, 1],
          ],
        ),
        [
          [1, tx, 0],
          [0, 1, 0],
          [0, 0, 1],
        ],
      ),
      [
        [1, 0, 0],
        [ty, 1, 0],
        [0, 0, 1],
      ],
    ),
    [
      [t.scaleX, 0, 0],
      [0, t.scaleY, 0],
      [0, 0, 1],
    ],
  );
};
const referenceFK = (
  data: SkeletonData,
  indexMap: Map<string, number>,
  pose: SkeletonPose,
): Mat3[] => {
  const out: Mat3[] = [];
  for (let i = 0; i < data.bones.length; i++) {
    const bone = data.bones[i]!;
    const L = localMatrix(pose.bones[i]!.local);
    const parentIndex = bone.parentId === null ? -1 : indexMap.get(bone.parentId)!;
    out.push(parentIndex === -1 ? L : mul(out[parentIndex]!, L));
  }
  return out;
};

/** worldMatrices are Float32 — compare against the f64 reference with f32-safe precision. */
function expectWorldMatrix(wm: Float32Array, index: number, expected: Mat3, precision = 5): void {
  const o = index * 6;
  // Storage: [a, b, c, d, tx, ty] for matrix | a c tx |
  //                                        | b d ty |
  const expectedFlat = [
    expected[0]![0]!, // a
    expected[1]![0]!, // b
    expected[0]![1]!, // c
    expected[1]![1]!, // d
    expected[0]![2]!, // tx
    expected[1]![2]!, // ty
  ];
  for (let k = 0; k < 6; k++) {
    expect(wm[o + k]!).toBeCloseTo(expectedFlat[k]!, precision);
  }
}

describe('solveFK — hand-computed golden matrices', () => {
  it('identity rotation + translation for a root bone', () => {
    const sk = new Skeleton(
      makeSkeletonData([makeBone('root', null, { x: 10, y: 20 })]),
    );
    solveFK(sk.data, sk.boneIndexMap, sk.pose);
    const wm = sk.pose.worldMatrices;
    expect(Array.from(wm.slice(0, 6))).toEqual([1, 0, 0, 1, 10, 20]);
  });

  it('root rotated 90° maps local +x to world +y', () => {
    const sk = new Skeleton(
      makeSkeletonData([makeBone('root', null, { x: 10, y: 20, rotation: Math.PI / 2 })]),
    );
    solveFK(sk.data, sk.boneIndexMap, sk.pose);
    const wm = sk.pose.worldMatrices;
    const p = { x: 0, y: 0 };
    transformPoint(wm, 0, 1, 0, p);
    expect(p.x).toBeCloseTo(10, 5);
    expect(p.y).toBeCloseTo(21, 5);
  });

  it('chains translations down the hierarchy', () => {
    const sk = new Skeleton(
      makeSkeletonData([makeBone('root', null, { x: 10, y: 0 }), makeBone('child', 'root', { x: 5, y: 0 })]),
    );
    solveFK(sk.data, sk.boneIndexMap, sk.pose);
    const wm = sk.pose.worldMatrices;
    expect(wm[4 + 6]!).toBeCloseTo(15, 5); // child world tx
    expect(wm[5 + 6]!).toBeCloseTo(0, 5); // child world ty
  });

  it('child of a 90°-rotated parent at local (5,0) lands at world (0,5)', () => {
    const sk = new Skeleton(
      makeSkeletonData([
        makeBone('root', null, { rotation: Math.PI / 2 }),
        makeBone('child', 'root', { x: 5, y: 0 }),
      ]),
    );
    solveFK(sk.data, sk.boneIndexMap, sk.pose);
    const p = { x: 0, y: 0 };
    transformPoint(sk.pose.worldMatrices, 1, 0, 0, p);
    expect(p.x).toBeCloseTo(0, 5);
    expect(p.y).toBeCloseTo(5, 5);
  });

  it('non-uniform parent scale × child rotation produces a sheared world matrix (the reason world transforms are never decomposed)', () => {
    const sk = new Skeleton(
      makeSkeletonData([
        makeBone('parent', null, { scaleX: 2, scaleY: 1 }),
        makeBone('child', 'parent', { rotation: Math.PI / 2 }),
      ]),
    );
    solveFK(sk.data, sk.boneIndexMap, sk.pose);
    const wm = sk.pose.worldMatrices;
    // world = diag(2,1) · R(90°) = | 0 -2 |
    //                             | 1  0 |
    expect(wm[6]!).toBeCloseTo(0, 5); // a
    expect(wm[7]!).toBeCloseTo(1, 5); // b
    expect(wm[8]!).toBeCloseTo(-2, 5); // c
    expect(wm[9]!).toBeCloseTo(0, 5); // d
    const p = { x: 0, y: 0 };
    transformPoint(wm, 1, 0, 1, p);
    expect(p.x).toBeCloseTo(-2, 5);
    expect(p.y).toBeCloseTo(0, 5);
  });

  it('shearX of 45° skews local x by y', () => {
    const sk = new Skeleton(
      makeSkeletonData([makeBone('root', null, { shearX: Math.PI / 4 })]),
    );
    solveFK(sk.data, sk.boneIndexMap, sk.pose);
    const p = { x: 0, y: 0 };
    transformPoint(sk.pose.worldMatrices, 0, 0, 1, p);
    expect(p.x).toBeCloseTo(1, 5);
    expect(p.y).toBeCloseTo(1, 5);
  });
});

describe('solveFK — reference implementation cross-check', () => {
  it('matches the naive matrix implementation on a gnarly nested chain', () => {
    const bones: BoneData[] = [
      makeBone('root', null, { x: 13, y: -7, rotation: 0.3, scaleX: 1.3, scaleY: 0.7, shearY: 0.2 }),
      makeBone('child', 'root', { x: 5, y: -3, rotation: -1.1, scaleX: 0.9, scaleY: 1.2, shearX: 0.4 }),
      makeBone('grand', 'child', { x: -2, y: 8, rotation: 2.0, scaleX: 0.5, scaleY: 2.0, shearX: 0.15, shearY: -0.3 }),
      makeBone('otherRoot', null, { rotation: -0.7, scaleX: 2, scaleY: 0.25 }),
    ];
    const sk = new Skeleton(makeSkeletonData(bones));
    // Perturb the pose away from setup so the solver reads locals, not setup data.
    sk.pose.bones[1]!.local.x += 3.5;
    sk.pose.bones[1]!.local.rotation += 0.4;
    sk.pose.bones[2]!.local.scaleY *= 1.7;

    solveFK(sk.data, sk.boneIndexMap, sk.pose);
    const reference = referenceFK(sk.data, sk.boneIndexMap, sk.pose);
    for (let i = 0; i < bones.length; i++) {
      expectWorldMatrix(sk.pose.worldMatrices, i, reference[i]!);
    }
  });
});
