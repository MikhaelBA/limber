import { smoothWeights, type SmoothWeightInput } from '@limber/mesh';
import type { WorkerMessage, WorkerRequest } from '../engine/workerJob';

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest<SmoothWeightInput>>) => void) | null;
  postMessage(message: WorkerMessage<number[]>): void;
};
scope.onmessage = ({ data: { id, input } }) => {
  const start = performance.now();
  try {
    const result = smoothWeights(input, (fraction) => scope.postMessage({ id, kind: 'progress', fraction }));
    scope.postMessage({ id, kind: 'result', result, durationMs: performance.now() - start });
  } catch (error) {
    scope.postMessage({ id, kind: 'error', message: (error as Error).message });
  }
};
