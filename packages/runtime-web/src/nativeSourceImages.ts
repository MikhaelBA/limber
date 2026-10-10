import type { BoneByBoneProject } from '@limber/core';
import { runtimeTextureRequirements, RuntimeFormatError } from '@limber/runtime';
import type { AtlasWorkerInput } from './atlasProtocol';

/** Worker-only source extraction: keep base64 decode/normalization away from the UI thread. */
export function nativeSourceImages(project: BoneByBoneProject): AtlasWorkerInput['images'] {
  const fail = (code: string, explanation: string, objectId: string | null): never => {
    throw new RuntimeFormatError({
      code,
      severity: 'error',
      explanation,
      objectId,
      remedy: 'Embed complete original images or reduce/split the export input.',
    });
  };
  const requirements = runtimeTextureRequirements({
    artboards: project.artboards,
    components: project.components ?? [],
  });
  if (requirements.length > 4096)
    fail('ATLAS_REGION_BUDGET', 'Native export allows at most 4096 source images.', null);
  let total = 0;
  const encoded = requirements.map(({ id, trimAllowed }) => {
    const meta = Object.hasOwn(project.assetManifest, id) ? project.assetManifest[id] : undefined;
    if (!meta?.dataUrl)
      return fail('MISSING_PIXELS', 'Referenced texture has no embedded export pixels.', id);
    if (meta.source !== 'embedded' || meta.region !== undefined)
      return fail(
        'SOURCE_ATLAS_UNSUPPORTED',
        'Native export needs original images rather than imported source atlas regions.',
        id,
      );
    const match = /^data:(image\/(?:png|jpeg|webp|svg\+xml));base64,([A-Za-z0-9+/=]+)$/i.exec(meta.dataUrl);
    if (!match)
      return fail('UNSUPPORTED_IMAGE', 'Export requires embedded PNG, JPEG, WebP or SVG artwork.', id);
    const size = (match[2]!.length * 3) / 4;
    total += size;
    if (size > 16 * 1024 * 1024 + 2 || total > 64 * 1024 * 1024 + 2 * requirements.length)
      return fail('IMAGE_BYTE_BUDGET', 'Encoded source images exceed their bounded export input.', id);
    return {
      id,
      trimAllowed,
      mime: match[1]!.toLowerCase() as AtlasWorkerInput['images'][number]['mime'],
      base64: match[2]!,
    };
  });
  return encoded.map(({ id, trimAllowed, mime, base64 }) => {
    let raw: string;
    try {
      raw = atob(base64);
    } catch {
      return fail('INVALID_IMAGE_ENCODING', 'Source image base64 could not be decoded.', id);
    }
    if (btoa(raw) !== base64)
      return fail('INVALID_IMAGE_ENCODING', 'Source image needs canonical base64 bytes.', id);
    return { id, mime, bytes: Uint8Array.from(raw, (c) => c.charCodeAt(0)).buffer, trim: trimAllowed };
  });
}
