import wasmUrl from '@resvg/resvg-wasm/index_bg.wasm?url';
import {
  buildAtlasInWorker,
  compileNativeInWorker,
  type AtlasWorkerInput,
  type NativeCompilationOptions,
} from '@limber/runtime-web';
import type { BoneByBoneProject } from '@limber/core';

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

export function compileNativeProject(
  source: BoneByBoneProject,
  options: Omit<NativeCompilationOptions, 'createWorker' | 'wasmUrl'> = {},
) {
  return compileNativeInWorker(source, {
    ...options,
    wasmUrl,
    fontSources: options.fontSources ?? [{
      id: 'bundled-noto-sans-arabic', family: 'Noto Sans Arabic', format: 'ttf',
      url: new URL(`${import.meta.env.BASE_URL}fonts/NotoSansArabic.ttf`, location.href).href,
      license: {
        name: 'SIL Open Font License 1.1', redistribution: 'allowed',
        sourceUrl: 'https://github.com/google/fonts/tree/main/ofl/notosansarabic',
        textUrl: new URL(`${import.meta.env.BASE_URL}fonts/OFL-NotoSansArabic.txt`, location.href).href,
      },
    }],
    createWorker: () =>
      new Worker(new URL('../../../runtime-web/src/assetWorker.ts', import.meta.url), { type: 'module' }),
  });
}
