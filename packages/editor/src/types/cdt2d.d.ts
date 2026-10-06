/**
 * cdt2d ships no TypeScript declarations (CJS, no `types` field). Constrained
 * Delaunay triangulation: all points participate (hull ring AND interior
 * Steiner points), constraint edges are preserved.
 */
declare module 'cdt2d' {
  /**
   * @param positions  Vertex positions as [x, y] pairs.
   * @param edges      Constraint edges as vertex-index pairs (the hull ring).
   * @returns          Triangles as index TRIPLES [a, b, c], or [] when the
   *                   input is degenerate (collinear/duplicate points).
   */
  function cdt2d(positions: number[][], edges: number[][]): number[][];
  export = cdt2d;
}
