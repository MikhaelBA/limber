export interface MeshGeometry {
  vertices: readonly number[];
  triangles: readonly number[];
  uvs?: readonly number[];
  hull?: readonly number[];
}

function fail(message: string): never {
  throw new Error(`Invalid mesh: ${message}`);
}
function cross(v: readonly number[], a: number, b: number, c: number): number {
  return (
    (v[b * 2]! - v[a * 2]!) * (v[c * 2 + 1]! - v[a * 2 + 1]!) -
    (v[b * 2 + 1]! - v[a * 2 + 1]!) * (v[c * 2]! - v[a * 2]!)
  );
}
export function validateVertices(vertices: readonly number[]): number {
  if (
    !Array.isArray(vertices) ||
    vertices.length < 6 ||
    vertices.length % 2 ||
    vertices.some((v) => !Number.isFinite(v))
  )
    fail('vertices need at least three finite coordinate pairs.');
  const seen = new Set<string>();
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (let i = 0; i < vertices.length; i += 2) {
    const x = vertices[i]!,
      y = vertices[i + 1]!,
      key = `${x},${y}`;
    if (seen.has(key)) fail('duplicate vertex positions.');
    seen.add(key);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const scale = Math.max(maxX - minX, maxY - minY),
    epsilon = Math.max(1, scale * scale) * 1e-12;
  if (!Number.isFinite(epsilon)) fail('coordinate range exceeds numeric precision.');
  return epsilon;
}
function onSegment(v: readonly number[], a: number, b: number, c: number, epsilon: number): boolean {
  return (
    Math.abs(cross(v, a, b, c)) <= epsilon &&
    v[c * 2]! >= Math.min(v[a * 2]!, v[b * 2]!) &&
    v[c * 2]! <= Math.max(v[a * 2]!, v[b * 2]!) &&
    v[c * 2 + 1]! >= Math.min(v[a * 2 + 1]!, v[b * 2 + 1]!) &&
    v[c * 2 + 1]! <= Math.max(v[a * 2 + 1]!, v[b * 2 + 1]!)
  );
}
export function polygonArea2(vertices: readonly number[], ring: readonly number[]): number {
  let sum = 0;
  for (let i = 1; i + 1 < ring.length; i++) sum += cross(vertices, ring[0]!, ring[i]!, ring[i + 1]!);
  return sum;
}
/** Single simple boundary, including collinear boundary vertices but excluding overlapping edges. */
export function validateHull(
  vertices: readonly number[],
  hull?: readonly number[],
  checkInterior = false,
): number[] {
  const epsilon = validateVertices(vertices),
    n = vertices.length / 2;
  if (hull !== undefined && !Array.isArray(hull)) fail('hull must be an index array.');
  const ring = hull === undefined ? Array.from({ length: n }, (_, i) => i) : Array.from(hull);
  if (
    ring.length < 3 ||
    new Set(ring).size !== ring.length ||
    ring.some((i) => !Number.isInteger(i) || i < 0 || i >= n)
  )
    fail('hull indices must form a unique boundary of at least three vertices.');
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!,
      b = ring[(i + 1) % ring.length]!,
      next = ring[(i + 2) % ring.length]!;
    if (
      Math.abs(cross(vertices, a, b, next)) <= epsilon &&
      (vertices[a * 2]! - vertices[b * 2]!) * (vertices[next * 2]! - vertices[b * 2]!) +
        (vertices[a * 2 + 1]! - vertices[b * 2 + 1]!) * (vertices[next * 2 + 1]! - vertices[b * 2 + 1]!) >
        0
    )
      fail('overlapping boundary edges.');
    for (let j = i + 1; j < ring.length; j++) {
      if (j === i + 1 || (i === 0 && j === ring.length - 1)) continue;
      const c = ring[j]!,
        d = ring[(j + 1) % ring.length]!;
      if (
        (cross(vertices, a, b, c) * cross(vertices, a, b, d) < 0 &&
          cross(vertices, c, d, a) * cross(vertices, c, d, b) < 0) ||
        onSegment(vertices, a, b, c, epsilon) ||
        onSegment(vertices, a, b, d, epsilon) ||
        onSegment(vertices, c, d, a, epsilon) ||
        onSegment(vertices, c, d, b, epsilon)
      )
        fail('self-intersecting boundary.');
    }
  }
  if (!Number.isFinite(polygonArea2(vertices, ring)) || Math.abs(polygonArea2(vertices, ring)) <= epsilon)
    fail('zero-area boundary.');
  if (checkInterior) {
    const boundary = new Set(ring);
    for (let p = 0; p < n; p++) {
      if (boundary.has(p)) continue;
      let inside = false;
      const x = vertices[p * 2]!,
        y = vertices[p * 2 + 1]!;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]!,
          b = ring[(i + 1) % ring.length]!;
        if (onSegment(vertices, a, b, p, epsilon))
          fail('a vertex on the boundary must be included in the hull.');
        const ax = vertices[a * 2]!,
          ay = vertices[a * 2 + 1]!,
          bx = vertices[b * 2]!,
          by = vertices[b * 2 + 1]!;
        if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
      }
      if (!inside) fail('an interior vertex lies outside the hull.');
    }
  }
  return ring;
}

/** Validate the complete triangle disk, not only individual index ranges. No source mutation. */
export function validateMeshTopology({ vertices, triangles, uvs, hull }: MeshGeometry): number[] {
  const epsilon = validateVertices(vertices),
    n = vertices.length / 2;
  if (
    uvs !== undefined &&
    (!Array.isArray(uvs) || uvs.length !== vertices.length || uvs.some((v) => !Number.isFinite(v)))
  )
    fail('UV coordinates must match the finite vertex array.');
  if (
    !Array.isArray(triangles) ||
    !triangles.length ||
    triangles.length % 3 ||
    triangles.some((i) => !Number.isInteger(i) || i < 0 || i >= n)
  )
    fail('triangles need complete in-range index triples.');
  const edges = new Map<string, { count: number; balance: number; a: number; b: number }>(),
    used = new Set<number>();
  let area = 0;
  const edgeKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  for (let i = 0; i < triangles.length; i += 3) {
    const a = triangles[i]!,
      b = triangles[i + 1]!,
      c = triangles[i + 2]!,
      signed = cross(vertices, a, b, c);
    if (!Number.isFinite(signed) || Math.abs(signed) <= epsilon) fail('degenerate triangle.');
    area += Math.abs(signed);
    used.add(a);
    used.add(b);
    used.add(c);
    const face = signed > 0 ? [a, b, c] : [a, c, b];
    for (let j = 0; j < 3; j++) {
      const from = face[j]!,
        to = face[(j + 1) % 3]!,
        key = edgeKey(from, to);
      const edge = edges.get(key) ?? { count: 0, balance: 0, a: from, b: to };
      edge.count++;
      edge.balance += from < to ? 1 : -1;
      if (edge.count > 2 || (edge.count === 2 && edge.balance !== 0))
        fail('overlapping triangles or non-manifold edges.');
      edges.set(key, edge);
    }
  }
  if (used.size !== n) fail('unreferenced vertices.');
  const boundary = [...edges.values()].filter((edge) => edge.count === 1);
  const next = new Map<number, number>();
  for (const edge of boundary) {
    if (next.has(edge.a)) fail('boundary branches.');
    next.set(edge.a, edge.b);
  }
  const ring: number[] = [],
    start = boundary[0]?.a;
  if (start === undefined) fail('missing boundary.');
  let cursor = start;
  do {
    if (ring.length >= boundary.length || !next.has(cursor)) fail('disconnected boundary.');
    ring.push(cursor);
    cursor = next.get(cursor)!;
  } while (cursor !== start);
  if (ring.length !== boundary.length) fail('holes or disconnected components are unsupported.');
  const expected = validateHull(vertices, hull === undefined ? ring : hull);
  const keys = new Set(boundary.map((edge) => edgeKey(edge.a, edge.b)));
  if (
    expected.length !== keys.size ||
    expected.some((a, i) => !keys.has(edgeKey(a, expected[(i + 1) % expected.length]!)))
  )
    fail('triangles do not match the authored hull.');
  const hullArea = Math.abs(polygonArea2(vertices, expected));
  if (
    !Number.isFinite(area) ||
    Math.abs(area - hullArea) > Math.max(epsilon * triangles.length, hullArea * 1e-9)
  )
    fail('triangles do not cover the hull exactly.');
  return expected;
}
