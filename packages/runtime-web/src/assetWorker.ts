import { AtlasError } from '@limber/atlas';
import { prepareEncodedAtlas } from './atlasPipeline';
import type { AtlasWorkerRequest, AtlasWorkerMessage } from './atlasProtocol';

const worker = globalThis as unknown as {
  onmessage: ((event: MessageEvent<AtlasWorkerRequest>) => void) | null;
  postMessage(message: AtlasWorkerMessage, transfer?: Transferable[]): void;
};
let accepted = false;
worker.onmessage = async ({ data }) => {
  // An export owns its worker. Never multiplex mutable WASM jobs in this instance.
  if (accepted || !data || !Number.isSafeInteger(data.id) || data.id < 1) return;
  accepted = true;
  const id = data.id;
  try {
    const result = await prepareEncodedAtlas(data.input, (fraction, stage) =>
      worker.postMessage({ id, kind: 'progress', fraction, stage }),
    );
    worker.postMessage(
      { id, kind: 'result', result },
      result.pages.map((page) => page.bytes),
    );
  } catch (error) {
    const diagnostic =
      error instanceof AtlasError
        ? error
        : new AtlasError(
            'ATLAS_WORKER_FAILURE',
            null,
            error instanceof Error ? error.message : 'Atlas worker failed.',
            'Correct the source assets/settings and retry.',
          );
    worker.postMessage({
      id,
      kind: 'error',
      code: diagnostic.code,
      objectId: diagnostic.objectId,
      message: diagnostic.message,
      remedy: diagnostic.remedy,
    });
  }
};
