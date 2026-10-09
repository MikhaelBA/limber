import { validateMeshTopology } from './topology';

export interface AutoMeshInput {
  /** TL, TR, BR, BL coordinates and UVs; interpolated without changing the artwork. */
  vertices: readonly number[];
  uvs: readonly number[];
  cols: number;
  rows: number;
}
export interface AutoMeshGeometry {
  vertices: number[];
  uvs: number[];
  triangles: number[];
  hull: number[];
}

/** Automatic regular quad lattice. Transparent pixels are retained; this is not alpha tracing. */
export function autoMesh(input: AutoMeshInput, progress?: (fraction: number) => void): AutoMeshGeometry {
  const { cols, rows } = input;
  if (![cols, rows].every((n) => Number.isInteger(n) && n >= 1) || (cols + 1) * (rows + 1) > 100000)
    throw new Error('Auto mesh needs positive integer subdivisions and at most 100000 vertices.');
  if (
    ![input.vertices, input.uvs].every(
      (pairs) => Array.isArray(pairs) && pairs.length === 8 && Array.from(pairs).every(Number.isFinite),
    )
  )
    throw new Error('Auto mesh needs four finite region corners and UV pairs.');
  validateMeshTopology({
    vertices: input.vertices,
    uvs: input.uvs,
    triangles: [0, 1, 2, 0, 2, 3],
    hull: [0, 1, 2, 3],
  });
  const vertices: number[] = [],
    uvs: number[] = [],
    triangles: number[] = [],
    hull: number[] = [];
  const interpolate = (pairs: readonly number[], output: number[], u: number, v: number) => {
    for (let axis = 0; axis < 2; axis++) {
      const top = pairs[axis]! * (1 - u) + pairs[2 + axis]! * u;
      const bottom = pairs[6 + axis]! * (1 - u) + pairs[4 + axis]! * u;
      output.push(top * (1 - v) + bottom * v);
    }
  };
  progress?.(0);
  const w = cols + 1;
  let lastProgress = 0;
  for (let y = 0; y <= rows; y++) {
    for (let x = 0; x <= cols; x++) {
      interpolate(input.vertices, vertices, x / cols, y / rows);
      interpolate(input.uvs, uvs, x / cols, y / rows);
      if (x < cols && y < rows) {
        const i = y * w + x;
        triangles.push(i, i + 1, i + w + 1, i, i + w + 1, i + w);
      }
    }
    const fraction = (0.8 * (y + 1)) / (rows + 1);
    if (fraction - lastProgress >= 0.01 || y === rows) {
      progress?.(fraction);
      lastProgress = fraction;
    }
  }
  for (let x = 0; x <= cols; x++) hull.push(x);
  for (let y = 1; y <= rows; y++) hull.push(y * w + cols);
  for (let x = cols - 1; x >= 0; x--) hull.push(rows * w + x);
  for (let y = rows - 1; y > 0; y--) hull.push(y * w);
  progress?.(0.9);
  const result = { vertices, uvs, triangles, hull };
  validateMeshTopology(result);
  progress?.(1);
  return result;
}
