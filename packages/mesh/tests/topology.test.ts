import { describe, expect, it } from 'vitest';
import { polygonArea2, validateHull, validateMeshTopology } from '../src';
import { triangulateMesh } from '../src/triangulate';

const square = [0, 0, 4, 0, 4, 4, 0, 4];
describe('single-boundary mesh topology', () => {
  it('triangulates a concave L without exterior faces, in deterministic canonical order', () => {
    const vertices = [0, 0, 4, 0, 4, 1, 1, 1, 1, 4, 0, 4];
    const triangles = triangulateMesh(vertices);
    expect(triangles).toHaveLength(12);
    expect(triangulateMesh([...vertices])).toEqual(triangles);
    let area = 0;
    for (let i = 0; i < triangles.length; i += 3)
      area += Math.abs(polygonArea2(vertices, triangles.slice(i, i + 3)));
    expect(area).toBe(14); // L area = 4*1 + 3*1 = 7, doubled.
    expect(() => validateMeshTopology({ vertices, triangles, hull: [0, 1, 2, 3, 4, 5] })).not.toThrow();
  });
  it('supports collinear boundary points and interior Steiner points, and infers missing hulls without rewriting source', () => {
    const vertices = [0, 0, 2, 0, 4, 0, 4, 4, 0, 4, 2, 2];
    const triangles = triangulateMesh(vertices, [0, 1, 2, 3, 4]);
    const geometry = { vertices, triangles },
      before = structuredClone(geometry);
    expect(validateMeshTopology(geometry)).toHaveLength(5);
    expect(new Set(triangles).size).toBe(6);
    expect(geometry).toEqual(before);
    const translated = vertices.map((value) => value + 1e12);
    expect(() => validateMeshTopology({ vertices: translated, triangles })).not.toThrow();
  });
  it('rejects broken boundaries, duplicate/nonfinite vertices, exterior and on-edge unbound points', () => {
    for (const vertices of [
      [0, 0, 4, 4, 0, 4, 4, 0],
      [0, 0, 1, 0, 2, 0],
      [0, 0, 4, 0, 0, 0],
      [0, 0, Infinity, 0, 0, 4],
    ])
      expect(() => validateHull(vertices)).toThrow();
    expect(() => triangulateMesh([...square, 8, 8], [0, 1, 2, 3])).toThrow(/outside/);
    expect(() => triangulateMesh([...square, 2, 0], [0, 1, 2, 3])).toThrow(/boundary/);
  });
  it('rejects invalid indices, missing/overlapping faces, nonfinite UVs and mismatched hulls', () => {
    for (const triangles of [
      [0, 1],
      [0, 0, 1],
      [0, 1, 9],
      [0, 1, 1.5],
      [0, 1, 2],
      [0, 1, 2, 0, 1, 2, 0, 2, 3],
      [0, 1, 2, 1, 2, 3],
    ]) {
      expect(() => validateMeshTopology({ vertices: square, triangles })).toThrow();
    }
    const triangles = [0, 1, 2, 0, 2, 3];
    expect(() => validateMeshTopology({ vertices: square, triangles, uvs: [NaN, 0] })).toThrow(/UV/);
    expect(() => validateMeshTopology({ vertices: square, triangles, hull: [0, 1, 2] })).toThrow(/hull/);
    expect(() => validateMeshTopology({ vertices: square, triangles })).not.toThrow();
  });
});
