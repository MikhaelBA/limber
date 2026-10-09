/** Degree-two trigonometric roots via tan(angle/2), using two bounded charts.
 * Shared synchronous scratch storage keeps the solver allocation-free. */
const coefficients = new Float64Array(25);
const roots = new Float64Array(25);
const counts = new Uint8Array(5);
export const trigAngles = new Float64Array(10);
function evaluate(level: number, degree: number, x: number): number {
  const offset = level * 5;
  let value = coefficients[offset + degree]!;
  for (let i = degree - 1; i >= 0; i--) value = value * x + coefficients[offset + i]!;
  return value;
}
function append(level: number, value: number): void {
  const count = counts[level]!;
  if (count && Math.abs(roots[level * 5 + count - 1]! - value) < 1e-10) return;
  if (count < 4) {
    roots[level * 5 + count] = value;
    counts[level] = count + 1;
  }
}
function isolate(level: number, degree: number): void {
  const offset = level * 5;
  counts[level] = 0;
  let magnitude = 0;
  for (let i = 0; i <= degree; i++) magnitude = Math.max(magnitude, Math.abs(coefficients[offset + i]!));
  if (magnitude === 0) {
    append(level, 0);
    return;
  }
  for (let i = 0; i <= degree; i++) coefficients[offset + i] = coefficients[offset + i]! / magnitude;
  while (degree > 0 && Math.abs(coefficients[offset + degree]!) < 1e-15) degree--;
  if (degree === 0) return;
  if (degree === 1) {
    const value = -coefficients[offset]! / coefficients[offset + 1]!;
    if (value >= -1 && value <= 1) append(level, value);
    return;
  }
  for (let i = 1; i <= degree; i++) coefficients[(level + 1) * 5 + i - 1] = i * coefficients[offset + i]!;
  isolate(level + 1, degree - 1);
  const count = counts[level + 1]!;
  let left = -1,
    fl = evaluate(level, degree, left);
  if (Math.abs(fl) < 1e-12) append(level, left);
  for (let i = 0; i <= count; i++) {
    const right = i === count ? 1 : roots[(level + 1) * 5 + i]!;
    const fr = evaluate(level, degree, right);
    if (fl * fr < 0 && Math.abs(fl) >= 1e-12 && Math.abs(fr) >= 1e-12) {
      let lo = left,
        hi = right,
        flo = fl;
      for (let step = 0; step < 44; step++) {
        const mid = (lo + hi) * 0.5,
          fm = evaluate(level, degree, mid);
        if (flo < 0 === fm < 0) {
          lo = mid;
          flo = fm;
        } else hi = mid;
      }
      append(level, (lo + hi) * 0.5);
    }
    if (Math.abs(fr) < 1e-12) append(level, right);
    left = right;
    fl = fr;
  }
}
/** C + A cos(t) + B sin(t) + D cos(2t) + E sin(2t) = 0. */
export function trigRoots(c: number, a: number, b: number, d: number, e: number): number {
  let count = 0;
  for (let chart = 0; chart < 2; chart++) {
    const sign = chart === 0 ? 1 : -1;
    coefficients[0] = c + sign * a + d;
    coefficients[1] = 2 * sign * b + 4 * e;
    coefficients[2] = 2 * c - 6 * d;
    coefficients[3] = 2 * sign * b - 4 * e;
    coefficients[4] = c - sign * a + d;
    isolate(0, 4);
    for (let i = 0; i < counts[0]!; i++) trigAngles[count++] = 2 * Math.atan(roots[i]!) + chart * Math.PI;
  }
  return count;
}
