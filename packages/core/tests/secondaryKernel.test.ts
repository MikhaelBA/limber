import { describe, expect, it } from 'vitest';
import { advanceDampedSpring, FixedStepClock, SECONDARY_STEP_SECONDS } from '../src/index';
describe('portable constant-target damped spring', () => {
  it('matches critical and undamped analytical goldens', () => {
    const critical = { value: 1, velocity: 0 };
    advanceDampedSpring(critical, 0, 1 / Math.PI, 1, 0.1);
    expect(critical.value).toBeCloseTo(0.9824769036935781, 14);
    expect(critical.velocity).toBeCloseTo(-0.3274923012311928, 14);
    const undamped = { value: 1, velocity: 0 };
    advanceDampedSpring(undamped, 0, 1 / (2 * Math.PI), 0, 0.1);
    expect(undamped.value).toBeCloseTo(Math.cos(0.1), 14);
    expect(undamped.velocity).toBeCloseTo(-Math.sin(0.1), 14);
  });
  it('matches independently assembled overdamped exponential-root goldens', () => {
    const state = { value: 0.3, velocity: -0.4 },
      omega = 2 * Math.PI,
      alpha = 2 * omega,
      r1 = -alpha + Math.sqrt(alpha * alpha - omega * omega),
      r2 = -alpha - Math.sqrt(alpha * alpha - omega * omega),
      error = 0.3 - 2;
    const c1 = (state.velocity - r2 * error) / (r1 - r2),
      c2 = error - c1;
    advanceDampedSpring(state, 2, 1, 2, 0.1);
    expect(state.value).toBeCloseTo(2 + c1 * Math.exp(r1 * 0.1) + c2 * Math.exp(r2 * 0.1), 13);
    expect(state.velocity).toBeCloseTo(r1 * c1 * Math.exp(r1 * 0.1) + r2 * c2 * Math.exp(r2 * 0.1), 13);
  });
  it('agrees with independent fine-step RK4 integration of the differential equation', () => {
    for (const damping of [0, 0.3, 0.7, 1, 1.4, 2]) {
      const state = { value: 0.3, velocity: -0.4 },
        frequency = 4,
        target = 2,
        w = 2 * Math.PI * frequency;
      let x = 0.3,
        v = -0.4;
      const h = 0.00001,
        acc = (x: number, v: number) => -2 * damping * w * v - w * w * (x - target);
      for (let n = 0; n < 10000; n++) {
        const a1 = acc(x, v),
          vx2 = v + (a1 * h) / 2,
          a2 = acc(x + (v * h) / 2, vx2),
          vx3 = v + (a2 * h) / 2,
          a3 = acc(x + (vx2 * h) / 2, vx3),
          vx4 = v + a3 * h,
          a4 = acc(x + vx3 * h, vx4);
        x += (h * (v + 2 * vx2 + 2 * vx3 + vx4)) / 6;
        v += (h * (a1 + 2 * a2 + 2 * a3 + a4)) / 6;
      }
      advanceDampedSpring(state, target, frequency, damping, 0.1);
      expect(state.value).toBeCloseTo(x, 10);
      expect(state.velocity).toBeCloseTo(v, 10);
    }
  });
  it('has constant-target subdivision parity across the critical boundary and parameter extremes', () => {
    for (const damping of [0, 0.3, 0.7, 0.99999999, 1, 1.00000001, 1.7, 2])
      for (const frequency of [0.1, 4, 20]) {
        const direct = { value: 0.3, velocity: -0.4 },
          split = { ...direct };
        advanceDampedSpring(direct, 2, frequency, damping, 0.1);
        for (let n = 0; n < 12; n++)
          advanceDampedSpring(split, 2, frequency, damping, SECONDARY_STEP_SECONDS);
        expect(Math.abs(direct.value - split.value)).toBeLessThan(1e-12);
        expect(Math.abs(direct.velocity - split.velocity)).toBeLessThan(1e-11);
      }
  });
  it('conserves undamped energy and settles positively damped presets', () => {
    const state = { value: 1, velocity: 2 },
      frequency = 3,
      w = 2 * Math.PI * frequency,
      energy = state.velocity ** 2 + w * w * state.value ** 2;
    for (let n = 0; n < 1200; n++) advanceDampedSpring(state, 0, frequency, 0, SECONDARY_STEP_SECONDS);
    expect(Math.abs(state.velocity ** 2 + w * w * state.value ** 2 - energy)).toBeLessThan(1e-9);
    for (const [f, z] of [
      [2, 0.7],
      [3, 0.3],
      [6, 1],
    ]) {
      const s = { value: 0, velocity: 0 };
      for (let n = 0; n < 600; n++) advanceDampedSpring(s, 1, f!, z!, SECONDARY_STEP_SECONDS);
      expect(Math.abs(s.value - 1)).toBeLessThan(1e-10);
      expect(Math.abs(s.velocity)).toBeLessThan(1e-9);
    }
  });
  it('holds equilibrium and zero steps exactly without allocating/replacing state', () => {
    const state = { value: 3, velocity: 0 };
    advanceDampedSpring(state, 3, 4, 0.7, 0.1);
    expect(state).toEqual({ value: 3, velocity: 0 });
    state.velocity = 2;
    advanceDampedSpring(state, 3, 4, 0.7, 0);
    expect(state).toEqual({ value: 3, velocity: 2 });
  });
  it('rejects nonfinite/range/overflow inputs before mutating reusable state', () => {
    for (const [target, frequency, damping, dt] of [
      [NaN, 4, 0.7, 0.1],
      [0, Infinity, 0.7, 0.1],
      [0, 0, 0.7, 0.1],
      [0, 21, 0.7, 0.1],
      [0, 4, -0.1, 0.1],
      [0, 4, 3, 0.1],
      [0, 4, 0.7, -1],
      [0, 4, 0.7, 0.11],
      [0, 4, 0.7, Infinity],
    ]) {
      const state = { value: 1, velocity: 2 };
      expect(() => advanceDampedSpring(state, target!, frequency!, damping!, dt!)).toThrow(RangeError);
      expect(state).toEqual({ value: 1, velocity: 2 });
    }
    const large = { value: 1e308, velocity: 0 };
    expect(() => advanceDampedSpring(large, -1e308, 20, 2, 0.1)).toThrow(/output/);
    expect(large).toEqual({ value: 1e308, velocity: 0 });
  });
});
describe('bounded 120Hz accumulator', () => {
  it('returns equal step counts for equivalent display delta subdivisions', () => {
    for (const frames of [10, 60, 120, 144, 240, 1000]) {
      const clock = new FixedStepClock();
      let steps = 0;
      for (let n = 0; n < frames; n++) steps += clock.consume(1 / frames);
      expect(steps).toBe(120);
      expect(clock.time).toBe(1);
      expect(clock.remainder).toBeLessThan(1e-12);
    }
  });
  it('retains fractional time and limits a stalled call to twelve steps with explicit dropped seconds', () => {
    const clock = new FixedStepClock();
    expect(clock.consume(0.003)).toBe(0);
    expect(clock.remainder).toBe(0.003);
    expect(clock.consume(10)).toBe(12);
    expect(clock.lastDiscardedSeconds).toBe(9.9);
    expect(clock.remainder).toBeCloseTo(0.003, 14);
    expect(clock.consume(1 / 120 - 0.003)).toBe(1);
    expect(clock.stepCount).toBe(13);
    expect(clock.lastDiscardedSeconds).toBe(0);
  });
  it('ignores invalid/zero/negative deltas and resets clock/remainder/drop diagnostics', () => {
    const clock = new FixedStepClock();
    clock.consume(0.004);
    for (const delta of [0, -1, NaN, Infinity, -Infinity]) {
      expect(clock.consume(delta)).toBe(0);
      expect(clock.remainder).toBe(0.004);
      expect(clock.lastDiscardedSeconds).toBe(0);
    }
    clock.consume(2);
    clock.reset();
    expect(clock.time).toBe(0);
    expect(clock.stepCount).toBe(0);
    expect(clock.remainder).toBe(0);
    expect(clock.lastDiscardedSeconds).toBe(0);
  });
  it('avoids drift over ten thousand nonintegral display frames', () => {
    const clock = new FixedStepClock();
    for (let n = 0; n < 10000; n++) clock.consume(1 / 144);
    expect(clock.stepCount).toBe(8333);
    expect(clock.remainder).toBeCloseTo(10000 / 144 - 8333 / 120, 11);
  });
});
