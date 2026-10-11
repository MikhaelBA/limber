import { describe, expect, it } from 'vitest';
import {
  editInfluences,
  mergeLockedInfluences,
  pruneInfluences,
  brushFalloff,
  orderWeightedTriangles,
  weightNeighbors,
  autoWeights,
  decodeWeights,
  smoothWeights,
  encodeWeights,
} from '../src';

const row = [
  { boneIndex: 0, weight: 0.2 },
  { boneIndex: 1, weight: 0.3 },
  { boneIndex: 2, weight: 0.5 },
];
describe('weight authoring semantics', () => {
  it('redistributes other influences proportionally in both directions', () => {
    expect(editInfluences(row, new Set([0]), 0.6)).toEqual([
      { boneIndex: 0, weight: 0.6 },
      { boneIndex: 1, weight: 0.15 },
      { boneIndex: 2, weight: 0.25 },
    ]);
    const result = editInfluences(row, new Set([0]), 0.1);
    expect(result[1]!.weight / result[2]!.weight).toBeCloseTo(0.6);
    expect(result.reduce((sum, item) => sum + item.weight, 0)).toBeCloseTo(1);
  });
  it('keeps locked values exact and clamps selected weight to the unlocked budget', () => {
    const result = editInfluences(row, new Set([0]), 0.99, new Set([2]));
    expect(result).toEqual([
      { boneIndex: 0, weight: 0.5 },
      { boneIndex: 2, weight: 0.5 },
    ]);
    expect(editInfluences(row, new Set([2]), 0.1, new Set([2]))).toEqual(row);
  });
  it('edits multiple selected bones as a proportional group', () => {
    const result = editInfluences(row, new Set([0, 1]), 0.75);
    expect(result[0]!.weight).toBeCloseTo(0.3);
    expect(result[1]!.weight).toBeCloseTo(0.45);
    expect(result[2]!.weight).toBeCloseTo(0.25);
  });
  it('cannot reduce a sole 100% influence or invent a fallback influence', () => {
    const single = [{ boneIndex: 2, weight: 1 }];
    expect(editInfluences(single, new Set([2]), 0.4, new Set(), 0)).toEqual(single);
    expect(editInfluences([...single, { boneIndex: 0, weight: 0 }], new Set([2]), 0.4)).toEqual([
      ...single,
      { boneIndex: 0, weight: 0 },
    ]);
    expect(editInfluences(single, new Set([1]), 0.4)).toEqual([
      { boneIndex: 1, weight: 0.4 },
      { boneIndex: 2, weight: 0.6 },
    ]);
  });
  it('adds absent selected bones equally and rejects nonfinite inputs', () => {
    expect(editInfluences([{ boneIndex: 0, weight: 1 }], new Set([1, 2]), 0.6)).toEqual([
      { boneIndex: 0, weight: 0.4 },
      { boneIndex: 1, weight: 0.3 },
      { boneIndex: 2, weight: 0.3 },
    ]);
    expect(() => editInfluences(row, new Set([0]), NaN)).toThrow(/finite/);
  });
  it('preserves locked weights through Auto/paste/smoothing distribution replacement', () => {
    const result = mergeLockedInfluences(
      row,
      [
        { boneIndex: 0, weight: 0.9 },
        { boneIndex: 2, weight: 0.1 },
      ],
      new Set([2]),
      0,
    );
    expect(result).toEqual([
      { boneIndex: 0, weight: 0.5 },
      { boneIndex: 2, weight: 0.5 },
    ]);
  });
  it('prunes with absolute thresholds and a hard limit without silently altering locks', () => {
    const result = pruneInfluences(row, { threshold: 0.25, maxInfluences: 2 });
    expect(result.map((item) => item.boneIndex)).toEqual([1, 2]);
    expect(result[0]!.weight).toBeCloseTo(0.375);
    expect(() => pruneInfluences(row, { maxInfluences: 1 }, new Set([2]))).toThrow(/Unlock/);
    expect(pruneInfluences(row, { maxInfluences: 2 }, new Set([2]))[1]!.weight).toBe(0.5);
  });
  it('uses a solid brush center and only feathers the outer annulus', () => {
    expect(brushFalloff(30, 100, 0.5)).toBe(1);
    expect(brushFalloff(75, 100, 0.5)).toBe(0.5);
    expect(brushFalloff(100, 100, 0.5)).toBe(0);
    expect(brushFalloff(99, 100, 0)).toBe(1);
  });
  it('orders triangles by summed dominant influence, independently of skeleton bone order', () => {
    const rows = [
      [{ boneIndex: 0, weight: 1 }],
      [
        { boneIndex: 0, weight: 0.7 },
        { boneIndex: 1, weight: 0.3 },
      ],
      [{ boneIndex: 1, weight: 1 }],
      [{ boneIndex: 1, weight: 1 }],
    ];
    expect(orderWeightedTriangles([0, 1, 2, 1, 2, 3], rows, [1, 0])).toEqual([1, 2, 3, 0, 1, 2]);
  });
  it('smoothing uses only hull and manual edges; auto diagonals do not become neighbors', () => {
    expect(weightNeighbors(5, [0, 1, 2, 3], [0, 4, 2, 4])).toEqual([
      [1, 3, 4],
      [0, 2],
      [1, 3, 4],
      [0, 2],
      [0, 2],
    ]);
    const rows = Array.from({ length: 5 }, (_, i) => [{ boneIndex: i === 4 ? 1 : 0, weight: 1 }]);
    const result = decodeWeights(
      smoothWeights({
        weights: encodeWeights(rows),
        vertexCount: 5,
        boneCount: 2,
        slotBoneIndex: 0,
        triangles: [],
        neighbors: weightNeighbors(5, [0, 1, 2, 3]),
        strength: 1,
        iterations: 2,
        maxInfluences: 2,
        selectedVertices: [0, 4],
      }),
      5,
      2,
    );
    expect(result[4]).toEqual(rows[4]);
    expect(result[1]).toEqual(rows[1]);
  });
  it('propagates Auto along a folded topology rather than through a spatial shortcut', () => {
    // Two spatially close tips of a long U-shaped control chain.
    const vertices = [0, 0, 0, 100, 100, 100, 100, 0, 1, 0];
    const bones = [
      { boneIndex: 0, x0: 0, y0: 0, x1: 0, y1: 0 },
      { boneIndex: 1, x0: 100, y0: 0, x1: 100, y1: 0 },
    ];
    const progress: number[] = [];
    const result = decodeWeights(
      autoWeights(
        { vertices, bones, edges: [0, 1, 1, 2, 2, 3, 3, 4], maxInfluences: 2 },
        (fraction) => progress.push(fraction),
      ),
      5,
      2,
    );
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(1);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect(result[4]!.find((item) => item.boneIndex === 1)!.weight).toBeGreaterThan(0.9);
    const spatial = decodeWeights(autoWeights({ vertices, bones, maxInfluences: 2 }), 5, 2);
    expect(spatial[4]!.find((item) => item.boneIndex === 0)!.weight).toBeGreaterThan(0.99);
  });
});
