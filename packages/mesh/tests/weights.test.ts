import { describe, expect, it } from 'vitest';
import {
  decodeWeights,
  normalizeInfluences,
  normalizeWeights,
  paintInfluence,
  validateWeights,
} from '../src';

describe('portable influence contracts', () => {
  it('rejects malformed, nonfinite, negative, duplicate, noninteger and nonnormalized runtime rows', () => {
    for (const row of [
      [],
      [1, 0],
      [0, 0],
      [-1],
      [1.5, 0, 1],
      [1, NaN, 1],
      [1, 0.5, 1],
      [1, 2, 1],
      [1, 0, NaN],
      [1, 0, -1],
      [1, 0, Infinity],
      [1, 0, 0],
      [1, 0, 0.5],
      [2, 0, 0.5, 0, 0.5],
    ]) {
      expect(() => validateWeights(row, 1, 2), JSON.stringify(row)).toThrow();
    }
    expect(() => validateWeights([0, 2, 0, 0.25, 1, 0.75], 2, 2)).not.toThrow();
    expect(() => validateWeights(undefined, 4, 2)).not.toThrow();
    expect(() => validateWeights(null as unknown as number[], 1, 2)).toThrow(/array/);
  });
  it('uses deterministic ties, merges duplicate influences, handles extreme finite magnitudes and retains a strongest fallback', () => {
    const row = [
      { boneIndex: 4, weight: 2 },
      { boneIndex: 2, weight: 2 },
      { boneIndex: 0, weight: 1 },
      { boneIndex: 0, weight: 1 },
    ];
    expect(normalizeInfluences(row, { maxInfluences: 2 })).toEqual([
      { boneIndex: 0, weight: 0.5 },
      { boneIndex: 2, weight: 0.5 },
    ]);
    expect(normalizeInfluences([...row].reverse(), { maxInfluences: 2 })).toEqual(
      normalizeInfluences(row, { maxInfluences: 2 }),
    );
    expect(normalizeInfluences(row, { threshold: 0.9 })).toEqual([{ boneIndex: 0, weight: 1 }]);
    expect(
      normalizeInfluences([
        { boneIndex: 0, weight: Number.MAX_VALUE },
        { boneIndex: 1, weight: Number.MAX_VALUE },
      ]),
    ).toEqual([
      { boneIndex: 0, weight: 0.5 },
      { boneIndex: 1, weight: 0.5 },
    ]);
    expect(normalizeInfluences([{ boneIndex: 0, weight: 0 }])).toEqual([]);
    for (const maxInfluences of [0, NaN, 1.5])
      expect(() => normalizeInfluences(row, { maxInfluences })).toThrow();
  });
  it('preserves all other influences proportionally when painting any bone, including the slot bone', () => {
    const row = [
      { boneIndex: 0, weight: 0.2 },
      { boneIndex: 1, weight: 0.3 },
      { boneIndex: 2, weight: 0.5 },
    ];
    const changed = paintInfluence(row, 0, 0.6, 0);
    changed.forEach((entry, i) => expect(entry.weight).toBeCloseTo([0.6, 0.15, 0.25][i]!, 12));
    expect(row[0]!.weight).toBe(0.2);
    expect(paintInfluence([], 1, 0.25, 0)).toEqual([
      { boneIndex: 0, weight: 0.75 },
      { boneIndex: 1, weight: 0.25 },
    ]);
  });
  it('normalizes and prunes seeded property cases with finite nonnegative weights and exact row boundaries', () => {
    let seed = 147;
    const random = () => {
      seed = (1664525 * seed + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 400; i++) {
      const row = Array.from({ length: 12 }, (_, boneIndex) => ({ boneIndex, weight: random() * 1e200 }));
      const maxInfluences = 1 + (i % 8);
      const flat = [row.length, ...row.flatMap((entry) => [entry.boneIndex, entry.weight]), 0];
      const result = normalizeWeights(flat, 2, 12, { maxInfluences, threshold: 0.02 });
      validateWeights(result, 2, 12);
      const decoded = decodeWeights(result, 2, 12);
      expect(decoded[0]!.length).toBeLessThanOrEqual(maxInfluences);
      expect(decoded[0]!.reduce((sum, entry) => sum + entry.weight, 0)).toBeCloseTo(1, 12);
      expect(decoded[1]).toEqual([]);
      normalizeWeights(result, 2, 12, { maxInfluences }).forEach((value, index) =>
        expect(value).toBeCloseTo(result[index]!, 12),
      );
    }
  });
});
