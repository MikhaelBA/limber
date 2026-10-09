import { autoWeights, type AutoWeightInput } from '@limber/mesh';

export interface AutoWeightRequest {
  id: number;
  input: AutoWeightInput;
}
export type AutoWeightMessage =
  | { id: number; kind: 'progress'; fraction: number }
  | { id: number; kind: 'result'; weights: number[]; durationMs: number }
  | { id: number; kind: 'error'; message: string };

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<AutoWeightRequest>) => void) | null;
  postMessage(message: AutoWeightMessage): void;
};
scope.onmessage = ({ data: { id, input } }) => {
  const start = performance.now();
  try {
    const weights = autoWeights(input, (fraction) => scope.postMessage({ id, kind: 'progress', fraction }));
    scope.postMessage({ id, kind: 'result', weights, durationMs: performance.now() - start });
  } catch (error) {
    scope.postMessage({ id, kind: 'error', message: (error as Error).message });
  }
};
