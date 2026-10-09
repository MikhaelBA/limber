/** Affine matrices use [a,b,c,d,tx,ty], with column vectors. */
export function validateInvertibleAffine(matrix: ArrayLike<number>): void {
  if (matrix.length !== 6 || Array.from(matrix).some((value) => !Number.isFinite(value)))
    throw new Error('Binding needs six finite matrix values.');
  const scale = Math.max(
    Math.abs(matrix[0]!),
    Math.abs(matrix[1]!),
    Math.abs(matrix[2]!),
    Math.abs(matrix[3]!),
  );
  const det = matrix[0]! * matrix[3]! - matrix[1]! * matrix[2]!;
  if (!scale || !Number.isFinite(det) || Math.abs(det) <= scale * scale * 1e-12)
    throw new Error('Cannot bind or edit through a singular transform.');
}

/** inverse(parent) * child; rejects singular/overflowed results before publication. */
export function relativeAffine(parent: ArrayLike<number>, child: ArrayLike<number>): number[] {
  validateInvertibleAffine(parent);
  validateInvertibleAffine(child);
  const [a, b, c, d, tx, ty] = Array.from(parent) as [number, number, number, number, number, number];
  const det = a * d - b * c,
    dx = child[4]! - tx,
    dy = child[5]! - ty;
  const result = [
    (d * child[0]! - c * child[1]!) / det,
    (a * child[1]! - b * child[0]!) / det,
    (d * child[2]! - c * child[3]!) / det,
    (a * child[3]! - b * child[2]!) / det,
    (d * dx - c * dy) / det,
    (a * dy - b * dx) / det,
  ];
  validateInvertibleAffine(result);
  return result;
}
