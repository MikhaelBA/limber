import type { AssetManifest } from '../types/document';

/**
 * Texture-atlas layout (shelf packer) + the Spine 4.1 `.atlas` text format.
 *
 * Pure math/text — no DOM — so it's unit-testable in core. The editor layer
 * composites pixels (canvas) using the layout this produces.
 *
 * Shelf packing: images sorted by height (desc), placed left→right in rows;
 * a taller image than the current row's height starts a new row. No rotation
 * (mesh UVs are authored unrotated; keeping regions axis-aligned avoids a
 * whole class of runtime UV bugs). Sizes round up to power-of-two.
 */

export interface AtlasImageInput {
  name: string;
  width: number;
  height: number;
}

export interface AtlasPlacement {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AtlasLayout {
  width: number;
  height: number;
  placements: AtlasPlacement[];
}

export interface PackAtlasOptions {
  /** Gutter between/before regions — bleed guard for Linear filtering. */
  padding?: number;
  /** Round the final size up to power-of-two dimensions. Default true. */
  powerOfTwo?: boolean;
  maxWidth?: number;
  maxHeight?: number;
}

const DEFAULT_MAX = 8192;

function nextPow2(v: number): number {
  let p = 1;
  while (p < v) p *= 2;
  return p;
}

/** Lays images out on an atlas. Throws when a single image can't fit. */
export function packAtlas(images: AtlasImageInput[], opts: PackAtlasOptions = {}): AtlasLayout {
  const padding = opts.padding ?? 2;
  const pot = opts.powerOfTwo ?? true;
  const maxWidth = opts.maxWidth ?? DEFAULT_MAX;
  const maxHeight = opts.maxHeight ?? DEFAULT_MAX;

  // Tallest first keeps shelf fragmentation low (classic heuristic).
  const sorted = [...images].sort((a, b) => b.height - a.height || b.width - a.width);
  if (sorted.length === 0) return { width: 0, height: 0, placements: [] };

  const placements: AtlasPlacement[] = [];
  let shelfY = padding;
  let shelfH = 0;
  let x = padding;
  let usedW = padding;

  for (const img of sorted) {
    if (img.width + 2 * padding > maxWidth || img.height + 2 * padding > maxHeight) {
      throw new Error(
        `Texture "${img.name}" (${img.width}×${img.height}) cannot fit in an atlas capped at ${maxWidth}×${maxHeight}.`,
      );
    }
    if (shelfH > 0 && x + img.width + padding > maxWidth) {
      // Row full (or over cap): wrap to a new shelf.
      shelfY += shelfH + padding;
      shelfH = 0;
      x = padding;
    }
    const y = shelfY;
    placements.push({ name: img.name, x, y, width: img.width, height: img.height });
    x += img.width + padding;
    usedW = Math.max(usedW, x);
    shelfH = Math.max(shelfH, img.height);
  }

  const usedH = sorted.length > 0 ? shelfY + shelfH + padding : 0;
  const width = pot ? nextPow2(usedW) : Math.ceil(usedW);
  const height = pot ? nextPow2(usedH) : Math.ceil(usedH);
  if (width > maxWidth || height > maxHeight) {
    throw new Error(
      `Packed atlas (${width}×${height}) exceeds the ${maxWidth}×${maxHeight} cap — split your textures.`,
    );
  }
  // Present in input order (callers compose by name lookup).
  const byName = new Map(placements.map((p) => [p.name, p]));
  return {
    width,
    height,
    placements: images.map((i) => byName.get(i.name)!),
  };
}

/**
 * Unique region names for the atlas + JSON `path` fields: manifest names with
 * extensions stripped, uniquified with numeric suffixes on collision. Both
 * consumers MUST share this mapping or regions won't resolve.
 */
export function uniqueTexturePaths(manifest: AssetManifest): Map<string, string> {
  const paths = new Map<string, string>();
  const used = new Set<string>();
  for (const [textureId, meta] of Object.entries(manifest)) {
    const base = meta.name.replace(/\.[a-z0-9]+$/i, '');
    let unique = base;
    let i = 2;
    while (used.has(unique)) unique = base + i++;
    used.add(unique);
    paths.set(textureId, unique);
  }
  return paths;
}

/** Spine 4.1 atlas text (region names = the uniqueTexturePaths values). */
export function buildAtlasText(pageName: string, layout: AtlasLayout): string {
  const lines: string[] = [
    '', // Spine atlas files START with a blank line.
    `${pageName}.png`,
    `size: ${layout.width},${layout.height}`,
    'filter: Linear,Linear',
    'pma: false',
  ];
  for (const p of layout.placements) {
    lines.push(p.name, `  bounds: ${p.x},${p.y},${p.width},${p.height}`);
  }
  lines.push(''); // Trailing newline.
  return lines.join('\n');
}
