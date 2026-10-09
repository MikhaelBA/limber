import type { SmoothWeightInput } from '@limber/mesh';
import { runWorkerJob, type JobWorker } from './workerJob';

export function runSmoothWeightJob(
  input: SmoothWeightInput,
  options: {
    signal: AbortSignal;
    progress?: (fraction: number) => void;
    createWorker?: () => JobWorker<SmoothWeightInput, number[]>;
  },
) {
  return runWorkerJob(input, {
    ...options,
    createWorker:
      options.createWorker ??
      (() => new Worker(new URL('../workers/smoothWeightWorker.ts', import.meta.url), { type: 'module' })),
    validResult: (value): value is number[] => Array.isArray(value),
  });
}
