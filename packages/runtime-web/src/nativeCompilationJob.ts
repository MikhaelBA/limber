import type { BoneByBoneProject } from '@limber/core';
import type { CompileRuntimeOptions } from '@limber/runtime';
import { buildAtlasInWorker } from './atlasJob';
import type { AtlasWorkerInput } from './atlasProtocol';

export type NativeCompilationOptions = Omit<AtlasWorkerInput, 'images' | 'project' | 'runtimeOptions'> &
  CompileRuntimeOptions &
  Parameters<typeof buildAtlasInWorker>[1];

/** Worker messaging captures the source snapshot; byte extraction and compile run off thread. */
export function compileNativeInWorker(source: BoneByBoneProject, options: NativeCompilationOptions) {
  const { createWorker, signal, progress, defaultArtboardId, ...assets } = options;
  return buildAtlasInWorker(
    { ...assets, images: [], project: source, runtimeOptions: { defaultArtboardId } },
    { createWorker, signal, progress },
  );
}
