import { describe, expect, it, vi } from 'vitest';
import { runAutoWeightJob, type MeshWorker } from '../src/engine/autoWeightJob';
import type { AutoWeightMessage, AutoWeightRequest } from '../src/workers/meshWorker';

function fixture() {
  let request: AutoWeightRequest;
  const worker: MeshWorker = {
    onmessage: null,
    onerror: null,
    postMessage: vi.fn((value) => {
      request = value;
    }),
    terminate: vi.fn(),
  };
  const controller = new AbortController(),
    progress = vi.fn();
  const input = {
    vertices: [0, 0],
    bones: [{ boneIndex: 0, x0: 0, y0: 0, x1: 10, y1: 0 }],
    maxInfluences: 1,
  };
  const job = runAutoWeightJob(input, { signal: controller.signal, progress, createWorker: () => worker });
  const emit = (message: Omit<AutoWeightMessage, 'id'>) =>
    worker.onmessage?.({ data: { id: request.id, ...message } } as MessageEvent<AutoWeightMessage>);
  return {
    worker,
    controller,
    progress,
    job,
    emit,
    get request() {
      return request;
    },
  };
}
describe('isolated auto-weight worker lifecycle', () => {
  it('routes progress and matching results, ignores foreign IDs and cleans up once', async () => {
    const f = fixture();
    f.worker.onmessage?.(
      new MessageEvent('message', {
        data: { id: f.request.id + 1, kind: 'result', result: [], durationMs: 1 },
      }),
    );
    f.emit({ kind: 'progress', fraction: 0.5 } as AutoWeightMessage);
    expect(f.progress).toHaveBeenCalledWith(0.5);
    f.emit({ kind: 'result', result: [1, 0, 1], durationMs: 12 } as AutoWeightMessage);
    await expect(f.job).resolves.toEqual({ weights: [1, 0, 1], durationMs: 12 });
    f.controller.abort();
    expect(f.worker.terminate).toHaveBeenCalledTimes(1);
    expect(f.worker.onmessage).toBeNull();
    expect(f.worker.onerror).toBeNull();
  });
  it('hard-terminates on abort and does not start an already cancelled job', async () => {
    const f = fixture();
    f.controller.abort();
    await expect(f.job).rejects.toMatchObject({ name: 'AbortError' });
    expect(f.worker.terminate).toHaveBeenCalledTimes(1);
    const createWorker = vi.fn();
    await expect(
      runAutoWeightJob(f.request.input, { signal: f.controller.signal, createWorker }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(createWorker).not.toHaveBeenCalled();
  });
  it('rejects worker errors and malformed progress/results with cleanup', async () => {
    for (const message of [
      { kind: 'error', message: 'bad geometry' },
      { kind: 'progress', fraction: NaN },
      { kind: 'result', result: [], durationMs: -1 },
    ]) {
      const f = fixture();
      f.emit(message as AutoWeightMessage);
      await expect(f.job).rejects.toThrow();
      expect(f.worker.terminate).toHaveBeenCalledTimes(1);
    }
    const f = fixture();
    f.worker.onerror?.({ message: 'module unavailable' } as ErrorEvent);
    await expect(f.job).rejects.toThrow('module unavailable');
    expect(f.worker.terminate).toHaveBeenCalledTimes(1);
  });
});
