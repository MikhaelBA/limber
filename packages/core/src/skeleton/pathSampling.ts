import type { PathData, PathSegment } from '../types/data';

/** Fixed deterministic approximation; baked coordinates, metric refreshed only when basis changes. */
export const PATH_SUBDIVISIONS = 128;
export interface PathSample {
  x: number;
  y: number;
  tangentX: number;
  tangentY: number;
}
function coordinate(s: PathSegment, t: number, axis: 0 | 1): number {
  const u = 1 - t;
  return (
    u * u * u * s[axis]! +
    3 * u * u * t * s[axis + 2]! +
    3 * u * t * t * s[axis + 4]! +
    t * t * t * s[axis + 6]!
  );
}
function derivative(s: PathSegment, t: number, axis: 0 | 1): number {
  const u = 1 - t;
  return (
    3 *
    (u * u * (s[axis + 2]! - s[axis]!) +
      2 * u * t * (s[axis + 4]! - s[axis + 2]!) +
      t * t * (s[axis + 6]! - s[axis + 4]!))
  );
}
export class PathSampler {
  readonly points: Float64Array;
  readonly lengths: Float64Array;
  private readonly basis = new Float64Array([NaN, NaN, NaN, NaN]);
  length = 0;
  constructor(readonly path: PathData) {
    const count = path.segments.length * PATH_SUBDIVISIONS + 1;
    this.points = new Float64Array(count * 2);
    this.lengths = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      const segment = Math.min(path.segments.length - 1, Math.floor(i / PATH_SUBDIVISIONS));
      const t = (i - segment * PATH_SUBDIVISIONS) / PATH_SUBDIVISIONS;
      this.points[i * 2] = coordinate(path.segments[segment]!, t, 0);
      this.points[i * 2 + 1] = coordinate(path.segments[segment]!, t, 1);
    }
  }
  /** Translation does not change lengths. Collapsed paths have zero length. */
  updateMetric(m: ArrayLike<number>, o: number): void {
    if (
      this.basis[0] === m[o] &&
      this.basis[1] === m[o + 1] &&
      this.basis[2] === m[o + 2] &&
      this.basis[3] === m[o + 3]
    )
      return;
    for (let k = 0; k < 4; k++) this.basis[k] = m[o + k]!;
    let length = 0;
    for (let i = 1; i < this.lengths.length; i++) {
      const x = this.points[i * 2]! - this.points[(i - 1) * 2]!,
        y = this.points[i * 2 + 1]! - this.points[(i - 1) * 2 + 1]!;
      length += Math.hypot(m[o]! * x + m[o + 2]! * y, m[o + 1]! * x + m[o + 3]! * y);
      this.lengths[i] = length;
    }
    this.length = length;
  }
  /** Returns false for a wholly collapsed path or nonfinite distance; out stays untouched. */
  sample(distance: number, m: ArrayLike<number>, o: number, out: PathSample): boolean {
    this.updateMetric(m, o);
    const length = this.length;
    if (!(length > 0) || !Number.isFinite(length) || !Number.isFinite(distance)) return false;
    const d = this.path.closed
      ? ((distance % length) + length) % length
      : Math.max(0, Math.min(length, distance));
    let lo = 1,
      hi = this.lengths.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.lengths[mid]! < d) lo = mid + 1;
      else hi = mid;
    }
    // A repeated start/control point may create zero-length intervals.
    while (lo < this.lengths.length - 1 && this.lengths[lo] === this.lengths[lo - 1]) lo++;
    const before = this.lengths[lo - 1]!,
      span = this.lengths[lo]! - before;
    const fraction = span > 0 ? (d - before) / span : 0;
    const segment = Math.floor((lo - 1) / PATH_SUBDIVISIONS),
      start = ((lo - 1) % PATH_SUBDIVISIONS) / PATH_SUBDIVISIONS,
      end = start + 1 / PATH_SUBDIVISIONS;
    const s = this.path.segments[segment]!;
    let t = start + fraction / PATH_SUBDIVISIONS;
    // Refine chord progress on the actual cubic. Bounded Newton iterations remove
    // straight-path parameterization error without changing the baked arc metric.
    const px = this.points[(lo - 1) * 2]!,
      py = this.points[(lo - 1) * 2 + 1]!;
    const cx = this.points[lo * 2]! - px,
      cy = this.points[lo * 2 + 1]! - py;
    const wx = m[o]! * cx + m[o + 2]! * cy,
      wy = m[o + 1]! * cx + m[o + 3]! * cy,
      squared = wx * wx + wy * wy;
    if (fraction > 0 && fraction < 1 && squared > 0)
      for (let n = 0; n < 6; n++) {
        const x = coordinate(s, t, 0) - px,
          y = coordinate(s, t, 1) - py;
        const dx = derivative(s, t, 0),
          dy = derivative(s, t, 1);
        const projected = ((m[o]! * x + m[o + 2]! * y) * wx + (m[o + 1]! * x + m[o + 3]! * y) * wy) / squared;
        const slope = ((m[o]! * dx + m[o + 2]! * dy) * wx + (m[o + 1]! * dx + m[o + 3]! * dy) * wy) / squared;
        if (!(slope > 0) || !Number.isFinite(slope)) break;
        t = Math.max(start, Math.min(end, t - (projected - fraction) / slope));
      }
    const x = coordinate(s, t, 0),
      y = coordinate(s, t, 1);
    let dx = derivative(s, t, 0),
      dy = derivative(s, t, 1);
    let tx = m[o]! * dx + m[o + 2]! * dy,
      ty = m[o + 1]! * dx + m[o + 3]! * dy;
    if (Math.hypot(tx, ty) <= Math.max(1, length) * 1e-12) {
      dx = this.points[lo * 2]! - this.points[(lo - 1) * 2]!;
      dy = this.points[lo * 2 + 1]! - this.points[(lo - 1) * 2 + 1]!;
      tx = m[o]! * dx + m[o + 2]! * dy;
      ty = m[o + 1]! * dx + m[o + 3]! * dy;
    }
    const worldX = m[o]! * x + m[o + 2]! * y + m[o + 4]!,
      worldY = m[o + 1]! * x + m[o + 3]! * y + m[o + 5]!;
    if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return false;
    out.x = worldX;
    out.y = worldY;
    out.tangentX = tx;
    out.tangentY = ty;
    return true;
  }
}
