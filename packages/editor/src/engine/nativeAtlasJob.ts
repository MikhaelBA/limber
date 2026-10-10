import wasmUrl from '@resvg/resvg-wasm/index_bg.wasm?url';
import { buildAtlasInWorker, type AtlasWorkerInput } from '@limber/runtime-web';

/** Bundler-specific paths belong to the host; runtime-web remains bundler independent. */
export function prepareNativeAtlas(
  input: Omit<AtlasWorkerInput, 'wasmUrl'>,
  options: {
    signal?: AbortSignal;
    progress?: Parameters<typeof buildAtlasInWorker>[1]['progress'];
  } = {},
) {
  return buildAtlasInWorker(
    { ...input, wasmUrl },
    {
      ...options,
      createWorker: () =>
        new Worker(new URL('../../../runtime-web/src/assetWorker.ts', import.meta.url), { type: 'module' }),
    },
  );
}
