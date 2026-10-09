import type { AutoWeightInput } from '@limber/mesh';
import { runWorkerJob, type JobWorker } from './workerJob';

export type MeshWorker = JobWorker<AutoWeightInput, number[]>;
export async function runAutoWeightJob(
  input: AutoWeightInput,
  options: {
    signal: AbortSignal;
    progress?: (fraction: number) => void;
    createWorker?: () => MeshWorker;
  },
): Promise<{ weights: number[]; durationMs: number }> {
  const result = await runWorkerJob(input, {
    ...options,
    createWorker:
      options.createWorker ??
      (() => new Worker(new URL('../workers/meshWorker.ts', import.meta.url), { type: 'module' })),
    validResult: (value): value is number[] => Array.isArray(value),
  });
  return { weights: result.result, durationMs: result.durationMs };
}
