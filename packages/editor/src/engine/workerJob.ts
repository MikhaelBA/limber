export interface WorkerRequest<T> {
  id: number;
  input: T;
}
export type WorkerMessage<T> =
  | { id: number; kind: 'progress'; fraction: number }
  | { id: number; kind: 'result'; result: T; durationMs: number }
  | { id: number; kind: 'error'; message: string };
export interface JobWorker<TInput, TResult> {
  onmessage: ((event: MessageEvent<WorkerMessage<TResult>>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: WorkerRequest<TInput>): void;
  terminate(): void;
}
let nextJobId = 0;

/** A request owns its worker and abort removes computation as well as delivery. */
export function runWorkerJob<TInput, TResult>(
  input: TInput,
  options: {
    signal: AbortSignal;
    progress?: (fraction: number) => void;
    createWorker: () => JobWorker<TInput, TResult>;
    validResult: (value: unknown) => value is TResult;
  },
): Promise<{ result: TResult; durationMs: number }> {
  return new Promise((resolve, reject) => {
    if (options.signal.aborted) {
      reject(new DOMException('Worker job cancelled.', 'AbortError'));
      return;
    }
    let worker: JobWorker<TInput, TResult>;
    try {
      worker = options.createWorker();
    } catch (error) {
      reject(error);
      return;
    }
    const id = ++nextJobId;
    let done = false;
    const finish = (error?: unknown, result?: { result: TResult; durationMs: number }) => {
      if (done) return;
      done = true;
      options.signal.removeEventListener('abort', abort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
      if (error) reject(error);
      else resolve(result!);
    };
    const abort = () => finish(new DOMException('Worker job cancelled.', 'AbortError'));
    options.signal.addEventListener('abort', abort, { once: true });
    if (options.signal.aborted) {
      abort();
      return;
    }
    worker.onmessage = ({ data }) => {
      if (done || !data || data.id !== id) return;
      if (data.kind === 'progress') {
        if (!Number.isFinite(data.fraction) || data.fraction < 0 || data.fraction > 1) {
          finish(new Error('Invalid worker progress.'));
          return;
        }
        try {
          options.progress?.(data.fraction);
        } catch (error) {
          finish(error);
        }
      } else if (data.kind === 'result') {
        if (!options.validResult(data.result) || !Number.isFinite(data.durationMs) || data.durationMs < 0)
          finish(new Error('Invalid worker result.'));
        else finish(undefined, { result: data.result, durationMs: data.durationMs });
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
