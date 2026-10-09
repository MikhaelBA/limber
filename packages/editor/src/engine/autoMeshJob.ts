import type { AutoMeshInput, AutoMeshGeometry } from '@limber/mesh';
import { runWorkerJob, type JobWorker } from './workerJob';

export function runAutoMeshJob(
  input: AutoMeshInput,
  options: {
    signal: AbortSignal;
    progress?: (fraction: number) => void;
    createWorker?: () => JobWorker<AutoMeshInput, AutoMeshGeometry>;
  },
) {
  return runWorkerJob(input, {
    ...options,
    createWorker:
      options.createWorker ??
      (() => new Worker(new URL('../workers/autoMeshWorker.ts', import.meta.url), { type: 'module' })),
    validResult: (value): value is AutoMeshGeometry =>
      !!value &&
      typeof value === 'object' &&
      ['vertices', 'uvs', 'triangles', 'hull'].every((key) =>
        Array.isArray((value as Record<string, unknown>)[key]),
      ),
  });
}
