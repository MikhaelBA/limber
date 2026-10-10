import { runtimeFail } from './model';

export interface RuntimeFrameSample {
  updateMs: number;
  renderSubmitMs: number;
  acceptedTicks: number;
  drawCalls: number | null;
}
export interface RuntimeTimingSummary {
  min: number;
  median: number;
  p95: number;
  max: number;
}
export interface RuntimeProfileSummary {
  samples: number;
  totalRecorded: number;
  acceptedTicks: number;
  drawCallSamples: number;
  updateMs: RuntimeTimingSummary | null;
  renderSubmitMs: RuntimeTimingSummary | null;
  drawCalls: RuntimeTimingSummary | null;
}
const invalid = (): never =>
  runtimeFail(
    'INVALID_PROFILE',
    'Profiler requires bounded finite measured frame samples.',
    null,
    'Record nonnegative CPU timings/counts or mark draw calls unavailable.',
  );
function summary(values: number[]): RuntimeTimingSummary | null {
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  const rank = (fraction: number) => values[Math.max(0, Math.ceil(values.length * fraction) - 1)]!;
  return { min: values[0]!, median: rank(0.5), p95: rank(0.95), max: values.at(-1)! };
}
/** Fixed memory, nearest-rank percentiles over retained frames; measurement belongs to the host. */
export class RuntimeFrameProfiler {
  private readonly values: Float64Array;
  private cursor = 0;
  private size = 0;
  private total = 0;
  constructor(readonly capacity = 120) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 600) invalid();
    this.values = new Float64Array(capacity * 4);
  }
  record(sample: RuntimeFrameSample): void {
    if (
      !sample ||
      typeof sample !== 'object' ||
      Array.isArray(sample) ||
      Object.keys(sample).length !== 4 ||
      Object.keys(sample).some(
        (key) => !['updateMs', 'renderSubmitMs', 'acceptedTicks', 'drawCalls'].includes(key),
      )
    )
      invalid();
    for (const key of ['updateMs', 'renderSubmitMs', 'acceptedTicks', 'drawCalls'] as const) {
      const value = sample[key];
      if (key === 'drawCalls' && value === null) continue;
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value < 0 ||
        value > Number.MAX_SAFE_INTEGER ||
        ((key === 'acceptedTicks' || key === 'drawCalls') && !Number.isSafeInteger(value))
      )
        invalid();
      if (key === 'acceptedTicks' && typeof value === 'number' && value > 12) invalid();
    }
    if (this.total === Number.MAX_SAFE_INTEGER) invalid();
    const offset = this.cursor * 4;
    this.values[offset] = sample.updateMs;
    this.values[offset + 1] = sample.renderSubmitMs;
    this.values[offset + 2] = sample.acceptedTicks;
    this.values[offset + 3] = sample.drawCalls ?? NaN;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.size = Math.min(this.capacity, this.size + 1);
    this.total++;
  }
  clear(): void {
    this.cursor = this.size = this.total = 0;
    this.values.fill(0);
  }
  inspect(): RuntimeProfileSummary {
    const update: number[] = [],
      render: number[] = [],
      draws: number[] = [];
    let acceptedTicks = 0;
    for (let i = 0; i < this.size; i++) {
      const offset = i * 4;
      update.push(this.values[offset]!);
      render.push(this.values[offset + 1]!);
      acceptedTicks += this.values[offset + 2]!;
      if (!Number.isNaN(this.values[offset + 3]!)) draws.push(this.values[offset + 3]!);
    }
    return {
      samples: this.size,
      totalRecorded: this.total,
      acceptedTicks,
      drawCallSamples: draws.length,
      updateMs: summary(update),
      renderSubmitMs: summary(render),
      drawCalls: summary(draws),
    };
  }
}
