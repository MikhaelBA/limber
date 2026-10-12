export interface Point {
  x: number;
  y: number;
}

/** A drag uses the parent's frame at pointerdown, including reflection and shear. */
export function inverseVector(m: ArrayLike<number>, p: Point): Point | null {
  const det = m[0]! * m[3]! - m[1]! * m[2]!;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-10) return null;
  return { x: (m[3]! * p.x - m[2]! * p.y) / det, y: (m[0]! * p.y - m[1]! * p.x) / det };
}

export function angleStep(previous: number, current: number): number {
  return Math.atan2(Math.sin(current - previous), Math.cos(current - previous));
}

/** Projection is in units of the unnormalised world X column, not world pixels. */
export function projectedLength(axis: Point, delta: Point): number | null {
  const norm = axis.x * axis.x + axis.y * axis.y;
  return norm < 1e-20 ? null : (delta.x * axis.x + delta.y * axis.y) / norm;
}

export function unit(p: Point): Point {
  const length = Math.hypot(p.x, p.y);
  return length > 1e-10 ? { x: p.x / length, y: p.y / length } : { x: 1, y: 0 };
}
