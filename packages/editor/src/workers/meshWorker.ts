import { autoWeights, type AutoWeightInput } from '@limber/mesh';

import type { WorkerMessage, WorkerRequest } from '../engine/workerJob';
export type AutoWeightRequest = WorkerRequest<AutoWeightInput>;
export type AutoWeightMessage = WorkerMessage<number[]>;

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<AutoWeightRequest>) => void) | null;
  postMessage(message: AutoWeightMessage): void;
};
scope.onmessage = ({ data: { id, input } }) => {
  const start = performance.now();
  try {
    const weights = autoWeights(input, (fraction) => scope.postMessage({ id, kind: 'progress', fraction }));
    scope.postMessage({ id, kind: 'result', result: weights, durationMs: performance.now() - start });
  } catch (error) {
    scope.postMessage({ id, kind: 'error', message: (error as Error).message });
  }
};
