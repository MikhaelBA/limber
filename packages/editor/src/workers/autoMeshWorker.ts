import { autoMesh, type AutoMeshInput, type AutoMeshGeometry } from '@limber/mesh';
import type { WorkerMessage, WorkerRequest } from '../engine/workerJob';

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest<AutoMeshInput>>) => void) | null;
  postMessage(message: WorkerMessage<AutoMeshGeometry>): void;
};
scope.onmessage = ({ data: { id, input } }) => {
  const start = performance.now();
  try {
    const result = autoMesh(input, (fraction) => scope.postMessage({ id, kind: 'progress', fraction }));
    scope.postMessage({ id, kind: 'result', result, durationMs: performance.now() - start });
  } catch (error) {
    scope.postMessage({ id, kind: 'error', message: (error as Error).message });
  }
};
