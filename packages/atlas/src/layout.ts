import {
  ATLAS_MAX_DIMENSION,
  ATLAS_MAX_REGIONS,
  ATLAS_MAX_PIXELS,
  atlasFail,
  atlasInteger,
  validateImageSize,
  compareAtlasId,
  type AtlasRect,
  type AtlasImageSize,
  type AtlasLayout,
  type AtlasLayoutOptions,
  type AtlasPlacement,
  type AtlasWorkStats,
} from './model';

interface Page {
  free: AtlasRect[];
  usedWidth: number;
  usedHeight: number;
}
interface Candidate {
  page: number;
  rect: AtlasRect;
  width: number;
  height: number;
  rotated: boolean;
  short: number;
  long: number;
}
function contains(a: AtlasRect, b: AtlasRect): boolean {
  return a.x <= b.x && a.y <= b.y && a.x + a.width >= b.x + b.width && a.y + a.height >= b.y + b.height;
}
function intersects(a: AtlasRect, b: AtlasRect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
function powerFloor(value: number): number {
  return 2 ** Math.floor(Math.log2(value));
}
function powerCeil(value: number): number {
  return 2 ** Math.ceil(Math.log2(value));
}
function better(a: Candidate, b: Candidate | null): boolean {
  if (!b) return true;
  const aa = [a.short, a.long, a.page, a.rect.y, a.rect.x, Number(a.rotated)],
    bb = [b.short, b.long, b.page, b.rect.y, b.rect.x, Number(b.rotated)];
  for (let i = 0; i < aa.length; i++) if (aa[i] !== bb[i]) return aa[i]! < bb[i]!;
  return false;
}

/** Bounded best-short-side MaxRects layout. Output is independent of input enumeration order. */
export function packAtlasRegions(
  images: readonly AtlasImageSize[],
  options: AtlasLayoutOptions = {},
  stats?: AtlasWorkStats,
): AtlasLayout {
  const maxWidth = options.maxWidth ?? 2048,
    maxHeight = options.maxHeight ?? 2048,
    maxPages = options.maxPages ?? 16,
    maxPixels = options.maxPixels ?? ATLAS_MAX_PIXELS,
    padding = options.padding ?? 2;
  atlasInteger(maxWidth, 1, ATLAS_MAX_DIMENSION, 'maximum page width');
  atlasInteger(maxHeight, 1, ATLAS_MAX_DIMENSION, 'maximum page height');
  atlasInteger(maxPages, 1, 64, 'maximum page count');
  atlasInteger(maxPixels, 1, 4 * ATLAS_MAX_PIXELS, 'atlas pixel budget');
  atlasInteger(padding, 0, 64, 'atlas padding');
  for (const value of [options.allowRotation, options.powerOfTwo])
    if (value !== undefined && typeof value !== 'boolean')
      atlasFail('ATLAS_INVALID_INPUT', null, 'Atlas flags must be boolean.');
  if (images.length > ATLAS_MAX_REGIONS)
    atlasFail(
      'ATLAS_REGION_BUDGET',
      null,
      'Too many logical images for one atlas job.',
      'Split the export into smaller assets.',
    );
  const ids = new Set<string>();
  for (const image of images) {
    validateImageSize(image);
    if (ids.has(image.id)) atlasFail('ATLAS_DUPLICATE_ID', image.id, 'Logical image IDs must be unique.');
    ids.add(image.id);
  }
  const pot = options.powerOfTwo ?? true,
    width = pot ? powerFloor(maxWidth) : maxWidth,
    height = pot ? powerFloor(maxHeight) : maxHeight;
  const sorted = [...images].sort(
    (a, b) =>
      Math.max(b.width, b.height) - Math.max(a.width, a.height) ||
      b.width * b.height - a.width * a.height ||
      compareAtlasId(a.id, b.id),
  );
  const pages: Page[] = [],
    placements: AtlasPlacement[] = [];
  let work = 0;
  const visit = () => {
    if (++work > 8_000_000)
      atlasFail(
        'ATLAS_WORK_BUDGET',
        null,
        'Atlas rectangle search exceeded its bounded work budget.',
        'Split the export or reduce the number of regions.',
      );
  };
  for (const image of sorted) {
    let best: Candidate | null = null;
    const find = (page: number) => {
      for (const rect of pages[page]!.free)
        for (const rotated of options.allowRotation && image.width !== image.height
          ? [false, true]
          : [false]) {
          visit();
          if (stats) stats.fitTests++;
          const w = (rotated ? image.height : image.width) + 2 * padding,
            h = (rotated ? image.width : image.height) + 2 * padding;
          if (w > rect.width || h > rect.height) continue;
          const dx = rect.width - w,
            dy = rect.height - h,
            candidate: Candidate = {
              page,
              rect,
              width: w,
              height: h,
              rotated,
              short: Math.min(dx, dy),
              long: Math.max(dx, dy),
            };
          if (better(candidate, best)) best = candidate;
        }
    };
    for (let page = 0; page < pages.length; page++) find(page);
    if (!best) {
      if (
        !(image.width + 2 * padding <= width && image.height + 2 * padding <= height) &&
        !(options.allowRotation && image.height + 2 * padding <= width && image.width + 2 * padding <= height)
      )
        atlasFail(
          'ATLAS_IMAGE_TOO_LARGE',
          image.id,
          'Image plus padding cannot fit the configured page.',
          'Reduce export scale/padding or increase maximum page dimensions.',
        );
      if (pages.length >= maxPages)
        atlasFail(
          'ATLAS_PAGE_BUDGET',
          image.id,
          'Images require more atlas pages than allowed.',
          'Reduce scale or increase page dimensions/count.',
        );
      pages.push({ free: [{ x: 0, y: 0, width, height }], usedWidth: 0, usedHeight: 0 });
      find(pages.length - 1);
    }
    // TypeScript cannot track assignment through the search closure.
    const chosen = best as Candidate | null;
    if (!chosen) atlasFail('ATLAS_INTERNAL_LAYOUT', image.id, 'A fitting image did not receive a placement.');
    const page = pages[chosen.page]!,
      used: AtlasRect = { x: chosen.rect.x, y: chosen.rect.y, width: chosen.width, height: chosen.height },
      split: AtlasRect[] = [];
    for (const rect of page.free) {
      if (!intersects(rect, used)) {
        split.push(rect);
        continue;
      }
      if (used.x > rect.x) split.push({ ...rect, width: used.x - rect.x });
      if (used.x + used.width < rect.x + rect.width)
        split.push({ ...rect, x: used.x + used.width, width: rect.x + rect.width - used.x - used.width });
      if (used.y > rect.y) split.push({ ...rect, height: used.y - rect.y });
      if (used.y + used.height < rect.y + rect.height)
        split.push({ ...rect, y: used.y + used.height, height: rect.y + rect.height - used.y - used.height });
    }
    const removed = new Set<number>();
    for (let i = 0; i < split.length; i++) {
      if (removed.has(i)) continue;
      for (let j = i + 1; j < split.length; j++) {
        if (removed.has(j)) continue;
        visit();
        if (stats) stats.pruneTests++;
        if (contains(split[i]!, split[j]!)) removed.add(j);
        else if (contains(split[j]!, split[i]!)) {
          removed.add(i);
          break;
        }
      }
    }
    page.free = split.filter((_, index) => !removed.has(index));
    page.usedWidth = Math.max(page.usedWidth, used.x + used.width);
    page.usedHeight = Math.max(page.usedHeight, used.y + used.height);
    placements.push({
      id: image.id,
      page: chosen.page,
      rotated: chosen.rotated,
      x: used.x + padding,
      y: used.y + padding,
      width: chosen.width - 2 * padding,
      height: chosen.height - 2 * padding,
    });
  }
  const sizes = pages.map((page) => ({
    width: pot ? powerCeil(page.usedWidth) : page.usedWidth,
    height: pot ? powerCeil(page.usedHeight) : page.usedHeight,
  }));
  for (const [index, page] of sizes.entries()) validateImageSize({ id: `page-${index}`, ...page });
  if (sizes.reduce((sum, page) => sum + page.width * page.height, 0) > maxPixels)
    atlasFail(
      'ATLAS_PIXEL_BUDGET',
      null,
      'Packed page memory exceeds the configured pixel budget.',
      'Reduce scale, region count, padding or power-of-two waste.',
    );
  return { pages: sizes, placements: placements.sort((a, b) => compareAtlasId(a.id, b.id)), padding };
}
