import type { AutoWeightInput } from '@limber/mesh';
import type { AutoWeightMessage, AutoWeightRequest } from '../workers/meshWorker';

export interface MeshWorker {
  onmessage: ((event: MessageEvent<AutoWeightMessage>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: AutoWeightRequest): void;
  terminate(): void;
}
let nextJobId = 0;

/** Each job owns its worker; abort terminates computation, not only result delivery. */
export function runAutoWeightJob(
  input: AutoWeightInput,
  options: {
    signal: AbortSignal;
    progress?: (fraction: number) => void;
    createWorker?: () => MeshWorker;
  },
): Promise<{ weights: number[]; durationMs: number }> {
  return new Promise((resolve, reject) => {
    if (options.signal.aborted) {
      reject(new DOMException('Auto weights cancelled.', 'AbortError'));
      return;
    }
    let worker: MeshWorker;
    try {
      worker =
        options.createWorker?.() ??
        new Worker(new URL('../workers/meshWorker.ts', import.meta.url), { type: 'module' });
    } catch (error) {
      reject(error);
      return;
    }
    const id = ++nextJobId;
    let done = false;
    const finish = (error?: unknown, result?: { weights: number[]; durationMs: number }) => {
      if (done) return;
      done = true;
      options.signal.removeEventListener('abort', abort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
      if (error) reject(error);
      else resolve(result!);
    };
    const abort = () => finish(new DOMException('Auto weights cancelled.', 'AbortError'));
    options.signal.addEventListener('abort', abort, { once: true });
    if (options.signal.aborted) {
      abort();
      return;
    }
    worker.onmessage = ({ data }) => {
      if (done || !data || data.id !== id) return;
      if (data.kind === 'progress') {
        if (!Number.isFinite(data.fraction) || data.fraction < 0 || data.fraction > 1) {
          finish(new Error('Invalid auto-weight progress.'));
          return;
        }
        try { options.progress?.(data.fraction); } catch (error) { finish(error); }
      } else if (data.kind === 'result') {
        if (!Array.isArray(data.weights) || !Number.isFinite(data.durationMs) || data.durationMs < 0)
          finish(new Error('Invalid auto-weight result.'));
        else finish(undefined, { weights: data.weights, durationMs: data.durationMs });
      } else if (data.kind === 'error') finish(new Error(data.message));
    };
    worker.onerror = (event) => finish(new Error(event.message));
    try {
      worker.postMessage({ id, input });
    } catch (error) {
      finish(error);
    }
  });
}
