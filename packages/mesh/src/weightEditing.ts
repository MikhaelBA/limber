import { normalizeInfluences, type Influence, type PruneOptions } from './weights';

/** Edit a group as one influence. Locked weights and unselected proportions stay exact. */
export function editInfluences(
  row: readonly Influence[],
  selected: ReadonlySet<number>,
  amount: number,
  locked: ReadonlySet<number> = new Set(),
  fallback = 0,
): Influence[] {
  if (!Number.isFinite(amount)) throw new Error('Weight must be finite.');
  const current = row.length ? row.map((item) => ({ ...item })) : [{ boneIndex: fallback, weight: 1 }];
  const fixed = current.filter((item) => locked.has(item.boneIndex));
  const targets = [...selected].filter((index) => !locked.has(index));
  if (!targets.length) return current;
  const others = current.filter((item) => !selected.has(item.boneIndex) && !locked.has(item.boneIndex));
  // A sole influence cannot be reduced: another influence must first be added.
  if (!others.length) return current;
  const available = Math.max(0, 1 - fixed.reduce((sum, item) => sum + item.weight, 0));
  const desired = Math.min(available, Math.max(0, amount));
  const targetTotal = current.reduce(
    (sum, item) => sum + (targets.includes(item.boneIndex) ? item.weight : 0),
    0,
  );
  const otherTotal = others.reduce((sum, item) => sum + item.weight, 0);
  if (otherTotal <= 0) return current;
  const result = [
    ...fixed,
    ...targets.map((boneIndex) => ({
      boneIndex,
      weight:
        desired *
        (targetTotal > 0
          ? (current.find((item) => item.boneIndex === boneIndex)?.weight ?? 0) / targetTotal
          : 1 / targets.length),
    })),
    ...others.map((item) => ({
      boneIndex: item.boneIndex,
      weight: ((available - desired) * item.weight) / otherTotal,
    })),
  ];
  return result.filter((item) => item.weight > 0).sort((a, b) => a.boneIndex - b.boneIndex);
}

/** Replace unlocked distribution, retaining locked values without renormalizing them. */
export function mergeLockedInfluences(
  original: readonly Influence[],
  proposed: readonly Influence[],
  locked: ReadonlySet<number>,
  fallback: number,
): Influence[] {
  const current = original.length ? original : [{ boneIndex: fallback, weight: 1 }];
  const fixed = current.filter((item) => locked.has(item.boneIndex));
  const available = Math.max(0, 1 - fixed.reduce((sum, item) => sum + item.weight, 0));
  let free = normalizeInfluences(proposed.filter((item) => !locked.has(item.boneIndex)));
  if (!free.length && available > 0)
    free = normalizeInfluences(current.filter((item) => !locked.has(item.boneIndex)));
  if (!free.length && available > 1e-8)
    throw new Error('No unlocked influence can receive the remaining weight.');
  return [...fixed, ...free.map((item) => ({ ...item, weight: item.weight * available }))]
    .filter((item) => item.weight > 0)
    .sort((a, b) => a.boneIndex - b.boneIndex);
}

export function pruneInfluences(
  row: readonly Influence[],
  options: PruneOptions,
  locked: ReadonlySet<number> = new Set(),
): Influence[] {
  // Validate even when all influences are locked.
  normalizeInfluences(row, options);
  const fixed = row.filter((item) => locked.has(item.boneIndex));
  const free = row.filter((item) => !locked.has(item.boneIndex));
  const max = options.maxInfluences ?? Infinity;
  const remaining = Math.max(0, max - fixed.length);
  if (!remaining && fixed.reduce((sum, item) => sum + item.weight, 0) < 1 - 1e-8)
    throw new Error(
      'Influence limit leaves no room for unlocked weights. Unlock a bone or increase the limit.',
    );
  const total = free.reduce((sum, item) => sum + item.weight, 0);
  const kept = free
    .filter((item) => item.weight >= (options.threshold ?? 0))
    .sort((a, b) => b.weight - a.weight || a.boneIndex - b.boneIndex)
    .slice(0, remaining);
  if (!kept.length && total > 0)
    kept.push([...free].sort((a, b) => b.weight - a.weight || a.boneIndex - b.boneIndex)[0]!);
  return mergeLockedInfluences(row, kept, locked, row[0]?.boneIndex ?? 0);
}

/** Solid center with a feathered outer annulus. Feather is a fraction of radius. */
export function brushFalloff(distance: number, radius: number, feather: number): number {
  if (
    ![distance, radius, feather].every(Number.isFinite) ||
    distance < 0 ||
    radius <= 0 ||
    feather < 0 ||
    feather > 1
  )
    throw new Error('Invalid brush size or feather.');
  if (distance > radius) return 0;
  if (feather === 0) return 1;
  const t = Math.max(0, Math.min(1, (radius - distance) / (radius * feather)));
  return t * t * (3 - 2 * t);
}

/** A stable triangle order; later bound bones draw over earlier bound bones. */
export function orderWeightedTriangles(
  triangles: readonly number[],
  rows: readonly (readonly Influence[])[],
  boneOrder: readonly number[],
): number[] {
  const rank = new Map(boneOrder.map((index, position) => [index, position]));
  const entries: { triangle: number[]; order: number; index: number }[] = [];
  for (let i = 0; i < triangles.length; i += 3) {
    const triangle = triangles.slice(i, i + 3),
      totals = new Map<number, number>();
    for (const vertex of triangle)
      for (const item of rows[vertex] ?? [])
        totals.set(item.boneIndex, (totals.get(item.boneIndex) ?? 0) + item.weight);
    const dominant = [...totals].sort(
      (a, b) => b[1] - a[1] || (rank.get(b[0]) ?? -1) - (rank.get(a[0]) ?? -1),
    )[0];
    entries.push({ triangle, order: dominant ? (rank.get(dominant[0]) ?? -1) : -1, index: i });
  }
  return entries.sort((a, b) => a.order - b.order || a.index - b.index).flatMap((item) => item.triangle);
}

/** Hull edges plus explicitly authored internal edges, never triangulation diagonals. */
export function weightNeighbors(
  vertexCount: number,
  hull: readonly number[],
  edges: readonly number[] = [],
): number[][] {
  const neighbors = Array.from({ length: vertexCount }, () => new Set<number>());
  const add = (a: number, b: number) => {
    if (![a, b].every((index) => Number.isInteger(index) && index >= 0 && index < vertexCount) || a === b)
      throw new Error('Invalid weight smoothing edge.');
    neighbors[a]!.add(b);
    neighbors[b]!.add(a);
  };
  if (edges.length % 2) throw new Error('Weight edges need index pairs.');
  for (let i = 0; i < hull.length; i++) add(hull[i]!, hull[(i + 1) % hull.length]!);
  for (let i = 0; i < edges.length; i += 2) add(edges[i]!, edges[i + 1]!);
  return neighbors.map((row) => [...row].sort((a, b) => a - b));
}
