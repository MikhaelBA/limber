import type { Curve, NumberKeyframe } from '../types/animation';
import { solveBezier } from './bezier';

/**
 * Binary search: index of the LAST keyframe with time <= t (0 if t is before
 * the first keyframe). Keyframes must be sorted by time (DESIGN.md §3.3).
 */
export function findKeyframeIndex(keyframes: { time: number }[], t: number): number {
  let lo = 0;
  let hi = keyframes.length - 1;
  while (lo < hi) {
    // Round the midpoint UP so the loop converges on the last satisfying index.
    const mid = (lo + hi + 1) >> 1;
    if (keyframes[mid]!.time <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Interpolated value at `time` between `kf0` and `kf1` (null = hold kf0).
 * The curve belongs to kf0 (curve from THIS keyframe to the next — Spine
 * convention, DESIGN.md §3.3). Before the first keyframe the caller keeps the
 * setup-pose value.
 */
export function interpolateNumber(kf0: NumberKeyframe, kf1: NumberKeyframe | null, time: number): number {
  if (!kf1 || kf1.time <= kf0.time) return kf0.value; // Stepped tail / duplicate times.
  const span = kf1.time - kf0.time;
  const t = (time - kf0.time) / span;
  switch (kf0.curve.type) {
    case 'stepped':
      return kf0.value;
    case 'bezier':
      return kf0.value + (kf1.value - kf0.value) * solveBezier(kf0.curve, t);
    default:
      return kf0.value + (kf1.value - kf0.value) * t;
  }
}

/** Packed RGBA uint32 channel lerp (0xRRGGBBAA, DESIGN.md §3.1). Unsigned result. */
export function lerpColor(from: number, to: number, t: number): number {
  const ch = (v: number, shift: number): number => (v >>> shift) & 0xff;
  const l = (a: number, b: number): number => Math.round(a + (b - a) * t);
  const r = l(ch(from, 24), ch(to, 24));
  const g = l(ch(from, 16), ch(to, 16));
  const b = l(ch(from, 8), ch(to, 8));
  const a = l(ch(from, 0), ch(to, 0));
  return ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
}

export function defaultCurve(): Curve {
  return { type: 'linear' };
}
