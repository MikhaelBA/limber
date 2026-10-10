import type { BoneByBoneProject } from '@limber/core';
import { materializeRuntimeProject } from './adapt';
import { validateRuntimeProgram } from './validate';
import { runtimeFail, type RuntimeProgram, type RuntimeTexture } from './model';

interface AssetState {
  program: RuntimeProgram;
  project: BoneByBoneProject;
}
const assets = new WeakMap<NativeRuntimeAsset, AssetState>();

/** One validated immutable asset publication can create many independent playback instances. */
export class NativeRuntimeAsset {
  constructor(input: RuntimeProgram) {
    const program = validateRuntimeProgram(input),
      project = materializeRuntimeProject(program).project;
    assets.set(this, { program, project });
  }
  getProgram(): RuntimeProgram {
    return structuredClone(nativeAssetState(this).program);
  }
  getArtboards(): readonly { id: string; name: string; width: number; height: number }[] {
    return nativeAssetState(this).program.artboards.map(({ id, name, width, height }) => ({
      id,
      name,
      width,
      height,
    }));
  }
  getTexture(id: string): RuntimeTexture {
    const texture = nativeAssetState(this).program.textures.find((texture) => texture.id === id);
    if (!texture) runtimeFail('MISSING_PIXELS', 'Requested native texture does not exist.', id);
    return { ...texture };
  }
}
/** Internal only. Players clone mutable working data; this state never crosses the package API. */
export function nativeAssetState(asset: NativeRuntimeAsset): AssetState {
  const state = assets.get(asset);
  if (!state)
    runtimeFail(
      'INVALID_NATIVE_ASSET',
      'Native asset has not passed its constructor validation.',
      null,
      'Load a supported program through the NativeRuntimeAsset constructor.',
    );
  return state;
}
export function requireNativeAsset(input: RuntimeProgram | NativeRuntimeAsset): NativeRuntimeAsset {
  return input instanceof NativeRuntimeAsset ? input : new NativeRuntimeAsset(input);
}
