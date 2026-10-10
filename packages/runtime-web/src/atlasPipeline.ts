import { Resvg, initWasm } from '@resvg/resvg-wasm';
import {
  ATLAS_MAX_PIXELS,
  ATLAS_MAX_REGIONS,
  AtlasError,
  atlasFail,
  atlasInteger,
  validateImageSize,
  validateAtlasRasterOptions,
  prepareAtlasImage,
  packAtlasRegions,
  compositeAtlasPages,
  createAtlasWorkStats,
  type PreparedAtlasImage,
} from '@limber/atlas';
import { readRasterSize } from './imageHeader';
import type {
  AtlasWorkerInput,
  AtlasWorkerResult,
  AtlasWorkerMessage,
  AtlasSourceImage,
} from './atlasProtocol';

let wasmReady: Promise<void> | undefined;
/** This module runs in the owned worker; never call the pixel pipeline on the UI thread. */
export async function prepareEncodedAtlas(
  input: AtlasWorkerInput,
  progress: (fraction: number, stage: Extract<AtlasWorkerMessage, { kind: 'progress' }>['stage']) => void,
): Promise<AtlasWorkerResult> {
  const started = performance.now(),
    stats = createAtlasWorkStats();
  const timingsMs = { decode: 0, prepare: 0, pack: 0, compose: 0, encode: 0, total: 0 };
  if (!input || !Array.isArray(input.images) || input.images.length > ATLAS_MAX_REGIONS)
    atlasFail('ATLAS_REGION_BUDGET', null, 'Atlas job needs at most 4096 images.');
  packAtlasRegions([], input.layout); // Reject invalid host limits before decoding.
  validateAtlasRasterOptions(input.raster);
  const limit = input.maxDecodedPixels ?? ATLAS_MAX_PIXELS;
  atlasInteger(limit, 1, ATLAS_MAX_PIXELS, 'decoded pixel budget');
  const ids = new Set<string>();
  let bytes = 0;
  for (const image of input.images) {
    validateImageSize({ id: image.id, width: 1, height: 1 });
    if (ids.has(image.id)) atlasFail('ATLAS_DUPLICATE_ID', image.id, 'Source image IDs must be unique.');
    ids.add(image.id);
    if (image.trim !== undefined && typeof image.trim !== 'boolean')
      atlasFail('ATLAS_INVALID_INPUT', image.id, 'Image trim flags must be boolean.');
    if (
      !['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(image.mime) ||
      !(image.bytes instanceof ArrayBuffer) ||
      !image.bytes.byteLength ||
      image.bytes.byteLength > 16 * 1024 * 1024
    )
      atlasFail(
        'IMAGE_SOURCE',
        image.id,
        'Image needs supported, nonempty bytes within the 16 MiB per-image limit.',
      );
    bytes += image.bytes.byteLength;
    if (bytes > 64 * 1024 * 1024)
      atlasFail('IMAGE_BYTE_BUDGET', null, 'Source images exceed the 64 MiB encoded byte budget.');
  }
  let fontBytes = 0;
  if (input.svgFonts !== undefined && (!Array.isArray(input.svgFonts) || input.svgFonts.length > 32))
    atlasFail('SVG_FONT_REQUIRED', null, 'SVG fonts need at most 32 explicit font buffers.');
  for (const font of input.svgFonts ?? []) {
    if (!(font instanceof ArrayBuffer) || !font.byteLength)
      atlasFail('SVG_FONT_REQUIRED', null, 'SVG font buffers must be nonempty.');
    fontBytes += font.byteLength;
    if (fontBytes > 16 * 1024 * 1024)
      atlasFail('SVG_FONT_BUDGET', null, 'SVG fonts exceed their 16 MiB byte budget.');
  }
  if (typeof OffscreenCanvas !== 'function' || typeof createImageBitmap !== 'function')
    atlasFail(
      'WORKER_IMAGE_API',
      null,
      'This browser does not support worker image decode and OffscreenCanvas.',
      'Use a browser with these worker APIs.',
    );
  const checkSize = (id: string, width: number, height: number, remaining: number) => {
    validateImageSize({ id, width, height });
    if (width * height > remaining)
      atlasFail(
        'IMAGE_PIXEL_BUDGET',
        id,
        'Decoded/prepared images exceed the job pixel budget.',
        'Reduce source dimensions/export scale or split the job.',
      );
  };
  const decodeRaster = async (source: AtlasSourceImage, remaining: number) => {
    const header = readRasterSize(new Uint8Array(source.bytes), source.mime, source.id);
    checkSize(source.id, header.width, header.height, remaining);
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(new Blob([source.bytes], { type: source.mime }));
    } catch {
      return atlasFail(
        'IMAGE_DECODE',
        source.id,
        'Image body could not be decoded.',
        'Reimport an undamaged complete image.',
      );
    }
    try {
      checkSize(source.id, bitmap.width, bitmap.height, remaining);
      // EXIF orientation may swap JPEG dimensions. It cannot change the pixel count.
      if (bitmap.width * bitmap.height !== header.width * header.height)
        atlasFail('IMAGE_HEADER', source.id, 'Decoded dimensions disagree with the image header.');
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height),
        ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) atlasFail('WORKER_IMAGE_API', source.id, 'Worker 2D canvas is unavailable.');
      ctx.drawImage(bitmap, 0, 0);
      const pixels = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
      canvas.width = canvas.height = 1;
      return { id: source.id, width: bitmap.width, height: bitmap.height, pixels, trim: source.trim };
    } finally {
      bitmap.close();
    }
  };
  const decodeSvg = async (source: AtlasSourceImage, remaining: number) => {
    let svg: string;
    try {
      svg = new TextDecoder('utf-8', { fatal: true }).decode(source.bytes);
    } catch {
      return atlasFail('SVG_DECODE', source.id, 'SVG must contain valid UTF-8 XML.');
    }
    if (/<(?:\w+:)?text(?:\s|>)/i.test(svg) && !input.svgFonts?.length)
      atlasFail(
        'SVG_FONT_REQUIRED',
        source.id,
        'SVG text requires explicit font bytes for deterministic conversion.',
        'Provide the SVG font buffers or convert text to paths before import.',
      );
    if (typeof input.wasmUrl !== 'string' || !input.wasmUrl.length || input.wasmUrl.length > 8192)
      atlasFail('SVG_WASM_REQUIRED', source.id, 'SVG conversion needs the bundled resvg WASM asset URL.');
    try {
      wasmReady ??= initWasm(
        fetch(input.wasmUrl).then((response) => {
          if (!response.ok) throw new Error('WASM fetch failed.');
          return response;
        }),
      );
      await wasmReady;
    } catch {
      return atlasFail(
        'SVG_WASM_DECODE',
        source.id,
        'SVG converter WASM could not be loaded.',
        'Check the bundled WASM URL and retry.',
      );
    }
    let tree: InstanceType<typeof Resvg> | undefined;
    let rendered: ReturnType<InstanceType<typeof Resvg>['render']> | undefined;
    try {
      tree = new Resvg(svg, {
        font: { fontBuffers: (input.svgFonts ?? []).map((buffer) => new Uint8Array(buffer)) },
      });
      checkSize(source.id, Math.ceil(tree.width), Math.ceil(tree.height), remaining);
      if (tree.imagesToResolve().length)
        atlasFail(
          'SVG_EXTERNAL_IMAGE',
          source.id,
          'SVG refers to images outside its embedded bytes.',
          'Embed those images in the SVG before import.',
        );
      rendered = tree.render();
      // PNG is the authoritative straight-alpha interchange; WASM's internal pixels
      // are never assumed to share the browser/Pixi premultiplication convention.
      const png = rendered.asPng().slice().buffer as ArrayBuffer;
      return await decodeRaster({ ...source, mime: 'image/png', bytes: png }, remaining);
    } catch (error) {
      if (error instanceof AtlasError) throw error;
      return atlasFail(
        'SVG_DECODE',
        source.id,
        'SVG XML/artwork could not be converted.',
        'Reimport valid self-contained SVG artwork.',
      );
    } finally {
      rendered?.free();
      tree?.free();
    }
  };
  const prepared: PreparedAtlasImage[] = [];
  let decodedPixels = 0,
    preparedPixels = 0;
  for (const [index, source] of input.images.entries()) {
    progress((index / input.images.length) * 0.6, 'decode');
    const decodeStart = performance.now();
    const decoded = await (source.mime === 'image/svg+xml'
      ? decodeSvg(source, limit - decodedPixels)
      : decodeRaster(source, limit - decodedPixels));
    decodedPixels += decoded.width * decoded.height;
    timingsMs.decode += performance.now() - decodeStart;
    progress(((index + 0.5) / input.images.length) * 0.6, 'prepare');
    const prepareStart = performance.now();
    if (preparedPixels >= limit)
      atlasFail('IMAGE_PIXEL_BUDGET', source.id, 'No prepared-image pixel budget remains.');
    const image = prepareAtlasImage(
      decoded,
      {
        ...input.raster,
        maxPixels: Math.min(input.raster?.maxPixels ?? limit, limit - preparedPixels),
      },
      stats,
    );
    preparedPixels += image.width * image.height;
    if (preparedPixels > limit)
      atlasFail('IMAGE_PIXEL_BUDGET', source.id, 'Prepared image scale exceeds the aggregate pixel budget.');
    prepared.push(image);
    timingsMs.prepare += performance.now() - prepareStart;
  }
  progress(0.65, 'pack');
  let start = performance.now();
  const layout = packAtlasRegions(
    prepared,
    {
      ...input.layout,
      maxPixels: Math.min(input.layout?.maxPixels ?? limit, limit),
    },
    stats,
  );
  timingsMs.pack = performance.now() - start;
  progress(0.75, 'compose');
  start = performance.now();
  const pixels = compositeAtlasPages(prepared, layout, stats);
  timingsMs.compose = performance.now() - start;
  const pages: AtlasWorkerResult['pages'] = [];
  let encodedBytes = 0;
  for (const [index, page] of pixels.entries()) {
    progress(0.85 + (index / pixels.length) * 0.15, 'encode');
    start = performance.now();
    const canvas = new OffscreenCanvas(page.width, page.height),
      ctx = canvas.getContext('2d');
    if (!ctx) atlasFail('WORKER_IMAGE_API', page.id, 'Worker PNG canvas is unavailable.');
    ctx.putImageData(
      new ImageData(new Uint8ClampedArray(page.pixels.buffer as ArrayBuffer), page.width, page.height),
      0,
      0,
    );
    const bytes = await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer();
    encodedBytes += bytes.byteLength;
    if (encodedBytes > 128 * 1024 * 1024)
      atlasFail('ATLAS_BYTE_BUDGET', null, 'Encoded pages exceed the 128 MiB output budget.');
    canvas.width = canvas.height = 1;
    pages.push({
      id: page.id,
      width: page.width,
      height: page.height,
      premultiplied: false,
      mime: 'image/png',
      bytes,
    });
    timingsMs.encode += performance.now() - start;
  }
  progress(1, 'encode');
  timingsMs.total = performance.now() - started;
  return {
    layout,
    pages,
    regions: prepared.map(({ id, width, height, sourceWidth, sourceHeight, crop, scale, empty }) => ({
      id,
      width,
      height,
      sourceWidth,
      sourceHeight,
      crop,
      scale,
      empty,
    })),
    stats,
    timingsMs,
  };
}
