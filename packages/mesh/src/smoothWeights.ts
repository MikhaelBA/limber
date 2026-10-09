import { decodeWeights, encodeWeights, normalizeInfluences, type Influence } from './weights';

export interface SmoothWeightInput {
  weights: readonly number[];
  vertexCount: number;
  boneCount: number;
  slotBoneIndex: number;
  triangles: readonly number[];
  strength: number;
  iterations: number;
  maxInfluences: number;
}

/** Jacobi smoothing: every pass reads the previous pass; edge/triangle order has no effect. */
export function smoothWeights(input: SmoothWeightInput, progress?: (fraction: number) => void): number[] {
  const { vertexCount, boneCount, slotBoneIndex, strength, iterations, maxInfluences, triangles } = input;
  if (
    !Number.isFinite(strength) ||
    strength < 0 ||
    strength > 1 ||
    !Number.isInteger(iterations) ||
    iterations < 1 ||
    iterations > 100 ||
    !Number.isInteger(maxInfluences) ||
    maxInfluences < 1
  )
    throw new Error(
      'Smoothing needs strength in [0,1], 1–100 integer passes and a positive influence limit.',
    );
  if (!Number.isInteger(slotBoneIndex) || slotBoneIndex < 0 || slotBoneIndex >= boneCount || vertexCount < 1)
    throw new Error('Invalid smoothing dimensions or slot bone.');
  let rows = decodeWeights(input.weights, vertexCount, boneCount, true);
  if (
    !Array.isArray(triangles) ||
    !triangles.length ||
    triangles.length % 3 ||
    Array.from(triangles).some((index) => !Number.isInteger(index) || index < 0 || index >= vertexCount)
  )
    throw new Error('Smoothing needs valid triangle indices.');
  const sets = Array.from({ length: vertexCount }, () => new Set<number>());
  for (let k = 0; k < triangles.length; k += 3) {
    const a = triangles[k]!,
      b = triangles[k + 1]!,
      c = triangles[k + 2]!;
    if (new Set([a, b, c]).size !== 3) throw new Error('Smoothing rejects repeated triangle vertices.');
    for (const [from, to] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      sets[from!]!.add(to!);
      sets[to!]!.add(from!);
    }
  }
  const neighbors = sets.map((set) => [...set].sort((a, b) => a - b));
  if (neighbors.some((row) => !row.length)) throw new Error('Smoothing rejects unused vertices.');
  const rigid: Influence[] = [{ boneIndex: slotBoneIndex, weight: 1 }];
  progress?.(0);
  let lastProgress = 0;
  for (let pass = 0; pass < iterations; pass++) {
    const next: Influence[][] = [];
    for (let vertex = 0; vertex < vertexCount; vertex++) {
      const own = rows[vertex]!,
        adjacent = neighbors[vertex]!;
      const blend = new Map<number, number>();
      for (const entry of own.length ? own : rigid) blend.set(entry.boneIndex, entry.weight * (1 - strength));
      for (const neighbor of adjacent) {
        const row = rows[neighbor]!;
        for (const entry of row.length ? row : rigid)
          blend.set(
            entry.boneIndex,
            (blend.get(entry.boneIndex) ?? 0) + (entry.weight * strength) / adjacent.length,
          );
      }
      next.push(
        normalizeInfluences(
          [...blend].map(([boneIndex, weight]) => ({ boneIndex, weight })),
          { maxInfluences },
        ),
      );
      if ((vertex + 1) % 128 === 0) {
        const fraction = (pass + (vertex + 1) / vertexCount) / iterations;
        if (fraction - lastProgress >= 0.01) {
          progress?.(fraction);
          lastProgress = fraction;
        }
      }
    }
    rows = next;
  }
  progress?.(1);
  return encodeWeights(rows);
}
