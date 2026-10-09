import { describe, expect, it } from 'vitest';
import {
  smoothWeights,
  decodeWeights,
  validateWeights,
  autoMesh,
  encodeWeights,
  normalizeInfluences,
} from '../src';
import { seededRandom } from '../../core/tests/fixtures';

describe('neighbor weight smoothing', () => {
  const input = {
    weights: [1, 0, 1, 1, 1, 1, 1, 1, 1],
    triangles: [0, 1, 2],
    vertexCount: 3,
    boneCount: 2,
    slotBoneIndex: 0,
    strength: 0.5,
    iterations: 1,
    maxInfluences: 2,
  };
  it('computes synchronous passes and deduplicated edge means with golden rows', () => {
    const once = decodeWeights(smoothWeights(input), 3, 2, true);
    expect(once).toEqual([
      [
        { boneIndex: 0, weight: 0.5 },
        { boneIndex: 1, weight: 0.5 },
      ],
      [
        { boneIndex: 0, weight: 0.25 },
        { boneIndex: 1, weight: 0.75 },
      ],
      [
        { boneIndex: 0, weight: 0.25 },
        { boneIndex: 1, weight: 0.75 },
      ],
    ]);
    const twice = decodeWeights(smoothWeights({ ...input, iterations: 2 }), 3, 2, true)[0]!;
    expect(twice.map((entry) => entry.boneIndex)).toEqual([0, 1]);
    expect(twice[0]!.weight).toBeCloseTo(0.375, 12);
    expect(twice[1]!.weight).toBeCloseTo(0.625, 12);
    expect(smoothWeights({ ...input, triangles: [2, 0, 1, 0, 2, 1] })).toEqual(smoothWeights(input));
    expect(smoothWeights({ ...input, strength: 0 })).toEqual(input.weights);
    expect(input.weights).toEqual([1, 0, 1, 1, 1, 1, 1, 1, 1]);
  });
  it('uses the slot bone for empty rows and prunes normalized results with stable ties', () => {
    expect(decodeWeights(smoothWeights({ ...input, weights: [0, 1, 1, 1, 1, 1, 1] }), 3, 2, true)[0]).toEqual(
      [
        { boneIndex: 0, weight: 0.5 },
        { boneIndex: 1, weight: 0.5 },
      ],
    );
    expect(decodeWeights(smoothWeights({ ...input, maxInfluences: 1 }), 3, 2, true)).toEqual([
      [{ boneIndex: 0, weight: 1 }],
      [{ boneIndex: 1, weight: 1 }],
      [{ boneIndex: 1, weight: 1 }],
    ]);
  });
  it('keeps seeded passes finite/normalized and bounds progress messages (seed 0xbbb001)', () => {
    const random = seededRandom(),
      geometry = autoMesh({
        vertices: [0, 0, 100, 0, 100, 100, 0, 100],
        uvs: [0, 0, 1, 0, 1, 1, 0, 1],
        cols: 19,
        rows: 19,
      });
    const weights = encodeWeights(
      Array.from({ length: 400 }, () =>
        normalizeInfluences(Array.from({ length: 8 }, (_, boneIndex) => ({ boneIndex, weight: random() }))),
      ),
    );
    const progress: number[] = [],
      params = {
        ...input,
        weights,
        triangles: geometry.triangles,
        vertexCount: 400,
        boneCount: 8,
        iterations: 20,
        maxInfluences: 4,
      };
    const result = smoothWeights(params, (value) => progress.push(value));
    validateWeights(result, 400, 8);
    expect(decodeWeights(result, 400, 8, true).every((row) => row.length <= 4)).toBe(true);
    expect(smoothWeights({ ...params, triangles: [...params.triangles].reverse() })).toEqual(result);
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(1);
    expect(progress.length).toBeLessThanOrEqual(103);
    expect(progress.every((value, i) => i === 0 || value >= progress[i - 1]!)).toBe(true);
  });
  it('rejects malformed weights, invalid options and missing/degenerate adjacency', () => {
    for (const params of [
      { ...input, strength: NaN },
      { ...input, strength: -1 },
      { ...input, iterations: 0 },
      { ...input, iterations: 101 },
      { ...input, maxInfluences: 0 },
      { ...input, slotBoneIndex: 2 },
      { ...input, weights: [] },
      { ...input, triangles: [0, 0, 2] },
      { ...input, triangles: [0, 1, 3] },
      { ...input, triangles: [] },
      { ...input, weights: [...input.weights, 0], vertexCount: 4 },
    ])
      expect(() => smoothWeights(params)).toThrow();
  });
});
