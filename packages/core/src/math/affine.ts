import type { Transform } from '../types/data';
/** Portable reusable-output affine operations; safe with aliased inputs. */
export function composeAffine(t: Transform, out: Float64Array, offset = 0): void {
  const cos = Math.cos(t.rotation),
    sin = Math.sin(t.rotation),
    tx = Math.tan(t.shearX),
    ty = Math.tan(t.shearY);
  const ex = cos * tx - sin,
    ey = sin * tx + cos;
  out[offset] = (cos + ex * ty) * t.scaleX;
  out[offset + 1] = (sin + ey * ty) * t.scaleX;
  out[offset + 2] = ex * t.scaleY;
  out[offset + 3] = ey * t.scaleY;
  out[offset + 4] = t.x;
  out[offset + 5] = t.y;
}
export function multiplyAffine(
  out: Float64Array,
  to: number,
  p: ArrayLike<number>,
  po: number,
  l: ArrayLike<number>,
  lo: number,
): void {
  const a = p[po]!,
    b = p[po + 1]!,
    c = p[po + 2]!,
    d = p[po + 3]!,
    x = p[po + 4]!,
    y = p[po + 5]!;
  const la = l[lo]!,
    lb = l[lo + 1]!,
    lc = l[lo + 2]!,
    ld = l[lo + 3]!,
    lx = l[lo + 4]!,
    ly = l[lo + 5]!;
  out[to] = a * la + c * lb;
  out[to + 1] = b * la + d * lb;
  out[to + 2] = a * lc + c * ld;
  out[to + 3] = b * lc + d * ld;
  out[to + 4] = a * lx + c * ly + x;
  out[to + 5] = b * lx + d * ly + y;
}
export function invertAffine(out: Float64Array, to: number, m: ArrayLike<number>, mo: number): boolean {
  const a = m[mo]!,
    b = m[mo + 1]!,
    c = m[mo + 2]!,
    d = m[mo + 3]!,
    x = m[mo + 4]!,
    y = m[mo + 5]!;
  const det = a * d - b * c,
    norm = Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d));
  if (!Number.isFinite(det) || Math.abs(det) <= norm * norm * 1e-12) return false;
  out[to] = d / det;
  out[to + 1] = -b / det;
  out[to + 2] = -c / det;
  out[to + 3] = a / det;
  out[to + 4] = (c * y - d * x) / det;
  out[to + 5] = (b * x - a * y) / det;
  return true;
}
/** Canonical QR decomposition: reflection in Y scale, shearY absorbed into X. */
export function decomposeAffineInto(m: ArrayLike<number>, offset: number, out: Transform): boolean {
  const a = m[offset]!,
    b = m[offset + 1]!,
    c = m[offset + 2]!,
    d = m[offset + 3]!,
    x = m[offset + 4]!,
    y = m[offset + 5]!;
  const scaleX = Math.hypot(a, b),
    determinant = a * d - b * c,
    norm = Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d));
  if (
    !Number.isFinite(determinant) ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    scaleX < 1e-12 ||
    Math.abs(determinant) <= norm * norm * 1e-12
  )
    return false;
  const cos = a / scaleX,
    sin = b / scaleX,
    scaleY = -sin * c + cos * d;
  out.x = x;
  out.y = y;
  out.rotation = Math.atan2(b, a);
  out.scaleX = scaleX;
  out.scaleY = scaleY;
  out.shearX = Math.atan((cos * c + sin * d) / scaleY);
  out.shearY = 0;
  return true;
}
