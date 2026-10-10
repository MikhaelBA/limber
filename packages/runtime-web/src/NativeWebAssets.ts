import { Rectangle, Texture, type Mesh, type MeshGeometry } from 'pixi.js';
import { NativeRuntimeAsset, RuntimeFormatError, type RuntimeImageTexture } from '@limber/runtime';
import type { TextureProvider } from './TextureProvider';
import { AtlasMeshShader } from './AtlasMeshShader';

export interface NativeFontSource {
  family: string;
  source: string | ArrayBuffer;
  descriptors?: FontFaceDescriptors;
}
export interface NativeWebAssetOptions {
  fonts?: readonly NativeFontSource[];
  signal?: AbortSignal;
  maxDimension?: number;
  maxPixels?: number;
}
const genericFonts = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'emoji',
  'math',
  'fangsong',
]);
function fail(code: string, explanation: string, objectId: string | null, remedy: string): never {
  throw new RuntimeFormatError({ code, severity: 'error', objectId, explanation, remedy });
}
function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Native asset loading was cancelled.', 'AbortError');
}
function untilAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  checkAbort(signal);
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('Native asset loading was cancelled.', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** Staged real pixel/font decode. No texture registry or document font is published on failure. */
export class NativeWebAssets implements TextureProvider {
  private readonly textures = new Map<string, Texture>();
  private readonly physical = new Set<Texture>();
  private readonly atlasTextures = new WeakSet<Texture>();
  private readonly images: HTMLImageElement[] = [];
  private readonly fonts: FontFace[] = [];
  private disposed = false;
  readonly placeholder = Texture.WHITE;
  version = 0;
  private constructor(readonly asset: NativeRuntimeAsset) {}
  get isDisposed(): boolean {
    return this.disposed;
  }

  static async load(
    asset: NativeRuntimeAsset,
    options: NativeWebAssetOptions = {},
  ): Promise<NativeWebAssets> {
    const maxDimension = options.maxDimension ?? 16384,
      maxPixels = options.maxPixels ?? 64 * 1024 * 1024;
    if (![maxDimension, maxPixels].every((value) => Number.isSafeInteger(value) && value >= 1))
      throw new Error('Native image limits must be positive safe integers.');
    checkAbort(options.signal);
    const published = new NativeWebAssets(asset),
      required = new Map<string, string>();
    for (const requirement of asset.getFontRequirements())
      for (const family of requirement.families)
        if (!genericFonts.has(family.toLowerCase())) required.set(family, requirement.nodeId);
    const sources = new Map<string, NativeFontSource>();
    for (const font of options.fonts ?? []) {
      if (typeof font.family !== 'string' || !font.family || sources.has(font.family))
        throw new Error('Native font sources need distinct nonempty family names.');
      sources.set(font.family, font);
    }
    for (const [family, nodeId] of required)
      if (!sources.has(family))
        fail(
          'MISSING_FONT',
          `Required font "${family}" has no supplied source.`,
          nodeId,
          'Supply and preload this font through NativeWebAssets.load, or author a generic font family.',
        );
    let pixels = 0;
    try {
      const records = asset.getTextures(),
        pages = new Map<string, Texture>();
      const images = records.filter((record): record is RuntimeImageTexture => record.type === 'image');
      for (const record of [...images, ...asset.getAtlasPages()]) {
        checkAbort(options.signal);
        const bytes = Uint8Array.from(atob(record.base64), (char) => char.charCodeAt(0));
        if (record.mime === 'image/png' && bytes.length >= 24) {
          const header = new DataView(bytes.buffer),
            width = header.getUint32(16),
            height = header.getUint32(20);
          if (width > maxDimension || height > maxDimension || pixels + width * height > maxPixels)
            fail(
              'IMAGE_BUDGET',
              'Image dimensions exceed the native decode budget.',
              record.id,
              'Reduce source image dimensions or explicitly increase the host image budget.',
            );
        }
        const url = URL.createObjectURL(new Blob([bytes], { type: record.mime })),
          image = new Image();
        image.decoding = 'async';
        published.images.push(image);
        try {
          const decode = new Promise<void>((resolve, reject) => {
            image.onload = () => resolve();
            image.onerror = () => reject(new Error('Invalid image body.'));
            image.src = url;
          });
          try {
            await untilAbort(decode, options.signal);
          } catch (error) {
            if (options.signal?.aborted) throw error;
            fail(
              'IMAGE_DECODE',
              'Native image bytes could not be decoded.',
              record.id,
              'Replace the damaged source image and export again.',
            );
          }
          checkAbort(options.signal);
          const width = image.naturalWidth,
            height = image.naturalHeight;
          if (
            !width ||
            !height ||
            width > maxDimension ||
            height > maxDimension ||
            pixels + width * height > maxPixels
          )
            fail(
              'IMAGE_BUDGET',
              'Image dimensions exceed the native decode budget.',
              record.id,
              'Reduce source image dimensions or explicitly increase the host image budget.',
            );
          pixels += width * height;
          if ('padding' in record && (width !== record.width || height !== record.height))
            fail(
              'INVALID_ATLAS_DIMENSIONS',
              'Decoded atlas page does not match its manifest.',
              record.id,
              'Re-export the atlas pages and manifest together.',
            );
          const texture = Texture.from(image, true);
          published.physical.add(texture);
          if ('padding' in record) pages.set(record.id, texture);
          else published.textures.set(record.id, texture);
        } finally {
          image.onload = null;
          image.onerror = null;
          URL.revokeObjectURL(url);
        }
      }
      for (const record of records) {
        if (record.type !== 'atlas') continue;
        const page = pages.get(record.pageId)!;
        const frame = record.frame,
          crop = record.crop;
        const texture = new Texture({
          source: page.source,
          label: record.id,
          frame: new Rectangle(frame.x, frame.y, frame.width, frame.height),
          orig: new Rectangle(0, 0, record.sourceWidth, record.sourceHeight),
          trim:
            crop.x || crop.y || crop.width !== record.sourceWidth || crop.height !== record.sourceHeight
              ? new Rectangle(crop.x, crop.y, crop.width, crop.height)
              : undefined,
          rotate: record.rotated ? 2 : 0,
        });
        published.textures.set(record.id, texture);
        published.atlasTextures.add(texture);
      }
      for (const [family, nodeId] of required) {
        const source = sources.get(family)!;
        let face: FontFace;
        try {
          face = new FontFace(family, source.source, source.descriptors);
          await untilAbort(face.load(), options.signal);
        } catch (error) {
          if (options.signal?.aborted) throw error;
          fail(
            'FONT_DECODE',
            `Required font "${family}" could not be loaded.`,
            nodeId,
            'Supply valid font bytes or a reachable font URL before publishing playback.',
          );
        }
        published.fonts.push(face);
      }
      checkAbort(options.signal);
      for (const font of published.fonts) document.fonts.add(font);
      return published;
    } catch (error) {
      published.dispose();
      throw error;
    }
  }
  get(id: string): Texture {
    if (this.disposed) throw new Error('Native Web assets have been disposed.');
    if (id === '') return Texture.WHITE; // Authored untextured region, not a missing image.
    const texture = this.textures.get(id);
    if (!texture)
      fail(
        'MISSING_PIXELS',
        'Native Web texture was not published.',
        id,
        'Load all required textures from the same validated runtime asset before rendering.',
      );
    return texture;
  }
  configureMesh(mesh: Mesh<MeshGeometry>): void {
    if (this.disposed) throw new Error('Native Web assets have been disposed.');
    const outside = mesh.geometry.uvs.some((value) => value < 0 || value > 1);
    if (this.atlasTextures.has(mesh.texture) && outside) {
      if (mesh.shader instanceof AtlasMeshShader) mesh.shader.texture = mesh.texture;
      else mesh.shader = new AtlasMeshShader(mesh.texture);
    } else if (mesh.shader instanceof AtlasMeshShader) {
      mesh.shader.destroy(false);
      mesh.shader = null;
    }
  }
  inspect() {
    return {
      disposed: this.disposed,
      textures: [...this.textures].map(([id, texture]) => ({
        id,
        width: texture.width,
        height: texture.height,
      })),
      fonts: this.fonts.map((font) => font.family),
      physicalImages: this.physical.size,
    };
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // Logical regions share sources. Destroy views first, then each physical source once.
    for (const texture of this.textures.values()) if (!this.physical.has(texture)) texture.destroy(false);
    for (const texture of this.physical) texture.destroy(true);
    for (const image of this.images) image.src = '';
    for (const font of this.fonts) document.fonts.delete(font);
    this.textures.clear();
    this.physical.clear();
    this.images.length = 0;
    this.fonts.length = 0;
    this.version++;
  }
}
