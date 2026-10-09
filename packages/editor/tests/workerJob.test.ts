import { describe, expect, it, vi } from 'vitest';
import { runWorkerJob, type JobWorker, type WorkerRequest } from '../src/engine/workerJob';

function worker() {
  let request: WorkerRequest<string>;
  const instance: JobWorker<string, number[]> = {
    onmessage: null,
    onerror: null,
    postMessage: vi.fn((message) => {
      request = message;
    }),
    terminate: vi.fn(),
  };
  return {
    instance,
    get id() {
      return request.id;
    },
  };
}
const validResult = (value: unknown): value is number[] => Array.isArray(value);
describe('shared worker failure cleanup', () => {
  it('terminates an abort during construction without posting a request', async () => {
    const f = worker(),
      controller = new AbortController();
    await expect(
      runWorkerJob('input', {
        signal: controller.signal,
        validResult,
        createWorker: () => {
          controller.abort();
          return f.instance;
        },
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(f.instance.postMessage).not.toHaveBeenCalled();
    expect(f.instance.terminate).toHaveBeenCalledTimes(1);
  });
  it('rejects startup and posting errors and cleans any created worker', async () => {
    const controller = new AbortController(),
      f = worker();
    await expect(
      runWorkerJob('input', {
        signal: controller.signal,
        validResult,
        createWorker: () => {
          throw new Error('load failed');
        },
      }),
    ).rejects.toThrow('load failed');
    f.instance.postMessage = vi.fn(() => {
      throw new Error('clone failed');
    });
    await expect(
      runWorkerJob('input', { signal: controller.signal, validResult, createWorker: () => f.instance }),
    ).rejects.toThrow('clone failed');
    expect(f.instance.terminate).toHaveBeenCalledTimes(1);
  });
  it('rejects throwing progress callbacks without leaving a pending job', async () => {
    const f = worker(),
      controller = new AbortController();
    const job = runWorkerJob('input', {
      signal: controller.signal,
      validResult,
      createWorker: () => f.instance,
      progress: () => {
        throw new Error('consumer failed');
      },
    });
    f.instance.onmessage?.(
      new MessageEvent('message', { data: { id: f.id, kind: 'progress', fraction: 0.5 } }),
    );
    await expect(job).rejects.toThrow('consumer failed');
    expect(f.instance.terminate).toHaveBeenCalledTimes(1);
  });
});
