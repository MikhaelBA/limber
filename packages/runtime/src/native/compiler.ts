import { validateProject, type BoneByBoneProject } from '@limber/core';
import { deriveRuntimeFeatures, referencedRuntimeTextures } from './features';
import {
  RUNTIME_FORMAT,
  RUNTIME_VERSION,
  RuntimeFormatError,
  runtimeFail,
  type RuntimeDiagnostic,
  type RuntimeProgram,
  type RuntimeTexture,
} from './model';
import { projectRuntimeShape } from './shape';
import { validateRuntimeProgram } from './validate';

export interface CompileRuntimeOptions {
  defaultArtboardId?: string;
}
export interface RuntimeCompilation {
  program: RuntimeProgram;
  diagnostics: RuntimeDiagnostic[];
}

/** Pure deterministic compilation. Editor selection never chooses the runtime entry point. */
export function compileRuntime(
  source: BoneByBoneProject,
  options: CompileRuntimeOptions = {},
): RuntimeCompilation {
  try {
    validateProject(source);
  } catch (error) {
    const objectId =
      error && typeof error === 'object' && 'objectId' in error && typeof error.objectId === 'string'
        ? error.objectId
        : null;
    runtimeFail(
      'INVALID_SOURCE',
      error instanceof Error ? error.message : 'Invalid authoring project.',
      objectId,
      'Correct the source project before compiling a runtime file.',
    );
  }
  const candidate = {
    format: RUNTIME_FORMAT,
    version: RUNTIME_VERSION,
    id: source.projectId,
    name: source.name,
    defaultArtboardId: options.defaultArtboardId ?? source.artboards[0]!.id,
    features: [],
    textures: [],
    artboards: source.artboards,
    components: source.components ?? [],
  };
  const program = projectRuntimeShape(candidate, false) as RuntimeProgram;
  for (const id of [...referencedRuntimeTextures(program)].sort()) {
    const meta = Object.hasOwn(source.assetManifest, id) ? source.assetManifest[id] : undefined;
    if (!meta?.dataUrl)
      runtimeFail(
        'MISSING_PIXELS',
        'A referenced image has no embedded shipping pixels.',
        id,
        'Embed or reimport the referenced image before exporting.',
      );
    if (meta.source !== 'embedded' || meta.region !== undefined)
      runtimeFail(
        'SOURCE_ATLAS_UNSUPPORTED',
        'Source atlas regions require the native atlas compiler stage.',
        id,
        'Use original embedded images until native atlas compilation is available.',
      );
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]*)$/i.exec(meta.dataUrl);
    if (!match)
      runtimeFail(
        'UNSUPPORTED_IMAGE',
        'Native v1 requires embedded PNG, JPEG or WebP pixels.',
        id,
        'Convert or reimport the image in a supported raster format.',
      );
    program.textures.push({ id, mime: match[1]!.toLowerCase() as RuntimeTexture['mime'], base64: match[2]! });
  }
  program.features = deriveRuntimeFeatures(program);
  const validated = validateRuntimeProgram(program);
  const diagnostics: RuntimeDiagnostic[] = [];
  for (const container of [...validated.artboards, ...validated.components])
    for (const node of container.nodes)
      if (node.type === 'text')
        diagnostics.push({
          code: 'EXTERNAL_FONT',
          severity: 'warning',
          objectId: node.id,
          explanation: `Text requires host fonts: ${node.fontFamilies.join(', ')}. Font pixels are not bundled in v1 compilation yet.`,
          remedy:
            'Provide the declared fonts in the target host; packaged font export follows in the asset pipeline.',
        });
  return { program: validated, diagnostics };
}

/** Turn a failed compile into a Doctor finding without losing its remedy/object reference. */
export function diagnoseRuntimeCompilation(
  source: BoneByBoneProject,
  options: CompileRuntimeOptions = {},
): RuntimeDiagnostic[] {
  try {
    return compileRuntime(source, options).diagnostics;
  } catch (error) {
    if (error instanceof RuntimeFormatError) return [error.diagnostic];
    throw error;
  }
}
