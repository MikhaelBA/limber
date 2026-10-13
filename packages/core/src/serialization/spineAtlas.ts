export interface SpineAtlasRegion {
  name: string;
  page: string;
  x: number;
  y: number;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  offsetX: number;
  offsetY: number;
  rotation: 0 | 90 | 180 | 270;
  pma: boolean;
}

/** Spine atlas text, both legacy xy/size/orig/offset and current bounds/offsets.
 * Width/height describe the unrotated packed region, not the page rectangle.
 */
export function parseSpineAtlas(text: string): SpineAtlasRegion[] {
  const regions: SpineAtlasRegion[] = [];
  let page = '',
    pma = false,
    region: SpineAtlasRegion | undefined;
  let newPage = true;
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      newPage = true;
      region = undefined;
      continue;
    }
    if (!line.includes(':')) {
      if (newPage) {
        page = line;
        pma = false;
        newPage = false;
        region = undefined;
      } else {
        region = {
          name: line,
          page,
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          originalWidth: 0,
          originalHeight: 0,
          offsetX: 0,
          offsetY: 0,
          rotation: 0,
          pma,
        };
        regions.push(region);
      }
      continue;
    }
    const colon = line.indexOf(':'),
      key = line.slice(0, colon),
      value = line.slice(colon + 1).trim();
    if (!region) {
      if (key === 'pma') pma = value === 'true';
      continue;
    }
    if (key === 'rotate') {
      const r = value === 'true' ? 90 : value === 'false' ? 0 : Number(value);
      if (![0, 90, 180, 270].includes(r))
        throw new Error(`Atlas region "${region.name}" has unsupported rotation.`);
      region.rotation = r as SpineAtlasRegion['rotation'];
      continue;
    }
    const numbers = value.split(',').map((v) => Number(v.trim()));
    const take = (count: number) => {
      if (numbers.length !== count || numbers.some((n) => !Number.isInteger(n)))
        throw new Error(`Invalid atlas ${key} for "${region!.name}".`);
      return numbers;
    };
    if (key === 'bounds')
      [region.x, region.y, region.width, region.height] = take(4) as [number, number, number, number];
    else if (key === 'xy') [region.x, region.y] = take(2) as [number, number];
    else if (key === 'size') [region.width, region.height] = take(2) as [number, number];
    else if (key === 'orig') [region.originalWidth, region.originalHeight] = take(2) as [number, number];
    else if (key === 'offset') [region.offsetX, region.offsetY] = take(2) as [number, number];
    else if (key === 'offsets')
      [region.offsetX, region.offsetY, region.originalWidth, region.originalHeight] = take(4) as [
        number,
        number,
        number,
        number,
      ];
    else if (['split', 'pad'].includes(key))
      throw new Error(`Atlas region "${region.name}" uses unsupported nine-patch ${key}.`);
  }
  const names = new Set<string>();
  for (const r of regions) {
    r.originalWidth ||= r.width;
    r.originalHeight ||= r.height;
    if (names.has(r.name)) throw new Error(`Duplicate atlas region "${r.name}".`);
    names.add(r.name);
    if (
      r.width <= 0 ||
      r.height <= 0 ||
      r.x < 0 ||
      r.y < 0 ||
      r.offsetX < 0 ||
      r.offsetY < 0 ||
      r.offsetX + r.width > r.originalWidth ||
      r.offsetY + r.height > r.originalHeight
    )
      throw new Error(`Invalid dimensions/trim for atlas region "${r.name}".`);
  }
  if (!regions.length) throw new Error('No regions found in the Spine atlas.');
  return regions;
}
