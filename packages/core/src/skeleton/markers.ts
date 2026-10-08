import type { MarkerData, MarkerKind, SkeletonData } from '../types/data';
import type { SkeletonPose } from '../types/pose';
import {
  identitySceneMatrix,
  multiplySceneMatrices,
  sceneLocalMatrix,
  scenePoint,
  type SceneMatrix,
} from '../project/scene';

export const MARKER_KINDS: readonly MarkerKind[] = [
  'point',
  'socket',
  'spawnPoint',
  'hitbox',
  'hurtbox',
  'trigger',
];
export const isAreaMarker = (kind: MarkerKind): boolean => ['hitbox', 'hurtbox', 'trigger'].includes(kind);

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Marker data must be an object.');
  return value as Record<string, unknown>;
}

/** Reject self-crossing or degenerate polygons; concave simple polygons are supported. */
function validatePolygon(vertices: unknown): void {
  if (
    !Array.isArray(vertices) ||
    vertices.length < 6 ||
    vertices.length > 512 ||
    vertices.length % 2 !== 0 ||
    !vertices.every(finite)
  )
    throw new Error('Marker polygon needs 3–256 finite coordinate pairs.');
  const points = Array.from(
    { length: vertices.length / 2 },
    (_, i) => [vertices[i * 2]!, vertices[i * 2 + 1]!] as const,
  );
  const cross = (a: readonly number[], b: readonly number[], c: readonly number[]) =>
    (b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!);
  const on = (a: readonly number[], b: readonly number[], p: readonly number[]) =>
    Math.abs(cross(a, b, p)) < 1e-9 &&
    p[0]! >= Math.min(a[0]!, b[0]!) &&
    p[0]! <= Math.max(a[0]!, b[0]!) &&
    p[1]! >= Math.min(a[1]!, b[1]!) &&
    p[1]! <= Math.max(a[1]!, b[1]!);
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!,
      b = points[(i + 1) % points.length]!;
    if (a[0] === b[0] && a[1] === b[1]) throw new Error('Marker polygon has a zero-length edge.');
    area += a[0] * b[1] - b[0] * a[1];
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      const c = points[j]!,
        d = points[(j + 1) % points.length]!;
      if (
        (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) ||
        on(a, b, c) ||
        on(a, b, d) ||
        on(c, d, a) ||
        on(c, d, b)
      ) {
        throw new Error('Marker polygon must not intersect itself.');
      }
    }
  }
  if (Math.abs(area) < 1e-9) throw new Error('Marker polygon needs a nonzero area.');
}

export function validateMarkers(value: unknown, boneIds: { has(id: string): boolean }): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) throw new Error('Skeleton markers must be an array.');
  const ids = new Set<string>();
  for (const item of value) {
    const marker = record(item);
    for (const key of ['id', 'name', 'boneId']) {
      if (typeof marker[key] !== 'string' || !marker[key].trim())
        throw new Error(`Marker ${key} must be nonempty text.`);
    }
    const id = marker.id as string;
    if (ids.has(id)) throw new Error(`Duplicate marker id "${id}".`);
    ids.add(id);
    if (!boneIds.has(marker.boneId as string)) throw new Error(`Marker "${id}" references an unknown bone.`);
    if (!MARKER_KINDS.includes(marker.kind as MarkerKind))
      throw new Error(`Marker "${id}" has an unsupported kind.`);
    const transform = record(marker.transform);
    for (const key of ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'shearX', 'shearY']) {
      if (!finite(transform[key])) throw new Error(`Marker "${id}" needs a finite ${key}.`);
    }
    if (isAreaMarker(marker.kind as MarkerKind)) {
      const shape = record(marker.shape);
      if (shape.type === 'rectangle') {
        if (!finite(shape.width) || !finite(shape.height) || shape.width <= 0 || shape.height <= 0) {
          throw new Error('Marker rectangle dimensions must be positive and finite.');
        }
      } else if (shape.type === 'polygon') validatePolygon(shape.vertices);
      else throw new Error('Marker area needs a rectangle or polygon.');
    } else if (marker.shape !== undefined) throw new Error('Point-like markers cannot have area geometry.');
  }
}

export interface EvaluatedMarker {
  marker: MarkerData;
  world: SceneMatrix;
  /** World-space polygon; empty for point-like markers. */
  outline: number[];
}

/** Uses the sampled/solved pose, never mutates setup, and optionally composes the owning rig node. */
export function evaluateMarkers(
  data: SkeletonData,
  pose: SkeletonPose,
  boneIndices: ReadonlyMap<string, number>,
  rigWorld: SceneMatrix = identitySceneMatrix(),
): EvaluatedMarker[] {
  return (data.markers ?? []).map((marker) => {
    const index = boneIndices.get(marker.boneId);
    if (index === undefined) throw new Error(`Marker "${marker.id}" references an unknown bone.`);
    const boneWorld = Array.from(pose.worldMatrices.slice(index * 6, index * 6 + 6)) as SceneMatrix;
    const world = multiplySceneMatrices(
      rigWorld,
      multiplySceneMatrices(boneWorld, sceneLocalMatrix({ ...marker.transform, pivotX: 0, pivotY: 0 })),
    );
    let local: number[] = [];
    if ('shape' in marker) {
      if (marker.shape.type === 'polygon') local = marker.shape.vertices;
      else {
        const x = marker.shape.width / 2,
          y = marker.shape.height / 2;
        local = [-x, -y, x, -y, x, y, -x, y];
      }
    }
    const outline: number[] = [];
    for (let i = 0; i < local.length; i += 2) {
      const point = scenePoint(world, local[i]!, local[i + 1]!);
      outline.push(point.x, point.y);
    }
    return { marker, world, outline };
  });
}
