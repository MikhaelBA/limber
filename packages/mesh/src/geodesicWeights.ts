import { encodeWeights, normalizeInfluences } from './weights';
import type { AutoWeightInput, BoneSegment } from './autoWeights';

function distance(x: number, y: number, bone: BoneSegment): number {
  const dx = bone.x1 - bone.x0,
    dy = bone.y1 - bone.y0,
    length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((x - bone.x0) * dx + (y - bone.y0) * dy) / length)) : 0;
  return Math.hypot(x - bone.x0 - t * dx, y - bone.y0 - t * dy);
}

/** Distance propagates along mesh edges, avoiding influence shortcuts across concavities. */
export function geodesicWeights(input: AutoWeightInput, progress?: (fraction: number) => void): number[] {
  const { vertices, bones, triangles = [], maxInfluences } = input,
    n = vertices.length / 2;
  const adjacency = Array.from({ length: n }, () => new Set<number>());
  if ((!triangles.length && !input.edges?.length) || triangles.length % 3)
    throw new Error('Topology auto weights need triangles or edges.');
  for (let t = 0; t < triangles.length; t += 3) {
    const row = triangles.slice(t, t + 3);
    if (row.some((index) => !Number.isInteger(index) || index < 0 || index >= n))
      throw new Error('Invalid auto weight topology.');
    for (let i = 0; i < 3; i++) {
      const a = row[i]!,
        b = row[(i + 1) % 3]!;
      adjacency[a]!.add(b);
      adjacency[b]!.add(a);
    }
  }
  if (input.edges) {
    if (input.edges.length % 2) throw new Error('Auto edges need index pairs.');
    for (let i = 0; i < input.edges.length; i += 2) {
      const a = input.edges[i]!,
        b = input.edges[i + 1]!;
      if (![a, b].every((index) => Number.isInteger(index) && index >= 0 && index < n))
        throw new Error('Invalid auto weight edge.');
      adjacency[a]!.add(b);
      adjacency[b]!.add(a);
    }
  }
  const components: number[][] = [],
    visited = new Set<number>();
  for (let i = 0; i < n; i++)
    if (!visited.has(i)) {
      const component = [i];
      visited.add(i);
      for (let p = 0; p < component.length; p++)
        for (const next of adjacency[component[p]!]!)
          if (!visited.has(next)) {
            visited.add(next);
            component.push(next);
          }
      components.push(component);
    }
  const distances = bones.map((bone, b) => {
    const distances = new Float64Array(n).fill(Infinity),
      heap: [number, number][] = [];
    const push = (entry: [number, number]) => {
      let i = heap.length;
      heap.push(entry);
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (heap[parent]![0] <= entry[0]) break;
        heap[i] = heap[parent]!;
        i = parent;
      }
      heap[i] = entry;
    };
    const pop = (): [number, number] => {
      const first = heap[0]!,
        last = heap.pop()!;
      if (heap.length) {
        let i = 0;
        while (i * 2 + 1 < heap.length) {
          let child = i * 2 + 1;
          if (child + 1 < heap.length && heap[child + 1]![0] < heap[child]![0]) child++;
          if (last[0] <= heap[child]![0]) break;
          heap[i] = heap[child]!;
          i = child;
        }
        heap[i] = last;
      }
      return first;
    };
    // Each disconnected island needs a seed; seed ties have deterministic vertex order.
    for (const component of components) {
      let seed = component[0]!,
        nearest = Infinity;
      for (const v of component) {
        const d = distance(vertices[v * 2]!, vertices[v * 2 + 1]!, bone);
        if (d < nearest) {
          nearest = d;
          seed = v;
        }
      }
      distances[seed] = nearest;
      push([nearest, seed]);
    }
    while (heap.length) {
      const [d, v] = pop();
      if (d !== distances[v]) continue;
      for (const next of adjacency[v]!) {
        const candidate =
          d +
          Math.hypot(vertices[v * 2]! - vertices[next * 2]!, vertices[v * 2 + 1]! - vertices[next * 2 + 1]!);
        if (candidate < distances[next]!) {
          distances[next] = candidate;
          push([candidate, next]);
        }
      }
    }
    progress?.((b + 1) / (bones.length + 1));
    return distances;
  });
  const rows = Array.from({ length: n }, (_, v) => {
    const ranked = bones
      .map((bone, b) => ({ boneIndex: bone.boneIndex, distance: distances[b]![v]! }))
      .sort((a, b) => a.distance - b.distance || a.boneIndex - b.boneIndex)
      .slice(0, maxInfluences);
    const closest = ranked[0]!.distance;
    return normalizeInfluences(
      ranked
        .filter((item) => closest > 0 || item.distance === 0)
        .map((item) => ({
          boneIndex: item.boneIndex,
          weight: closest === 0 ? 1 : (closest / item.distance) ** 2,
        })),
    );
  });
  progress?.(1);
  return encodeWeights(rows);
}
