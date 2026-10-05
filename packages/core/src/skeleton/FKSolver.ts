import type { SkeletonData } from '../types/data';
import type { SkeletonPose } from '../types/pose';

export interface Point {
  x: number;
  y: number;
}

/**
 * Forward kinematics — the hot path (DESIGN.md §4.2).
 *
 * Transform convention (a bone's LOCAL affine matrix L):
 *
 *   L = T(x, y) · R(rotation) · ShearX · ShearY · S(scaleX, scaleY)
 *
 * where (3x3 row form):
 *   T      = | 1  0  x |     R      = | cos -sin 0 |
 *           | 0  1  y |             | sin  cos 0 |
 *   ShearX = | 1  tx  0 |   ShearY = | 1   0    0 |   S = | sx 0   0 |
 *           | 0  1  0 |             | ty  1    0 |       | 0  sy  0 |
 *   (tx = tan(shearX) skews x by y; ty = tan(shearY) skews y by x)
 *
 * Expanding R·ShearX·ShearY·S and writing ex = cos·tx - sin, ey = sin·tx + cos:
 *   a = (cos + ex·ty) · scaleX      (m00, x-basis x)
 *   b = (sin + ey·ty) · scaleX      (m10, x-basis y)
 *   c = ex · scaleY                 (m01, y-basis x)
 *   d = ey · scaleY                 (m11, y-basis y)
 *   translation = (x, y)
 *
 * World composition (parent world P = [pa, pb, pc, pd, ptx, pty]):
 *   world = P · L, i.e. per column of L: world_col = P_linear · local_col,
 *   and world_translation = P_linear · (x, y) + (ptx, pty).
 *
 * Storage: pose.worldMatrices holds 6 floats per bone: [a, b, c, d, tx, ty]
 * (matrix | a c tx |), one slot per topological bone index.
 *        (       | b d ty |)
 *
 * data.bones is guaranteed topologically sorted (parents before children), so
 * a single forward pass suffices — no recursion, no string/UUID lookups, no
 * allocation.
 */
export function solveFK(
  data: SkeletonData,
  boneIndexMap: Map<string, number>,
  pose: SkeletonPose,
): void {
  const wm = pose.worldMatrices;
  for (let i = 0; i < data.bones.length; i++) {
    const bone = data.bones[i]!;
    const t = pose.bones[i]!.local;
    const o = i * 6;

    const cos = Math.cos(t.rotation);
    const sin = Math.sin(t.rotation);
    const tx = Math.tan(t.shearX);
    const ty = Math.tan(t.shearY);
    const ex = cos * tx - sin;
    const ey = sin * tx + cos;

    const la = (cos + ex * ty) * t.scaleX;
    const lb = (sin + ey * ty) * t.scaleX;
    const lc = ex * t.scaleY;
    const ld = ey * t.scaleY;

    const parentId = bone.parentId;
    const parentIndex = parentId === null ? -1 : (boneIndexMap.get(parentId) ?? -1);

    if (parentIndex === -1) {
      wm[o] = la;
      wm[o + 1] = lb;
      wm[o + 2] = lc;
      wm[o + 3] = ld;
      wm[o + 4] = t.x;
      wm[o + 5] = t.y;
    } else {
      const p = parentIndex * 6;
      const pa = wm[p]!;
      const pb = wm[p + 1]!;
      const pc = wm[p + 2]!;
      const pd = wm[p + 3]!;
      const ptx = wm[p + 4]!;
      const pty = wm[p + 5]!;
      wm[o] = pa * la + pc * lb;
      wm[o + 1] = pb * la + pd * lb;
      wm[o + 2] = pa * lc + pc * ld;
      wm[o + 3] = pb * lc + pd * ld;
      wm[o + 4] = pa * t.x + pc * t.y + ptx;
      wm[o + 5] = pb * t.x + pd * t.y + pty;
    }
  }
}

/** Applies bone `boneIndex`'s world matrix to a point. Reusable `out` — no allocation. */
export function transformPoint(
  wm: Float32Array,
  boneIndex: number,
  x: number,
  y: number,
  out: Point,
): void {
  const o = boneIndex * 6;
  const a = wm[o]!;
  const b = wm[o + 1]!;
  const c = wm[o + 2]!;
  const d = wm[o + 3]!;
  out.x = a * x + c * y + wm[o + 4]!;
  out.y = b * x + d * y + wm[o + 5]!;
}
