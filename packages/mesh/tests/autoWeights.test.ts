import { describe, expect, it } from 'vitest';
import { autoWeights, decodeWeights, validateWeights } from '../src';
import { seededRandom } from '../../core/tests/fixtures';

describe('automatic segment weights', () => {
  const bones = [
    { boneIndex: 3, x0: 0, y0: 4, x1: 10, y1: 4 },
    { boneIndex: 1, x0: 0, y0: 0, x1: 10, y1: 0 },
  ];
  it('uses segment distance, inverse-square ratios, endpoint clamping and stable ties', () => {
    const rows = decodeWeights(
      autoWeights({ vertices: [5, 1, 5, 2, -3, 0], bones, maxInfluences: 2 }),
      3,
      4,
      true,
    );
    expect(rows[0]![0]!.weight).toBeCloseTo(0.9, 12);
    expect(rows[0]![1]!.weight).toBeCloseTo(0.1, 12);
    expect(rows[1]).toEqual([
      { boneIndex: 1, weight: 0.5 },
      { boneIndex: 3, weight: 0.5 },
    ]);
    expect(rows[2]![0]!.weight).toBeCloseTo(25 / 34, 12);
    expect(autoWeights({ vertices: [5, 2], bones, maxInfluences: 1 })).toEqual([1, 1, 1]);
    expect(autoWeights({ vertices: [5, 2], bones: [...bones].reverse(), maxInfluences: 1 })).toEqual([
      1, 1, 1,
    ]);
  });
  it('shares exact overlapping segments and handles zero-length bones without NaN', () => {
    const points = [2, 0, 1].map((boneIndex) => ({ boneIndex, x0: 3, y0: 4, x1: 3, y1: 4 }));
    expect(autoWeights({ vertices: [3, 4], bones: points, maxInfluences: 2 })).toEqual([2, 0, 0.5, 1, 0.5]);
    expect(autoWeights({ vertices: [5, 0], bones, maxInfluences: 2 })).toEqual([1, 1, 1]);
  });
  it('produces bounded normalized deterministic rows for seeded geometry (seed 0xbbb001)', () => {
    const random = seededRandom();
    const segments = Array.from({ length: 24 }, (_, boneIndex) => ({
      boneIndex,
      x0: random() * 100,
      y0: random() * 100,
      x1: random() * 100,
      y1: random() * 100,
    }));
    const vertices = Array.from({ length: 600 }, () => random() * 200 - 50),
      progress: number[] = [];
    const input = { vertices, bones: segments, maxInfluences: 4 };
    const result = autoWeights(input, (value) => progress.push(value));
    validateWeights(result, 300, 24);
    expect(autoWeights({ ...input, bones: [...segments].reverse() })).toEqual(result);
    for (const row of decodeWeights(result, 300, 24, true)) {
      expect(row.length).toBeLessThanOrEqual(4);
      expect(row.reduce((sum, entry) => sum + entry.weight, 0)).toBeCloseTo(1, 12);
    }
    expect(progress).toEqual([0, 128 / 300, 256 / 300, 1]);
  });
  it('rejects invalid dimensions, nonfinite coordinates, repeated indices and numeric overflow', () => {
    const valid = { vertices: [1, 2], bones, maxInfluences: 2 };
    for (const input of [
      { ...valid, vertices: [] },
      { ...valid, vertices: [1] },
      { ...valid, vertices: [NaN, 0] },
      { ...valid, maxInfluences: 0 },
      { ...valid, maxInfluences: 1.5 },
      { ...valid, bones: [] },
      { ...valid, bones: [bones[0]!, bones[0]!] },
      { ...valid, bones: [{ ...bones[0]!, boneIndex: -1 }] },
      { ...valid, bones: [{ ...bones[0]!, x1: Number.MAX_VALUE }] },
    ])
      expect(() => autoWeights(input)).toThrow();
  });
});
