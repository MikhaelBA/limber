import type { Curve } from '../types/animation';

/**
 * Solves y(x) for a cubic Bezier interpolation curve with fixed endpoints
 * P0=(0,0), P3=(1,1) and control points P1=(c1,c2), P2=(c3,c4)
 * (DESIGN.md §4.5).
 *
 * - cx ∈ [0,1] is enforced by the editor UI so time never flows backwards.
 * - cy is UNBOUNDED — values outside [0,1] produce overshoot (back/bounce).
 * - Newton-Raphson first (quadratic convergence near the answer), bisection
 *   fallback for the flat/degenerate region. Deterministic, allocation-free.
 */
export function solveBezier(curve: Curve, x: number): number {
  const c1 = curve.c1 ?? 1 / 3;
  const c2 = curve.c2 ?? 1 / 3;
  const c3 = curve.c3 ?? 2 / 3;
  const c4 = curve.c4 ?? 1;

  if (x <= 0) return 0;
  if (x >= 1) return 1;

  // Bernstein-basis evaluation of x(u) / y(u) and dx/du.
  const bez = (a: number, b: number, c: number, d: number, t: number): number => {
    const it = 1 - t;
    return it * it * it * a + 3 * it * it * t * b + 3 * it * t * t * c + t * t * t * d;
  };
  const bezDX = (t: number): number => {
    const it = 1 - t;
    return 3 * it * it * c1 + 6 * it * t * (c3 - c1) + 3 * t * t * (1 - c3);
  };

  // Newton-Raphson.
  let u = x;
  for (let i = 0; i < 8; i++) {
    const err = bez(0, c1, c3, 1, u) - x;
    if (Math.abs(err) < 1e-6) return bez(0, c2, c4, 1, u);
    const d = bezDX(u);
    if (Math.abs(d) < 1e-6) break;
    u -= err / d;
    if (u < 0) u = 0;
    else if (u > 1) u = 1;
  }

  // Bisection fallback — x(u) is monotonic because cx ∈ [0,1].
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    u = (lo + hi) / 2;
    const xu = bez(0, c1, c3, 1, u);
    if (Math.abs(xu - x) < 1e-6) break;
    if (xu < x) lo = u;
    else hi = u;
  }
  return bez(0, c2, c4, 1, u);
}
