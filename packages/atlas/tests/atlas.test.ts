import { describe, expect, it } from 'vitest';
import {
  AtlasError,
  packAtlasRegions,
  prepareAtlasImage,
  compositeAtlasPages,
  createAtlasWorkStats,
  type AtlasImageSize,
  type AtlasLayout,
  type AtlasRasterInput,
} from '../src';

const pixel = (bytes: Uint8Array, width: number, x: number, y: number) =>
  Array.from(bytes.slice((y * width + x) * 4, (y * width + x + 1) * 4));
function image(id: string, width: number, height: number): AtlasRasterInput {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      pixels.set([x % 256, y % 256, (id.charCodeAt(0) + x + y) % 256, 255], (y * width + x) * 4);
  return { id, width, height, pixels };
}
function error(run: () => unknown, code: string) {
  try {
    run();
  } catch (e) {
    expect(e).toBeInstanceOf(AtlasError);
    expect((e as AtlasError).code).toBe(code);
    expect((e as AtlasError).remedy.length).toBeGreaterThan(0);
    return;
  }
  throw new Error(`Expected ${code}`);
}
function proveLayout(input: AtlasImageSize[], layout: AtlasLayout, maxWidth: number, maxHeight: number) {
  expect(layout.placements.map((p) => p.id)).toEqual(input.map((p) => p.id).sort());
  for (const p of layout.placements) {
    const source = input.find((i) => i.id === p.id)!;
    expect([p.width, p.height]).toEqual(
      p.rotated ? [source.height, source.width] : [source.width, source.height],
    );
    const page = layout.pages[p.page]!;
    expect(p.x).toBeGreaterThanOrEqual(layout.padding);
    expect(p.y).toBeGreaterThanOrEqual(layout.padding);
    expect(p.x + p.width + layout.padding).toBeLessThanOrEqual(page.width);
    expect(p.y + p.height + layout.padding).toBeLessThanOrEqual(page.height);
    expect(page.width).toBeLessThanOrEqual(maxWidth);
    expect(page.height).toBeLessThanOrEqual(maxHeight);
    for (const q of layout.placements) {
      if (q === p || q.page !== p.page) continue;
      expect(
        p.x + p.width + 2 * layout.padding <= q.x ||
          q.x + q.width + 2 * layout.padding <= p.x ||
          p.y + p.height + 2 * layout.padding <= q.y ||
          q.y + q.height + 2 * layout.padding <= p.y,
      ).toBe(true);
    }
  }
}

describe('portable atlas layout', () => {
  it('has deterministic page/ID ties independent of locale, input order and caller mutation', () => {
    const input = ['ä', 'Z', 'A', '😀'].map((id) => ({ id, width: 3, height: 3 }));
    const before = structuredClone(input),
      options = { maxWidth: 8, maxHeight: 8, padding: 0 };
    const result = packAtlasRegions(input, options);
    expect(result.placements.map((p) => p.id)).toEqual(['A', 'Z', 'ä', '😀']);
    expect(result).toEqual(packAtlasRegions([...input].reverse(), options));
    expect(input).toEqual(before);
    proveLayout(input, result, 8, 8);
    expect(packAtlasRegions([])).toEqual({ pages: [], placements: [], padding: 2 });
  });

  it('supports rotation only when requested and accounts for gutters in fit', () => {
    const source = [{ id: 'wide', width: 5, height: 2 }];
    const options = { maxWidth: 4, maxHeight: 7, padding: 1, powerOfTwo: false };
    error(() => packAtlasRegions(source, options), 'ATLAS_IMAGE_TOO_LARGE');
    expect(packAtlasRegions(source, { ...options, allowRotation: true })).toEqual({
      pages: [{ width: 4, height: 7 }],
      padding: 1,
      placements: [{ id: 'wide', page: 0, x: 1, y: 1, width: 2, height: 5, rotated: true }],
    });
  });

  it('never rounds power-of-two pages past host caps and enforces page/pixel budgets', () => {
    error(
      () => packAtlasRegions([{ id: 'x', width: 9, height: 1 }], { maxWidth: 15, padding: 0 }),
      'ATLAS_IMAGE_TOO_LARGE',
    );
    const input = [
      { id: 'a', width: 7, height: 7 },
      { id: 'b', width: 7, height: 7 },
    ];
    const options = { maxWidth: 8, maxHeight: 8, padding: 0 };
    expect(packAtlasRegions(input, options).pages).toEqual([
      { width: 8, height: 8 },
      { width: 8, height: 8 },
    ]);
    error(() => packAtlasRegions(input, { ...options, maxPages: 1 }), 'ATLAS_PAGE_BUDGET');
    error(() => packAtlasRegions(input, { ...options, maxPixels: 127 }), 'ATLAS_PIXEL_BUDGET');
    expect(packAtlasRegions(input, { ...options, maxPixels: 128 }).pages).toHaveLength(2);
  });

  it('rejects invalid dimensions, identities, counts and options with actionable codes', () => {
    for (const width of [0, -1, 0.5, NaN, Infinity, 16385])
      error(() => packAtlasRegions([{ id: 'bad', width, height: 1 }]), 'ATLAS_INVALID_INPUT');
    error(() => packAtlasRegions([{ id: '', width: 1, height: 1 }]), 'ATLAS_INVALID_INPUT');
    error(() => packAtlasRegions([{ id: 'huge', width: 16384, height: 16384 }]), 'ATLAS_PIXEL_BUDGET');
    error(
      () =>
        packAtlasRegions([
          { id: 'x', width: 1, height: 1 },
          { id: 'x', width: 2, height: 2 },
        ]),
      'ATLAS_DUPLICATE_ID',
    );
    error(
      () => packAtlasRegions(Array.from({ length: 4097 }, (_, i) => ({ id: `${i}`, width: 1, height: 1 }))),
      'ATLAS_REGION_BUDGET',
    );
    for (const options of [
      { padding: -1 },
      { padding: 65 },
      { maxPages: 65 },
      { maxPixels: 0 },
      { maxWidth: NaN },
      { allowRotation: 'yes' },
    ])
      error(
        () => packAtlasRegions([], options as Parameters<typeof packAtlasRegions>[1]),
        'ATLAS_INVALID_INPUT',
      );
  });

  it('proves occupancy/gutter bounds and pixel orientation across 100 seeded heterogeneous jobs', () => {
    let seed = 127;
    const random = (max: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % max;
    };
    for (let run = 0; run < 100; run++) {
      const inputs = Array.from({ length: 8 + random(30) }, (_, i) =>
        image(`image-${i}`, 1 + random(25), 1 + random(25)),
      );
      const options = {
        maxWidth: 64,
        maxHeight: 64,
        padding: random(4),
        allowRotation: true,
        powerOfTwo: run % 2 === 0,
      };
      const layout = packAtlasRegions(inputs, options),
        pages = compositeAtlasPages(inputs, layout);
      expect(layout).toEqual(packAtlasRegions([...inputs].reverse(), options));
      proveLayout(inputs, layout, 64, 64);
      for (const p of layout.placements) {
        const source = inputs.find((i) => i.id === p.id)!,
          page = pages[p.page]!;
        for (const [x, y] of [
          [0, 0],
          [p.width - 1, 0],
          [0, p.height - 1],
          [p.width - 1, p.height - 1],
        ]) {
          const sx = p.rotated ? y! : x!,
            sy = p.rotated ? source.height - 1 - x! : y!;
          expect(pixel(page.pixels, page.width, p.x + x!, p.y + y!)).toEqual(
            pixel(source.pixels as Uint8Array, source.width, sx, sy),
          );
        }
      }
    }
  });
});

describe('portable RGBA atlas preparation', () => {
  it('retains faint alpha and logical dimensions, detaches exact unscaled pixels and respects per-image trim locks', () => {
    const input = image('trim', 5, 4);
    input.pixels.fill(0);
    input.pixels.set([10, 20, 30, 1], (1 * 5 + 2) * 4);
    input.pixels.set([40, 50, 60, 128], (2 * 5 + 3) * 4);
    const before = new Uint8Array(input.pixels),
      stats = createAtlasWorkStats();
    const result = prepareAtlasImage(input, {}, stats);
    expect(result).toMatchObject({
      width: 2,
      height: 2,
      sourceWidth: 5,
      sourceHeight: 4,
      crop: { x: 2, y: 1, width: 2, height: 2 },
      scale: 1,
      empty: false,
    });
    expect(Array.from(result.pixels)).toEqual([10, 20, 30, 1, 0, 0, 0, 0, 0, 0, 0, 0, 40, 50, 60, 128]);
    expect(stats).toMatchObject({ pixelsScanned: 20, resizedPixels: 4 });
    result.pixels.fill(99);
    expect(input.pixels).toEqual(before);
    expect(prepareAtlasImage({ ...input, trim: false }, { trim: true })).toMatchObject({
      width: 5,
      height: 4,
      crop: { x: 0, y: 0, width: 5, height: 4 },
    });
    expect(prepareAtlasImage(input, { trim: false }).width).toBe(5);
  });

  it('represents an entirely transparent trimmed image with one transparent pixel', () => {
    const input = image('empty', 4, 3);
    input.pixels.fill(0);
    input.pixels[0] = 255; // Invisible RGB is not content.
    expect(prepareAtlasImage(input)).toMatchObject({
      empty: true,
      width: 1,
      height: 1,
      sourceWidth: 4,
      sourceHeight: 3,
      crop: { x: 0, y: 0, width: 1, height: 1 },
      pixels: new Uint8Array(4),
    });
  });

  it('samples bilinear colors through premultiplied intermediates without transparent RGB bleeding', () => {
    const input = { id: 'edge', width: 2, height: 1, pixels: new Uint8Array([255, 0, 0, 0, 0, 0, 255, 255]) };
    const result = prepareAtlasImage(input, { trim: false, scale: 0.5 });
    expect([result.width, result.height]).toEqual([1, 1]);
    expect(Array.from(result.pixels)).toEqual([0, 0, 255, 128]);
    expect(
      Array.from(prepareAtlasImage(input, { trim: false, scale: 0.5, sampling: 'nearest' }).pixels),
    ).toEqual([0, 0, 255, 255]);
    expect(prepareAtlasImage(image('odd', 3, 5), { scale: 0.5, trim: false })).toMatchObject({
      width: 2,
      height: 3,
      sourceWidth: 3,
      sourceHeight: 5,
    });
  });

  it('rejects malformed buffers, flags and scales before output allocation', () => {
    error(
      () => prepareAtlasImage({ ...image('x', 2, 2), pixels: new Uint8Array(3) }),
      'ATLAS_INVALID_PIXELS',
    );
    for (const scale of [0, -1, NaN, Infinity, 17])
      error(() => prepareAtlasImage(image('x', 1, 1), { scale }), 'ATLAS_INVALID_INPUT');
    error(
      () => prepareAtlasImage(image('x', 1, 1), { trim: 1 } as unknown as { trim: boolean }),
      'ATLAS_INVALID_INPUT',
    );
    error(
      () => prepareAtlasImage(image('x', 1, 1), { sampling: 'fake' } as unknown as { sampling: 'nearest' }),
      'ATLAS_INVALID_INPUT',
    );
    error(() => prepareAtlasImage(image('x', 1025, 1), { scale: 16, trim: false }), 'ATLAS_INVALID_INPUT');
  });

  it('composes exact clockwise pixel rows, extrudes edge/corner gutters and leaves unused pixels transparent', () => {
    const input = {
      id: 'six',
      width: 3,
      height: 2,
      pixels: new Uint8Array([
        1, 0, 0, 255, 2, 0, 0, 255, 3, 0, 0, 255, 4, 0, 0, 255, 5, 0, 0, 255, 6, 0, 0, 255,
      ]),
    };
    const layout: AtlasLayout = {
      padding: 1,
      pages: [{ width: 5, height: 6 }],
      placements: [{ id: 'six', page: 0, x: 1, y: 1, width: 2, height: 3, rotated: true }],
    };
    const stats = createAtlasWorkStats(),
      page = compositeAtlasPages([input], layout, stats)[0]!;
    const rows = Array.from({ length: 5 }, (_, y) =>
      Array.from({ length: 4 }, (_, x) => pixel(page.pixels, 5, x, y)[0]),
    );
    expect(rows).toEqual([
      [4, 4, 1, 1],
      [4, 4, 1, 1],
      [5, 5, 2, 2],
      [6, 6, 3, 3],
      [6, 6, 3, 3],
    ]);
    expect(pixel(page.pixels, 5, 4, 5)).toEqual([0, 0, 0, 0]);
    expect(page.premultiplied).toBe(false);
    expect(stats.compositedPixels).toBe(20);
    expect(Array.from(input.pixels).filter((_, i) => i % 4 === 0)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('rejects malformed placements, missing/duplicate images and overlapping gutters before touching counters', () => {
    const inputs = [image('a', 1, 1), image('b', 1, 1)];
    const valid = packAtlasRegions(inputs, { padding: 1, maxWidth: 8, maxHeight: 8 });
    const invalid: AtlasLayout[] = [];
    for (const change of [{ x: -1 }, { page: 0.5 }, { width: 2 }, { rotated: 'yes' }, { x: 7 }]) {
      const layout = structuredClone(valid);
      Object.assign(layout.placements[0]!, change);
      invalid.push(layout);
    }
    const duplicate = structuredClone(valid);
    duplicate.placements[1] = { ...duplicate.placements[0]! };
    invalid.push(duplicate);
    const missing = structuredClone(valid);
    missing.placements.pop();
    invalid.push(missing);
    const overlap = structuredClone(valid);
    overlap.placements[1] = { ...overlap.placements[0]!, id: 'b', x: overlap.placements[0]!.x + 1 };
    invalid.push(overlap);
    for (const layout of invalid) {
      const stats = createAtlasWorkStats();
      expect(() => compositeAtlasPages(inputs, layout, stats)).toThrow(AtlasError);
      expect(stats).toEqual(createAtlasWorkStats());
    }
    error(() => compositeAtlasPages([inputs[0]!, inputs[0]!], valid), 'ATLAS_DUPLICATE_ID');
    expect(compositeAtlasPages([], packAtlasRegions([]))).toEqual([]);
    const pages = Array.from({ length: 5 }, () => ({ width: 8192, height: 8192 }));
    error(() => compositeAtlasPages([], { pages, placements: [], padding: 0 }), 'ATLAS_PIXEL_BUDGET');
  });
});
