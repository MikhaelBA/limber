import { describe, expect, it } from 'vitest';
import { relativeAffine, validateInvertibleAffine } from '../src';
import { seededRandom } from '../../core/tests/fixtures';

const multiply = (a: number[], b: number[]) => [
  a[0]! * b[0]! + a[2]! * b[1]!,
  a[1]! * b[0]! + a[3]! * b[1]!,
  a[0]! * b[2]! + a[2]! * b[3]!,
  a[1]! * b[2]! + a[3]! * b[3]!,
  a[0]! * b[4]! + a[2]! * b[5]! + a[4]!,
  a[1]! * b[4]! + a[3]! * b[5]! + a[5]!,
];
describe('bind affine coordinates', () => {
  it('composes back to the authored world matrix through reflected/sheared transforms', () => {
    const random = seededRandom(0xbbb001);
    for (let i = 0; i < 300; i++) {
      const angle = random() * Math.PI * 2,
        sx = (random() + 0.2) * (i % 2 ? -1 : 1),
        sy = random() + 0.2;
      const parent = [
        Math.cos(angle) * sx,
        Math.sin(angle) * sx,
        -Math.sin(angle) * sy + 0.2,
        Math.cos(angle) * sy,
        random() * 100,
        random() * 100,
      ];
      const child = [1.3, 0.2, -0.4, 0.7, random() * 30, random() * 30];
      const result = relativeAffine(parent, child);
      multiply(parent, result).forEach((value, j) =>
        expect(value, `seed 0xbbb001 case ${i}, channel ${j}`).toBeCloseTo(child[j]!, 9),
      );
    }
  });
  it('rejects degenerate, ill-conditioned and nonfinite matrices', () => {
    for (const matrix of [
      [0, 0, 0, 1, 0, 0],
      [1, 1, 1, 1, 0, 0],
      [1, 0, 0, 1e-14, 0, 0],
      [1, 0, 0, 1, Infinity, 0],
    ]) {
      expect(() => validateInvertibleAffine(matrix)).toThrow();
      expect(() => relativeAffine(matrix, [1, 0, 0, 1, 0, 0])).toThrow();
    }
  });
});
