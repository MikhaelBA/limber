import cdt2d from 'cdt2d';
import { validateHull, validateMeshTopology } from './topology';

/** Authored single-ring constrained triangulation; exterior faces never become runtime geometry. */
export function triangulateMesh(vertices: number[], hull?: number[]): number[] {
  const ring = validateHull(vertices, hull, true);
  const points = Array.from({ length: vertices.length / 2 }, (_, i) => [
    vertices[i * 2]!,
    vertices[i * 2 + 1]!,
  ]);
  const edges = ring.map((a, i) => [a, ring[(i + 1) % ring.length]!]);
  const faces = cdt2d(points, edges, { exterior: false });
  // Canonical triangle orientation/rotation/order keeps generated indices deterministic.
  for (const face of faces) {
    const a = points[face[0]!]!,
      b = points[face[1]!]!,
      c = points[face[2]!]!;
    if ((b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!) < 0)
      [face[1], face[2]] = [face[2]!, face[1]!];
    while (face[0]! > Math.min(...face)) face.push(face.shift()!);
  }
  faces.sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!);
  const triangles = faces.flat();
  validateMeshTopology({ vertices, triangles, hull: ring });
  return triangles;
}
