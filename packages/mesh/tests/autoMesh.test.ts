import { describe, expect, it } from 'vitest';
import { autoMesh, validateMeshTopology } from '../src';
import { seededRandom } from '../../core/tests/fixtures';

describe('automatic quad lattice', () => {
  const quad = [-10, -20, 10, -20, 10, 20, -10, 20],
    uv = [0, 0, 1, 0, 1, 1, 0, 1];
  it('retains corners, center, source UV range and deterministic faces/perimeter', () => {
    const progress: number[] = [],
      result = autoMesh({ vertices: quad, uvs: uv, cols: 2, rows: 2 }, (value) => progress.push(value));
    expect(result.vertices).toEqual([-10, -20, 0, -20, 10, -20, -10, 0, 0, 0, 10, 0, -10, 20, 0, 20, 10, 20]);
    expect(result.uvs.slice(8, 10)).toEqual([0.5, 0.5]);
    expect(result.hull).toEqual([0, 1, 2, 5, 8, 7, 6, 3]);
    expect(result.triangles.slice(0, 6)).toEqual([0, 1, 4, 0, 4, 3]);
    expect(result.triangles.length).toBe(24);
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(1);
    expect(progress.every((value, i) => i === 0 || value >= progress[i - 1]!)).toBe(true);
    expect(quad).toEqual([-10, -20, 10, -20, 10, 20, -10, 20]);
    expect(autoMesh({ vertices: uv, uvs: uv, cols: 1, rows: 1 }).uvs).toEqual([0, 0, 1, 0, 0, 1, 1, 1]);
  });
  it('validates reflected and sheared affine grids (seed 0xbbb001)', () => {
    const random = seededRandom();
    for (let i = 0; i < 80; i++) {
      const a = (i % 2 ? -1 : 1) * (0.5 + random()),
        d = 0.5 + random(),
        c = random() - 0.5;
      const vertices = quad.map((value, k) => (k % 2 ? value * d + 30 : a * value + c * quad[k + 1]! - 20));
      const result = autoMesh({ vertices, uvs: uv, cols: 1 + (i % 8), rows: 1 + (i % 7) });
      expect(() => validateMeshTopology(result), `seed 0xbbb001 case ${i}`).not.toThrow();
    }
  });
  it('rejects degenerate corners, missing/nonfinite UVs, overflow and excessive subdivisions', () => {
    const input = { vertices: quad, uvs: uv, cols: 2, rows: 2 };
    for (const candidate of [
      { ...input, cols: 0 },
      { ...input, rows: 1.5 },
      { ...input, cols: 1000, rows: 1000 },
      { ...input, vertices: [0, 0, 1, 0, 1, 0, 0, 1] },
      { ...input, vertices: quad.slice(0, 6) },
      { ...input, uvs: [NaN, ...uv.slice(1)] },
      { ...input, vertices: quad.map((v) => v * 1e308) },
    ])
      expect(() => autoMesh(candidate)).toThrow();
  });
});
