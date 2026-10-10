import { expandUIComponents, type BoneByBoneProject, type RigNode, type EmbeddedFont } from '@limber/core';
import { materializeRuntimeProject } from './adapt';
import { validateRuntimeProgram } from './validate';
import { runtimeFail, type RuntimeProgram, type RuntimeTexture, type RuntimeAtlasPage } from './model';

interface AssetState {
  program: RuntimeProgram;
  project: BoneByBoneProject;
  rigs: Map<string, ReadonlyMap<string, RigNode>>;
}
const assets = new WeakMap<NativeRuntimeAsset, AssetState>();

/** One validated immutable asset publication can create many independent playback instances. */
export class NativeRuntimeAsset {
  constructor(input: RuntimeProgram) {
    const program = validateRuntimeProgram(input),
      project = materializeRuntimeProject(program).project;
    assets.set(this, { program, project, rigs: new Map() });
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
    return structuredClone(texture);
  }
  getTextures(): readonly RuntimeTexture[] {
    return structuredClone(nativeAssetState(this).program.textures);
  }
  getAtlasPages(): readonly RuntimeAtlasPage[] {
    return nativeAssetState(this).program.atlasPages.map((page) => ({ ...page }));
  }
  getFontRequirements(): readonly { nodeId: string; families: readonly string[] }[] {
    const program = nativeAssetState(this).program;
    return [...program.artboards, ...program.components].flatMap((board) =>
      board.nodes.flatMap((node) =>
        node.type === 'text' ? [{ nodeId: node.id, families: [...node.fontFamilies] }] : [],
      ),
    );
  }
  getFonts(): readonly EmbeddedFont[] {
    return structuredClone(nativeAssetState(this).program.fonts);
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
/** Immutable authored expansion is shared; players still clone every mutable skeleton/graph. */
export function nativeRigSource(
  asset: NativeRuntimeAsset,
  artboardId: string,
  rigId: string,
): RigNode | undefined {
  const state = nativeAssetState(asset);
  let rigs = state.rigs.get(artboardId);
  if (!rigs) {
    const board = state.project.artboards.find((board) => board.id === artboardId);
    if (!board) runtimeFail('MISSING_ARTBOARD', 'Requested runtime artboard does not exist.', artboardId);
    rigs = new Map(
      expandUIComponents(state.project, board).artboard.nodes.flatMap((node) =>
        node.type === 'rig' ? [[node.id, node] as const] : [],
      ),
    );
    state.rigs.set(artboardId, rigs);
  }
  return rigs.get(rigId);
}
