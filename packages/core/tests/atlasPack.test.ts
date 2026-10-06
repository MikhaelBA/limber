import { describe, expect, it } from 'vitest';
import { buildAtlasText, packAtlas, uniqueTexturePaths } from '../src/serialization/atlasPack';

describe('packAtlas (shelf packer)', () => {
  it('packs same-height images side by side in one shelf (padding between)', () => {
    const layout = packAtlas(
      [
        { name: 'a', width: 100, height: 40 },
        { name: 'b', width: 50, height: 40 },
      ],
      { powerOfTwo: false },
    );
    expect(layout.placements).toHaveLength(2);
    const a = layout.placements[0]!;
    const b = layout.placements[1]!;
    expect(a).toMatchObject({ x: 2, y: 2, width: 100, height: 40 });
    expect(b.x).toBe(2 + 100 + 2); // padding gutter.
    expect(b.y).toBe(2); // same shelf.
    // usedW = 2 + 100 + 2 + 50 + 2 = 156; usedH = 2 + 40 + 2 = 44.
    expect(layout.width).toBe(156);
    expect(layout.height).toBe(44);
  });

  it('starts a new shelf for a taller image and sorts tallest-first', () => {
    const layout = packAtlas(
      [
        { name: 'small', width: 30, height: 10 },
        { name: 'tall', width: 20, height: 50 },
      ],
      { powerOfTwo: false },
    );
    const tall = layout.placements.find((p) => p.name === 'tall')!;
    const small = layout.placements.find((p) => p.name === 'small')!;
    expect(tall).toMatchObject({ x: 2, y: 2 });
    expect(small.y).toBe(2); // Same shelf — small fits next to tall.
    expect(small.x).toBe(2 + 20 + 2);
    // A shelf-breaking case: wide images wrap.
    const wrapped = packAtlas(
      [
        { name: 'w1', width: 60, height: 10 },
        { name: 'w2', width: 60, height: 10 },
      ],
      { powerOfTwo: false, maxWidth: 80 },
    );
    const w2 = wrapped.placements.find((p) => p.name === 'w2')!;
    expect(w2.y).toBe(2 + 10 + 2); // new shelf
    expect(w2.x).toBe(2);
  });

  it('rounds up to power-of-two by default', () => {
    const layout = packAtlas([{ name: 'a', width: 100, height: 100 }]);
    // used 104×104 → 128×128.
    expect(layout.width).toBe(128);
    expect(layout.height).toBe(128);
  });

  it('returns placements in INPUT order (compose by name)', () => {
    const layout = packAtlas(
      [
        { name: 'z', width: 10, height: 10 },
        { name: 'a', width: 10, height: 20 },
      ],
      { powerOfTwo: false },
    );
    expect(layout.placements.map((p) => p.name)).toEqual(['z', 'a']);
  });

  it('empty input yields an empty layout', () => {
    const layout = packAtlas([]);
    expect(layout).toEqual({ width: 0, height: 0, placements: [] });
  });

  it('throws when an image cannot fit the cap', () => {
    expect(() => packAtlas([{ name: 'huge', width: 9000, height: 10 }])).toThrow(/cannot fit/);
    expect(() =>
      packAtlas(
        Array.from({ length: 400 }, (_, i) => ({ name: `t${i}`, width: 512, height: 512 })),
      ),
    ).toThrow(/exceeds/);
  });
});

describe('uniqueTexturePaths', () => {
  it('strips extensions and uniquifies collisions with numeric suffixes', () => {
    const paths = uniqueTexturePaths({
      t1: { name: 'head.png', source: 'embedded' },
      t2: { name: 'head.png', source: 'embedded' },
      t3: { name: 'arm', source: 'embedded' },
    });
    expect(paths.get('t1')).toBe('head');
    expect(paths.get('t2')).toBe('head2');
    expect(paths.get('t3')).toBe('arm');
  });
});

describe('buildAtlasText', () => {
  it('emits the Spine 4.1 format: leading blank line, size, bounds', () => {
    const layout = packAtlas([{ name: 'head', width: 60, height: 30 }], { powerOfTwo: false });
    const text = buildAtlasText('atlas', layout);
    const lines = text.split('\n');
    expect(lines[0]).toBe('');
    expect(lines[1]).toBe('atlas.png');
    expect(lines[2]).toBe('size: 64,34');
    expect(lines[3]).toBe('filter: Linear,Linear');
    expect(lines[4]).toBe('pma: false');
    expect(lines[5]).toBe('head');
    expect(lines[6]).toBe('  bounds: 2,2,60,30');
    expect(text.endsWith('\n')).toBe(true);
  });
});
