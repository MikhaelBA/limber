export const SECONDARY_STEP_SECONDS = 1 / 120;
export const SECONDARY_MAX_STEPS = 12;
export const SECONDARY_MAX_DELTA_SECONDS = 0.1;
/**
 * Bounded fixed-step accumulator. Callers must sample animation/primary targets
 * once for EACH returned step. Fractional time is retained; excess stall time is
 * explicitly dropped. It does not advance any animation or secondary state itself.
 */
export class FixedStepClock {
  private fraction = 0;
  private ticks = 0;
  private discarded = 0;
  consume(deltaSeconds: number): number {
    this.discarded = 0;
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return 0;
    const accepted = Math.min(deltaSeconds, SECONDARY_MAX_DELTA_SECONDS);
    this.discarded = deltaSeconds - accepted;
    this.fraction += accepted;
    const steps = Math.min(SECONDARY_MAX_STEPS, Math.floor((this.fraction + 1e-12) / SECONDARY_STEP_SECONDS));
    this.fraction = Math.max(0, this.fraction - steps * SECONDARY_STEP_SECONDS);
    this.ticks += steps;
    return steps;
  }
  reset(): void {
    this.fraction = 0;
    this.ticks = 0;
    this.discarded = 0;
  }
  get remainder(): number {
    return this.fraction;
  }
  get stepCount(): number {
    return this.ticks;
  }
  get time(): number {
    return this.ticks * SECONDARY_STEP_SECONDS;
  }
  get lastDiscardedSeconds(): number {
    return this.discarded;
  }
}
