import { describe, expect, it } from 'vitest';
import { angleStep, inverseVector, projectedLength } from '../src/math/rigGesture';

describe('rig pointer geometry', () => {
  it('recovers cursor vectors under rotated, reflected, scaled and sheared parents', () => {
    for (const m of [
      [2, 1, 0.8, 3],
      [-2, 1, 0.8, 3],
      [0, 2, -3, 1],
    ]) {
      const p = { x: 7, y: -4 };
      const actual = inverseVector(m, { x: m[0]! * p.x + m[2]! * p.y, y: m[1]! * p.x + m[3]! * p.y })!;
      expect(actual.x).toBeCloseTo(p.x);
      expect(actual.y).toBeCloseTo(p.y);
    }
  });
  it('does not jump by a full turn across atan2 wrap', () => {
    expect(angleStep(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2);
    expect(angleStep(-Math.PI + 0.1, Math.PI - 0.1)).toBeCloseTo(-0.2);
  });
  it('measures length in bone units under scale and reflection', () => {
    expect(projectedLength({ x: 2, y: 3 }, { x: 80, y: 120 })).toBe(40);
    expect(projectedLength({ x: -2, y: 0 }, { x: -80, y: 99 })).toBe(40);
  });
  it('rejects collapsed frames instead of producing infinite transforms', () => {
    expect(inverseVector([0, 0, 0, 1], { x: 3, y: 4 })).toBeNull();
    expect(projectedLength({ x: 0, y: 0 }, { x: 4, y: 5 })).toBeNull();
  });
});
