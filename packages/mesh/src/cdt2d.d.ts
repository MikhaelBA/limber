declare module 'cdt2d' {
  function cdt2d(
    positions: number[][],
    edges: number[][],
    options?: { exterior?: boolean; interior?: boolean; delaunay?: boolean },
  ): number[][];
  export = cdt2d;
}
