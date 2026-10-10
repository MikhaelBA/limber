export const ATLAS_MAX_REGIONS = 4096;
export const ATLAS_MAX_DIMENSION = 16384;
export const ATLAS_MAX_PIXELS = 64 * 1024 * 1024;
export interface AtlasRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface AtlasImageSize {
  id: string;
  width: number;
  height: number;
}
export interface AtlasPlacement extends AtlasRect {
  id: string;
  page: number;
  rotated: boolean;
}
export interface AtlasLayout {
  pages: { width: number; height: number }[];
  placements: AtlasPlacement[];
  padding: number;
}
export interface AtlasLayoutOptions {
  maxWidth?: number;
  maxHeight?: number;
  maxPages?: number;
  maxPixels?: number;
  padding?: number;
  allowRotation?: boolean;
  powerOfTwo?: boolean;
}
export interface AtlasRasterInput extends AtlasImageSize {
  pixels: Uint8Array | Uint8ClampedArray;
  /** Disable trim for mesh/region/nine-slice users whose full logical UV domain must survive. */
  trim?: boolean;
}
export interface AtlasRasterOptions {
  trim?: boolean;
  scale?: number;
  sampling?: 'nearest' | 'bilinear';
  /** Bounds output allocation before resize; useful for an aggregate worker budget. */
  maxPixels?: number;
  /** Transparent source-pixel guard around content for a downstream linear filter. */
  trimMargin?: number;
}
export interface PreparedAtlasImage extends AtlasRasterInput {
  sourceWidth: number;
  sourceHeight: number;
  crop: AtlasRect;
  scale: number;
  empty: boolean;
}
export interface AtlasPagePixels extends AtlasImageSize {
  pixels: Uint8Array;
  /** Straight RGBA8; host upload may premultiply once. */
  premultiplied: false;
}
export interface AtlasWorkStats {
  fitTests: number;
  pruneTests: number;
  pixelsScanned: number;
  resizedPixels: number;
  compositedPixels: number;
}
export function createAtlasWorkStats(): AtlasWorkStats {
  return { fitTests: 0, pruneTests: 0, pixelsScanned: 0, resizedPixels: 0, compositedPixels: 0 };
}
export class AtlasError extends Error {
  constructor(
    readonly code: string,
    readonly objectId: string | null,
    message: string,
    readonly remedy: string,
  ) {
    super(message);
    this.name = 'AtlasError';
  }
}
export function atlasFail(
  code: string,
  objectId: string | null,
  message: string,
  remedy = 'Correct the source image or atlas settings and retry.',
): never {
  throw new AtlasError(code, objectId, message, remedy);
}
export function atlasInteger(
  value: number,
  minimum: number,
  maximum: number,
  label: string,
  objectId: string | null = null,
): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    atlasFail('ATLAS_INVALID_INPUT', objectId, `Invalid ${label}.`);
}
export function validateImageSize(image: AtlasImageSize): void {
  if (typeof image.id !== 'string' || !image.id.length || image.id.length > 4096)
    atlasFail('ATLAS_INVALID_INPUT', null, 'Image needs a bounded nonempty stable ID.');
  atlasInteger(image.width, 1, ATLAS_MAX_DIMENSION, 'image width', image.id);
  atlasInteger(image.height, 1, ATLAS_MAX_DIMENSION, 'image height', image.id);
  if (image.width * image.height > ATLAS_MAX_PIXELS)
    atlasFail(
      'ATLAS_PIXEL_BUDGET',
      image.id,
      'Image exceeds the RGBA preparation budget.',
      'Reduce image dimensions before atlas preparation.',
    );
}
export function compareAtlasId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
