import { AtlasError } from '@limber/atlas';
import { runtimeTextureRequirements } from '@limber/runtime';
import {
  validAtlasWorkerResult,
  type AtlasJobWorker,
  type AtlasWorkerInput,
  type AtlasWorkerResult,
  type AtlasWorkerMessage,
} from './atlasProtocol';

let nextAtlasJob = 0;
/** One owned worker per export: cancellation stops synchronous WASM/packing work too. */
export function buildAtlasInWorker(
  input: AtlasWorkerInput,
  options: {
    createWorker: () => AtlasJobWorker;
    signal?: AbortSignal;
    progress?: (fraction: number, stage: Extract<AtlasWorkerMessage, { kind: 'progress' }>['stage']) => void;
  },
): Promise<AtlasWorkerResult> {
  return new Promise((resolve, reject) => {
    const cancelled = () => new DOMException('Atlas preparation cancelled.', 'AbortError');
    if (options.signal?.aborted) {
      reject(cancelled());
      return;
    }
    const sourceIds = input.project
      ? runtimeTextureRequirements({
          artboards: input.project.artboards,
          components: input.project.components ?? [],
        }).map((r) => r.id)
      : input.images.map((image) => image.id);
    const ids = new Set(sourceIds);
    const sourceCount = sourceIds.length;
    const needsRuntime = input.project !== undefined;
    const projectId = input.project?.projectId;
    let worker: AtlasJobWorker;
    try {
      worker = options.createWorker();
    } catch (error) {
      reject(error);
      return;
    }
    const id = ++nextAtlasJob;
    let done = false,
      fraction = 0;
    const finish = (error?: unknown, result?: AtlasWorkerResult) => {
      if (done) return;
      done = true;
      options.signal?.removeEventListener('abort', abort);
      worker.onmessage = worker.onerror = worker.onmessageerror = null;
      worker.terminate();
      if (error !== undefined) reject(error);
      else resolve(result!);
    };
    const abort = () => finish(cancelled());
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) {
      abort();
      return;
    }
    worker.onmessage = ({ data }) => {
      if (done || !data || data.id !== id) return;
      try {
        if (data.kind === 'progress') {
          if (
            !Number.isFinite(data.fraction) ||
            data.fraction < fraction ||
            data.fraction > 1 ||
            !['decode', 'prepare', 'pack', 'compose', 'encode', 'compile'].includes(data.stage)
          )
            throw new Error('Invalid atlas progress.');
          fraction = data.fraction;
          options.progress?.(fraction, data.stage);
        } else if (data.kind === 'result') {
          if (!validAtlasWorkerResult(data.result)) throw new Error('Invalid atlas worker result.');
          if (
            ids.size !== sourceCount ||
            ids.size !== data.result.regions.length ||
            data.result.regions.some((region) => !ids.has(region.id))
          )
            throw new Error('Atlas result does not match source identities.');
          if (needsRuntime !== (data.result.runtime !== undefined))
            throw new Error('Atlas result does not match native compilation request.');
          if (data.result.runtime && data.result.runtime.projectId !== projectId)
            throw new Error('Native result belongs to another project.');
          finish(undefined, data.result);
        } else if (data.kind === 'error') {
          if (
            typeof data.code !== 'string' ||
            typeof data.message !== 'string' ||
            typeof data.remedy !== 'string' ||
            !(data.objectId === null || typeof data.objectId === 'string')
          )
            throw new Error('Invalid atlas worker diagnostic.');
          finish(new AtlasError(data.code, data.objectId, data.message, data.remedy));
        } else throw new Error('Unknown atlas worker message.');
      } catch (error) {
        finish(error);
      }
    };
    worker.onerror = (event) => finish(new Error(event.message));
    worker.onmessageerror = () => finish(new Error('Atlas worker message could not be cloned.'));
    try {
      worker.postMessage({ id, input });
    } catch (error) {
      finish(error);
    }
  });
}
