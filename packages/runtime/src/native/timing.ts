import { SECONDARY_STEP_SECONDS } from '@limber/core';

export function canonicalRuntimeInteger(value: number): number {
  const integer = Math.round(value);
  return Math.abs(value - integer) <= 8 * Number.EPSILON * Math.max(1, Math.abs(value)) ? integer : value;
}
export function nativeDurationTicks(seconds: number, label: string): number {
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error(`${label} must be finite and nonnegative.`);
  const ticks = Math.ceil(canonicalRuntimeInteger(seconds / SECONDARY_STEP_SECONDS));
  if (!Number.isSafeInteger(ticks)) throw new Error(`${label} exceeds the safe fixed-step range.`);
  return ticks;
}
