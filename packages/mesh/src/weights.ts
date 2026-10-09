/** Portable indexed influence data. Empty rows retain the slot-bone rigid fallback. */
export interface Influence {
  boneIndex: number;
  weight: number;
}
export interface PruneOptions {
  maxInfluences?: number;
  threshold?: number;
}

function readWeights(
  weights: readonly number[],
  vertexCount: number,
  boneCount: number,
  normalized: boolean,
  rows?: Influence[][],
  allowedBones?: ReadonlySet<number>,
): void {
  if (!Number.isInteger(vertexCount) || vertexCount < 0 || !Number.isInteger(boneCount) || boneCount < 0)
    throw new Error('Invalid weight dimensions.');
  const seen = normalized ? new Uint32Array(boneCount) : null;
  let cursor = 0;
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const count = weights[cursor++];
    if (!Number.isInteger(count) || count! < 0 || cursor + count! * 2 > weights.length)
      throw new Error('Malformed weights: missing or truncated vertex entry.');
    const row: Influence[] | undefined = rows ? [] : undefined;
    let sum = 0;
    for (let i = 0; i < count!; i++) {
      const boneIndex = weights[cursor++]!,
        weight = weights[cursor++]!;
      if (!Number.isInteger(boneIndex) || boneIndex < 0 || boneIndex >= boneCount)
        throw new Error('Weight bone index out of range.');
      if (!Number.isFinite(weight) || weight < 0) throw new Error('Weights must be finite and nonnegative.');
      if (seen) {
        if (seen[boneIndex] === vertex + 1) throw new Error('Duplicate bone influence in vertex weights.');
        seen[boneIndex] = vertex + 1;
      }
      if (allowedBones && !allowedBones.has(boneIndex))
        throw new Error('Weight bone is not bound to this mesh.');
      sum += weight;
      row?.push({ boneIndex, weight });
    }
    if (normalized && count! > 0 && (!Number.isFinite(sum) || Math.abs(sum - 1) > 1e-5))
      throw new Error('Vertex weights must sum to one.');
    if (rows) rows.push(row!);
  }
  if (cursor !== weights.length) throw new Error('Malformed weights: unexpected trailing vertex data.');
}

export function decodeWeights(
  weights: readonly number[],
  vertexCount: number,
  boneCount: number,
  normalized = false,
): Influence[][] {
  const rows: Influence[][] = [];
  readWeights(weights, vertexCount, boneCount, normalized, rows);
  return rows;
}
export function encodeWeights(rows: readonly (readonly Influence[])[]): number[] {
  const out: number[] = [];
  for (const row of rows) {
    out.push(row.length);
    for (const item of row) out.push(item.boneIndex, item.weight);
  }
  return out;
}
export function validateWeights(
  weights: readonly number[] | undefined,
  vertexCount: number,
  boneCount: number,
  allowedBones?: ReadonlySet<number>,
): void {
  if (weights === undefined) return;
  if (!Array.isArray(weights)) throw new Error('Weights must be an array.');
  readWeights(weights, vertexCount, boneCount, true, undefined, allowedBones);
}

/** Stable ties use bone index; scale first so finite large weights cannot overflow their sum. */
export function normalizeInfluences(row: readonly Influence[], options: PruneOptions = {}): Influence[] {
  const max = options.maxInfluences ?? Infinity,
    threshold = options.threshold ?? 0;
  if (
    (max !== Infinity && (!Number.isInteger(max) || max < 1)) ||
    !Number.isFinite(threshold) ||
    threshold < 0 ||
    threshold > 1
  )
    throw new Error('Invalid influence limit or threshold.');
  for (const item of row)
    if (
      !Number.isInteger(item.boneIndex) ||
      item.boneIndex < 0 ||
      !Number.isFinite(item.weight) ||
      item.weight < 0
    )
      throw new Error('Invalid bone influence.');
  const largest = row.reduce((value, item) => Math.max(value, item.weight), 0);
  if (largest === 0) return [];
  const merged = new Map<number, number>();
  for (const item of [...row].sort((a, b) => a.boneIndex - b.boneIndex || a.weight - b.weight)) {
    merged.set(item.boneIndex, (merged.get(item.boneIndex) ?? 0) + item.weight / largest);
  }
  const ranked = [...merged]
    .filter(([, weight]) => weight > 0)
    .map(([boneIndex, weight]) => ({ boneIndex, weight }))
    .sort((a, b) => b.weight - a.weight || a.boneIndex - b.boneIndex);
  const total = ranked.reduce((sum, item) => sum + item.weight, 0);
  let kept = ranked.filter((item) => item.weight / total >= threshold).slice(0, max);
  if (!kept.length) kept = ranked.slice(0, 1);
  const sum = kept.reduce((value, item) => value + item.weight, 0);
  return kept
    .map((item) => ({ boneIndex: item.boneIndex, weight: item.weight / sum }))
    .sort((a, b) => a.boneIndex - b.boneIndex);
}
export function normalizeWeights(
  weights: readonly number[],
  vertexCount: number,
  boneCount: number,
  options: PruneOptions = {},
): number[] {
  return encodeWeights(
    decodeWeights(weights, vertexCount, boneCount).map((row) => normalizeInfluences(row, options)),
  );
}

/** Set one influence while retaining the relative distribution of all other bones. */
export function paintInfluence(
  row: readonly Influence[],
  boneIndex: number,
  amount: number,
  fallbackBone: number,
): Influence[] {
  if (
    ![boneIndex, fallbackBone].every((index) => Number.isInteger(index) && index >= 0) ||
    !Number.isFinite(amount)
  )
    throw new Error('Invalid weight brush input.');
  const weight = Math.min(1, Math.max(0, amount));
  const existing = normalizeInfluences(row.length ? row : [{ boneIndex: fallbackBone, weight: 1 }]);
  let others = existing.filter((item) => item.boneIndex !== boneIndex);
  if (!others.length && boneIndex !== fallbackBone) others = [{ boneIndex: fallbackBone, weight: 1 }];
  if (!others.length || weight === 1) return [{ boneIndex, weight: 1 }];
  const total = others.reduce((sum, item) => sum + item.weight, 0);
  return normalizeInfluences([
    ...others.map((item) => ({ boneIndex: item.boneIndex, weight: (item.weight / total) * (1 - weight) })),
    { boneIndex, weight },
  ]);
}
