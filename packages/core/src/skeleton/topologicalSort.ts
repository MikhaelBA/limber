import type { BoneData } from '../types/data';

/**
 * Stable topological sort (parents before children) via Kahn's algorithm with
 * min-index selection: among all "ready" nodes (parent already emitted), the
 * one appearing FIRST in the source array is emitted first.
 *
 * Guarantees:
 * - Deterministic.
 * - An already-sorted input comes back in exactly the same order — which keeps
 *   bone indices (and attachment weight indices) stable across rebuilds.
 *
 * Throws on duplicate bone ids, unknown parentIds, or hierarchy cycles.
 */
export function topologicalSortBones(bones: BoneData[]): BoneData[] {
  const indexById = new Map<string, number>();
  for (let i = 0; i < bones.length; i++) {
    const bone = bones[i]!;
    if (indexById.has(bone.id)) {
      throw new Error(`Duplicate bone id: "${bone.id}" (bone "${bone.name}").`);
    }
    indexById.set(bone.id, i);
  }

  const children: number[][] = Array.from({ length: bones.length }, () => []);
  const inDegree: number[] = new Array<number>(bones.length).fill(0);
  for (let i = 0; i < bones.length; i++) {
    const parentId = bones[i]!.parentId;
    if (parentId === null) continue;
    const parent = indexById.get(parentId);
    if (parent === undefined) {
      throw new Error(`Bone "${bones[i]!.name}" references unknown parentId "${parentId}".`);
    }
    children[parent]!.push(i);
    inDegree[i]!++;
  }

  // Min-heap of ready node indices keyed by ORIGINAL index (see doc comment).
  const heap: number[] = [];
  const swap = (a: number, b: number): void => {
    const t = heap[a]!;
    heap[a] = heap[b]!;
    heap[b] = t;
  };
  const heapPush = (v: number): void => {
    heap.push(v);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent]! <= heap[i]!) break;
      swap(i, parent);
      i = parent;
    }
  };
  const heapPop = (): number => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let smallest = i;
        if (left < heap.length && heap[left]! < heap[smallest]!) smallest = left;
        if (right < heap.length && heap[right]! < heap[smallest]!) smallest = right;
        if (smallest === i) break;
        swap(i, smallest);
        i = smallest;
      }
    }
    return top;
  };

  for (let i = 0; i < bones.length; i++) {
    if (inDegree[i] === 0) heapPush(i);
  }

  const sorted: BoneData[] = [];
  while (heap.length > 0) {
    const i = heapPop();
    sorted.push(bones[i]!);
    for (const child of children[i]!) {
      if (--inDegree[child]! === 0) heapPush(child);
    }
  }

  if (sorted.length !== bones.length) {
    const sortedSet = new Set(sorted);
    const cyclic = bones.filter((b) => !sortedSet.has(b)).map((b) => b.name);
    throw new Error(`Bone hierarchy contains a cycle involving: ${cyclic.join(', ')}.`);
  }
  return sorted;
}
