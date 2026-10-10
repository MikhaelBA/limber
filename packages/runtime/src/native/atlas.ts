import {
  ATLAS_MAX_PIXELS,
  ATLAS_MAX_REGIONS,
  AtlasError,
  validateAtlasLayout,
  validateImageSize,
} from '@limber/atlas';
import { fullDomainRuntimeTextures } from './features';
import { runtimeFail, type RuntimeProgram, type RuntimeAtlasTexture } from './model';

/** Metadata-only preflight before allocating a player or decoding a physical page. */
export function validateNativeAtlas(program: RuntimeProgram): void {
  const regions = program.textures.filter(
    (texture): texture is RuntimeAtlasTexture => texture.type === 'atlas',
  );
  if (regions.length > ATLAS_MAX_REGIONS || program.atlasPages.length > 64)
    runtimeFail('ATLAS_REGION_BUDGET', 'Native atlas exceeds region/page limits.');
  const pages = new Map<string, number>();
  let pagePixels = 0,
    sourcePixels = 0;
  try {
    for (const [index, page] of program.atlasPages.entries()) {
      if (pages.has(page.id)) runtimeFail('DUPLICATE_ATLAS_PAGE', 'Atlas page IDs must be unique.', page.id);
      validateImageSize(page);
      pages.set(page.id, index);
      pagePixels += page.width * page.height;
      if (pagePixels > ATLAS_MAX_PIXELS)
        runtimeFail('ATLAS_PIXEL_BUDGET', 'Native physical pages exceed the 64 Mi pixel budget.', page.id);
      // Canonical base64 and PNG signature have already been checked by ingestion.
      const prefix = page.base64.slice(0, 32),
        alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      const bytes: number[] = [];
      for (let p = 0; p < prefix.length; p += 4) {
        const n =
          alphabet.indexOf(prefix[p]!) * 262144 +
          alphabet.indexOf(prefix[p + 1]!) * 4096 +
          alphabet.indexOf(prefix[p + 2]!) * 64 +
          alphabet.indexOf(prefix[p + 3]!);
        bytes.push(n >>> 16, (n >>> 8) & 255, n & 255);
      }
      const integer = (p: number) =>
        bytes[p]! * 0x1000000 + (bytes[p + 1]! << 16) + (bytes[p + 2]! << 8) + bytes[p + 3]!;
      if (
        ![0, 0, 0, 13, 73, 72, 68, 82].every((v, i) => bytes[8 + i] === v) ||
        integer(16) !== page.width ||
        integer(20) !== page.height
      )
        runtimeFail(
          'INVALID_ATLAS_DIMENSIONS',
          'Atlas PNG header must agree with physical page dimensions.',
          page.id,
        );
    }
    const fullDomain = fullDomainRuntimeTextures(program),
      groups = program.atlasPages.map(() => [] as RuntimeAtlasTexture[]);
    for (const region of regions) {
      const page = pages.get(region.pageId);
      if (page === undefined)
        runtimeFail('MISSING_ATLAS_PAGE', 'Atlas region refers to a missing physical page.', region.id);
      validateImageSize({ id: region.id, width: region.sourceWidth, height: region.sourceHeight });
      sourcePixels += region.sourceWidth * region.sourceHeight;
      if (sourcePixels > ATLAS_MAX_PIXELS)
        runtimeFail('ATLAS_PIXEL_BUDGET', 'Logical source images exceed the 64 Mi pixel budget.', region.id);
      const c = region.crop;
      if (
        ![c.x, c.y, c.width, c.height].every(Number.isSafeInteger) ||
        c.x < 0 ||
        c.y < 0 ||
        c.width < 1 ||
        c.height < 1 ||
        c.x + c.width > region.sourceWidth ||
        c.y + c.height > region.sourceHeight ||
        region.scale <= 0 ||
        region.scale > 16
      )
        runtimeFail(
          'INVALID_ATLAS_CROP',
          'Atlas crop must fit its logical source and use a positive scale at most sixteen.',
          region.id,
        );
      if (region.empty && (c.x !== 0 || c.y !== 0 || c.width !== 1 || c.height !== 1))
        runtimeFail(
          'INVALID_ATLAS_CROP',
          'Empty trimmed regions need a one-pixel placeholder crop at the origin.',
          region.id,
        );
      if (
        fullDomain.has(region.id) &&
        (c.x !== 0 || c.y !== 0 || c.width !== region.sourceWidth || c.height !== region.sourceHeight)
      )
        runtimeFail(
          'ATLAS_FULL_UV_REQUIRED',
          'Rig/mesh/nine-slice textures must retain their full logical UV domain.',
          region.id,
          'Disable trim for this texture during export.',
        );
      groups[page]!.push(region);
    }
    for (const [index, group] of groups.entries()) {
      const page = program.atlasPages[index]!;
      if (!group.length)
        runtimeFail('UNUSED_ATLAS_PAGE', 'Runtime must not ship an unreferenced atlas page.', page.id);
      validateAtlasLayout(
        group.map((r) => ({
          id: r.id,
          width: Math.ceil(r.crop.width * r.scale),
          height: Math.ceil(r.crop.height * r.scale),
        })),
        {
          pages: [{ width: page.width, height: page.height }],
          padding: page.padding,
          placements: group.map((r) => ({ id: r.id, page: 0, rotated: r.rotated, ...r.frame })),
        },
      );
    }
  } catch (error) {
    if (error instanceof AtlasError) runtimeFail(error.code, error.message, error.objectId, error.remedy);
    throw error;
  }
}
