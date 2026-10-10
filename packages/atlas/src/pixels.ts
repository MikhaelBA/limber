import {
  ATLAS_MAX_PIXELS,
  ATLAS_MAX_REGIONS,
  atlasFail,
  atlasInteger,
  validateImageSize,
  type AtlasRasterInput,
  type AtlasRasterOptions,
  type PreparedAtlasImage,
  type AtlasRect,
  type AtlasLayout,
  type AtlasPagePixels,
  type AtlasWorkStats,
} from './model';
function validatePixels(image: AtlasRasterInput): void {
  validateImageSize(image);
  if (
    !(image.pixels instanceof Uint8Array || image.pixels instanceof Uint8ClampedArray) ||
    image.pixels.length !== image.width * image.height * 4
  )
    atlasFail('ATLAS_INVALID_PIXELS', image.id, 'Image needs exactly four RGBA8 bytes per pixel.');
}

/** Trim changes stored pixels, never logical source dimensions or authored UV/geometry data. */
export function prepareAtlasImage(
  input: AtlasRasterInput,
  options: AtlasRasterOptions = {},
  stats?: AtlasWorkStats,
): PreparedAtlasImage {
  validatePixels(input);
  const scale = options.scale ?? 1,
    sampling = options.sampling ?? 'bilinear';
  if (!Number.isFinite(scale) || scale <= 0 || scale > 16)
    atlasFail('ATLAS_INVALID_INPUT', input.id, 'Export scale must be finite, positive and at most sixteen.');
  if (!['nearest', 'bilinear'].includes(sampling))
    atlasFail('ATLAS_INVALID_INPUT', input.id, 'Unsupported RGBA sampling mode.');
  for (const flag of [input.trim, options.trim])
    if (flag !== undefined && typeof flag !== 'boolean')
      atlasFail('ATLAS_INVALID_INPUT', input.id, 'Image trim flags must be boolean.');
  const trim = (options.trim ?? true) && input.trim !== false;
  let left = input.width,
    top = input.height,
    right = -1,
    bottom = -1;
  if (trim) {
    for (let y = 0; y < input.height; y++)
      for (let x = 0; x < input.width; x++) {
        if (stats) stats.pixelsScanned++;
        if (input.pixels[(y * input.width + x) * 4 + 3]! === 0) continue;
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
  } else {
    left = top = 0;
    right = input.width - 1;
    bottom = input.height - 1;
  }
  const empty = right < left,
    crop: AtlasRect = empty
      ? { x: 0, y: 0, width: 1, height: 1 }
      : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
  const width = Math.max(1, Math.ceil(crop.width * scale)),
    height = Math.max(1, Math.ceil(crop.height * scale));
  validateImageSize({ id: input.id, width, height });
  const pixels = new Uint8Array(width * height * 4);
  if (!empty)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const target = (y * width + x) * 4;
        if (stats) stats.resizedPixels++;
        if (sampling === 'nearest' || (width === crop.width && height === crop.height)) {
          const xx = crop.x + Math.min(crop.width - 1, Math.floor(((x + 0.5) * crop.width) / width)),
            yy = crop.y + Math.min(crop.height - 1, Math.floor(((y + 0.5) * crop.height) / height)),
            source = (yy * input.width + xx) * 4;
          for (let c = 0; c < 4; c++) pixels[target + c] = input.pixels[source + c]!;
        } else {
          const xx = Math.max(0, Math.min(crop.width - 1, ((x + 0.5) * crop.width) / width - 0.5)),
            yy = Math.max(0, Math.min(crop.height - 1, ((y + 0.5) * crop.height) / height - 0.5)),
            x0 = Math.floor(xx),
            y0 = Math.floor(yy),
            dx = xx - x0,
            dy = yy - y0;
          let alpha = 0,
            red = 0,
            green = 0,
            blue = 0;
          for (let row = 0; row < 2; row++)
            for (let column = 0; column < 2; column++) {
              const sx = crop.x + Math.min(crop.width - 1, x0 + column),
                sy = crop.y + Math.min(crop.height - 1, y0 + row),
                offset = (sy * input.width + sx) * 4,
                weight = (column ? dx : 1 - dx) * (row ? dy : 1 - dy),
                weightedAlpha = (input.pixels[offset + 3]! / 255) * weight;
              alpha += weightedAlpha;
              red += input.pixels[offset]! * weightedAlpha;
              green += input.pixels[offset + 1]! * weightedAlpha;
              blue += input.pixels[offset + 2]! * weightedAlpha;
            }
          pixels[target] = alpha ? Math.round(red / alpha) : 0;
          pixels[target + 1] = alpha ? Math.round(green / alpha) : 0;
          pixels[target + 2] = alpha ? Math.round(blue / alpha) : 0;
          pixels[target + 3] = Math.round(alpha * 255);
        }
      }
  return {
    id: input.id,
    width,
    height,
    pixels,
    sourceWidth: input.width,
    sourceHeight: input.height,
    crop,
    scale,
    empty,
  };
}

/** RGBA8 page composition with clockwise rotation and edge extrusion across the complete gutter. */
export function compositeAtlasPages(
  images: readonly AtlasRasterInput[],
  layout: AtlasLayout,
  stats?: AtlasWorkStats,
): AtlasPagePixels[] {
  if (
    !Array.isArray(images) ||
    images.length > ATLAS_MAX_REGIONS ||
    !layout ||
    !Array.isArray(layout.pages) ||
    layout.pages.length > 64 ||
    !Array.isArray(layout.placements) ||
    layout.placements.length !== images.length
  )
    atlasFail(
      'ATLAS_INVALID_LAYOUT',
      null,
      'Layout needs bounded pages and exactly one placement per image.',
    );
  const byId = new Map<string, AtlasRasterInput>();
  let inputPixels = 0;
  for (const image of images) {
    validatePixels(image);
    inputPixels += image.width * image.height;
    if (inputPixels > 4 * ATLAS_MAX_PIXELS)
      atlasFail('ATLAS_PIXEL_BUDGET', null, 'Prepared image memory exceeds the composition budget.');
    if (byId.has(image.id)) atlasFail('ATLAS_DUPLICATE_ID', image.id, 'Image IDs must be unique.');
    byId.set(image.id, image);
  }
  atlasInteger(layout.padding, 0, 64, 'atlas padding');
  let total = 0;
  for (const [index, page] of layout.pages.entries()) {
    validateImageSize({ id: `page-${index}`, ...page });
    total += page.width * page.height;
    if (total > 4 * ATLAS_MAX_PIXELS)
      atlasFail('ATLAS_PIXEL_BUDGET', null, 'Page composition exceeds its hard RGBA memory limit.');
  }
  const seen = new Set<string>();
  const occupied: AtlasRect[][] = layout.pages.map(() => []);
  for (const placement of layout.placements) {
    atlasInteger(placement.page, 0, layout.pages.length - 1, 'region page', placement.id);
    const image = byId.get(placement.id),
      page = layout.pages[placement.page];
    if (!image || !page || seen.has(placement.id))
      atlasFail('ATLAS_INVALID_LAYOUT', placement.id, 'Every image needs one valid page placement.');
    seen.add(placement.id);
    if (typeof placement.rotated !== 'boolean')
      atlasFail('ATLAS_INVALID_LAYOUT', placement.id, 'Region rotation must be boolean.');
    for (const [key, value] of Object.entries({
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: placement.height,
    }))
      atlasInteger(value, key === 'x' || key === 'y' ? 0 : 1, 16384, `region ${key}`, placement.id);
    if (
      placement.width !== (placement.rotated ? image.height : image.width) ||
      placement.height !== (placement.rotated ? image.width : image.height) ||
      placement.x < layout.padding ||
      placement.y < layout.padding ||
      placement.x + placement.width + layout.padding > page.width ||
      placement.y + placement.height + layout.padding > page.height
    )
      atlasFail(
        'ATLAS_INVALID_LAYOUT',
        placement.id,
        'Region/gutter dimensions must match the prepared image and fit the page.',
      );
    occupied[placement.page]!.push({
      x: placement.x - layout.padding,
      y: placement.y - layout.padding,
      width: placement.width + 2 * layout.padding,
      height: placement.height + 2 * layout.padding,
    });
  }
  if (seen.size !== byId.size) atlasFail('ATLAS_INVALID_LAYOUT', null, 'Layout omitted a prepared image.');
  // Preflight gutters as well as frames before allocating or changing work counters.
  // The region count bounds the worst-case comparisons to fewer than 8.4 million.
  for (const regions of occupied) {
    regions.sort((a, b) => a.x - b.x || a.y - b.y);
    for (let i = 0; i < regions.length; i++) {
      const a = regions[i]!;
      for (let j = i + 1; j < regions.length; j++) {
        const b = regions[j]!;
        if (b.x >= a.x + a.width) break;
        if (a.y < b.y + b.height && b.y < a.y + a.height)
          atlasFail('ATLAS_INVALID_LAYOUT', null, 'Atlas frames or their extruded gutters overlap.');
      }
    }
  }
  const pages = layout.pages.map((page, index) => ({
    id: `page-${index}`,
    width: page.width,
    height: page.height,
    pixels: new Uint8Array(page.width * page.height * 4),
    premultiplied: false as const,
  }));
  for (const placement of layout.placements) {
    const image = byId.get(placement.id)!,
      page = pages[placement.page]!;
    for (let y = -layout.padding; y < placement.height + layout.padding; y++)
      for (let x = -layout.padding; x < placement.width + layout.padding; x++) {
        const xx = Math.max(0, Math.min(placement.width - 1, x)),
          yy = Math.max(0, Math.min(placement.height - 1, y)),
          sx = placement.rotated ? yy : xx,
          sy = placement.rotated ? image.height - 1 - xx : yy,
          source = (sy * image.width + sx) * 4,
          target = ((placement.y + y) * page.width + placement.x + x) * 4;
        for (let c = 0; c < 4; c++) page.pixels[target + c] = image.pixels[source + c]!;
        if (stats) stats.compositedPixels++;
      }
  }
  return pages;
}
