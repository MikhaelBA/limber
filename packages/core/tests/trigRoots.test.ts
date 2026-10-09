import { describe, expect, it } from 'vitest';
import { trigAngles, trigRoots } from '../src/skeleton/trigRoots';
const roots = (c: number, a: number, b: number, d: number, e: number) =>
  Array.from(trigAngles.slice(0, trigRoots(c, a, b, d, e)));
const unique = (angles: number[]) => [
  ...new Set(angles.map((a) => Math.round(Math.atan2(Math.sin(a), Math.cos(a)) * 1e8) / 1e8)),
];
describe('bounded half-angle roots', () => {
  it('finds all four roots rather than only a single elbow branch', () => {
    const angles = unique(roots(0, 0, 0, 1, 0));
    expect(angles).toHaveLength(4);
    angles.forEach((a) => expect(Math.cos(2 * a)).toBeCloseTo(0, 7));
  });
  it('finds repeated/tangent roots and roots across both chart boundaries', () => {
    const tangent = roots(-1, 0, 0, 1, 0);
    expect(tangent.some((a) => Math.abs(Math.sin(a / 2)) < 1e-8)).toBe(true);
    expect(tangent.some((a) => Math.abs(Math.cos(a / 2)) < 1e-8)).toBe(true);
    const boundaries = roots(0, 1, 0, 0, 0);
    expect(unique(boundaries)).toHaveLength(2);
    boundaries.forEach((a) => expect(Math.cos(a)).toBeCloseTo(0, 9));
  });
  it('isolates close roots on both sides of a tangent', () => {
    const angles = roots(-Math.cos(2e-5), 0, 0, 1, 0);
    expect(angles.some((a) => a > 0 && a < 3e-5)).toBe(true);
    expect(angles.some((a) => a < 0 && a > -3e-5)).toBe(true);
  });
  it('keeps finite deterministic results for constants and extreme coefficient scales', () => {
    expect(roots(1, 0, 0, 0, 0)).toEqual([]);
    expect(roots(0, 0, 0, 0, 0).every(Number.isFinite)).toBe(true);
    expect(unique(roots(0.1, 0.2, 0.3, 0.4, 0.5))).toEqual(unique(roots(1e99, 2e99, 3e99, 4e99, 5e99)));
  });
});
