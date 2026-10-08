import type { Transform } from '@limber/core';

export interface Vec2 {
  x: number;
  y: number;
}

/**
 * Applies the INVERSE of world matrix `wm[idx]` to a world point → local point
 * in that bone's space. Used for viewport dragging and bone creation.
 */
export function inverseTransformPoint(
  wm: Float32Array,
  idx: number,
  wx: number,
  wy: number,
  out: Vec2,
): void {
  const o = idx * 6;
  const a = wm[o]!;
  const b = wm[o + 1]!;
  const c = wm[o + 2]!;
  const d = wm[o + 3]!;
  const det = a * d - b * c;
  const dx = wx - wm[o + 4]!;
  const dy = wy - wm[o + 5]!;
  out.x = (d * dx - c * dy) / det;
  out.y = (a * dy - b * dx) / det;
}

/**
 * L' = parentWorld⁻¹ · childWorld, written as a raw 6-float local affine
 * [a, b, c, d, tx, ty]. Editing-time only (world-preserving reparents).
 */
export function worldToLocalAffine(
  parent: ArrayLike<number>,
  child: ArrayLike<number>,
  out: Float64Array,
): void {
  const pa = parent[0]!;
  const pb = parent[1]!;
  const pc = parent[2]!;
  const pd = parent[3]!;
  const ptx = parent[4]!;
  const pty = parent[5]!;
  const wa = child[0]!;
  const wb = child[1]!;
  const wc = child[2]!;
  const wd = child[3]!;
  const wtx = child[4]!;
  const wty = child[5]!;
  const det = pa * pd - pb * pc;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) {
    throw new Error('Cannot reparent through a zero-scale transform.');
  }
  const ia = pd / det;
  const ib = -pc / det;
  const ic = -pb / det;
  const id = pa / det;
  out[0] = ia * wa + ib * wb;
  out[1] = ic * wa + id * wb;
  out[2] = ia * wc + ib * wd;
  out[3] = ic * wc + id * wd;
  const dx = wtx - ptx;
  const dy = wty - pty;
  out[4] = ia * dx + ib * dy;
  out[5] = ic * dx + id * dy;
}

/**
 * Decomposes a 2x3 affine into a Transform.
 *
 * EDITING-TIME ONLY — the runtime data path never decomposes world matrices
 * (DESIGN.md §1 principle 5). Canonical nonsingular decomposition: shearY is
 * absorbed into shearX, and reflection is retained in the sign of scaleY.
 */
export function decomposeAffine(
  a: number,
  b: number,
  c: number,
  d: number,
  tx: number,
  ty: number,
): Transform {
  const scaleX = Math.hypot(a, b);
  const rotation = Math.atan2(b, a);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  // Y-basis (c, d) expressed in the rotated frame: u = tan(shearX)·scaleY, v = scaleY.
  const u = cos * c + sin * d;
  const v = -sin * c + cos * d;
  if (![a, b, c, d, tx, ty].every(Number.isFinite) || scaleX < 1e-12 || Math.abs(v) < 1e-12) {
    throw new Error('Cannot reparent a zero-scale or invalid transform.');
  }
  return {
    x: tx,
    y: ty,
    rotation,
    scaleX,
    scaleY: v,
    shearX: Math.atan(u / v),
    shearY: 0,
  };
}

export function distToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
