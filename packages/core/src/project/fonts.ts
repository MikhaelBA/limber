/** Portable OpenType resource metadata/preflight. Actual shaping/decode belongs to the host. */
export interface EmbeddedFont {
  id: string;
  family: string;
  format: 'ttf' | 'otf';
  base64: string;
  license: {
    name: string;
    text: string;
    redistribution: 'allowed' | 'unknown' | 'restricted';
    sourceUrl?: string;
  };
}
export const FONT_MAX_COUNT = 32;
export const FONT_MAX_BYTES = 4 * 1024 * 1024;
export const FONT_TOTAL_BYTES = 16 * 1024 * 1024;
export class FontFormatError extends Error {
  constructor(
    readonly code: string,
    readonly objectId: string | null,
    message: string,
  ) {
    super(message);
    this.name = 'FontFormatError';
  }
}
export function fontFamilyKey(family: string): string {
  return family.trim().normalize('NFC').toLowerCase();
}
const genericFamilies = new Set([
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
export function isGenericFontFamily(family: string): boolean {
  return genericFamilies.has(fontFamilyKey(family));
}
function fail(code: string, id: string | null, message: string): never {
  throw new FontFormatError(code, id, message);
}
/** Canonical encoding and size are checked before allocating decoded font bytes. */
export function decodeFontBytes(base64: string, id: string | null = null): Uint8Array {
  if (
    typeof base64 !== 'string' ||
    !base64.length ||
    base64.length % 4 ||
    base64.length > Math.ceil(FONT_MAX_BYTES / 3) * 4 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)
  )
    fail('FONT_ENCODING', id, 'Fonts require bounded canonical base64.');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  if (
    (base64.endsWith('==') && alphabet.indexOf(base64.at(-3)!) & 15) ||
    (base64.endsWith('=') && !base64.endsWith('==') && alphabet.indexOf(base64.at(-2)!) & 3)
  )
    fail('FONT_ENCODING', id, 'Font base64 contains nonzero padding bits.');
  const length = (base64.length / 4) * 3 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
  if (length > FONT_MAX_BYTES) fail('FONT_BUDGET', id, 'A font exceeds the 4 MiB resource budget.');
  return Uint8Array.from(atob(base64), (value) => value.charCodeAt(0));
}
export interface OpenTypeInspection {
  format: 'ttf' | 'otf';
  glyphs: number;
  embeddingFlags: number;
  cmapFormat: 4 | 12 | 13;
  /** Unicode internal family names, preferring English typographic family records. */
  familyNames: readonly string[];
  /** Unicode scalar lookup only; this does not prove contextual shaping or UVS support. */
  hasCharacter(codepoint: number): boolean;
}
/** Bounded sfnt/cmap inspection. Specification: https://learn.microsoft.com/en-us/typography/opentype/spec/cmap */
export function inspectOpenType(bytes: Uint8Array, id: string | null = null): OpenTypeInspection {
  const invalid = (message: string): never => fail('FONT_STRUCTURE', id, message);
  if (!(bytes instanceof Uint8Array) || bytes.length < 12 || bytes.length > FONT_MAX_BYTES)
    invalid('Invalid or oversized OpenType bytes.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(0);
  if (version !== 0x00010000 && version !== 0x4f54544f)
    fail('FONT_FORMAT', id, 'Use a single OpenType .ttf or .otf file; collections and WOFF are unsupported.');
  const format = version === 0x00010000 ? 'ttf' : 'otf';
  const count = view.getUint16(4),
    directoryEnd = 12 + count * 16;
  if (!count || count > 256 || directoryEnd > bytes.length) invalid('Invalid OpenType table directory.');
  const tables = new Map<string, { offset: number; length: number }>();
  const ranges: { offset: number; length: number }[] = [];
  for (let i = 0; i < count; i++) {
    const p = 12 + i * 16,
      tag = String.fromCharCode(...bytes.subarray(p, p + 4));
    const offset = view.getUint32(p + 8),
      length = view.getUint32(p + 12);
    if (tables.has(tag) || offset % 4 || offset < directoryEnd || offset + length > bytes.length)
      invalid('Duplicate, unaligned or out-of-bounds OpenType table.');
    const range = { offset, length };
    tables.set(tag, range);
    if (length) ranges.push(range);
  }
  ranges.sort((a, b) => a.offset - b.offset);
  for (let i = 1; i < ranges.length; i++)
    if (ranges[i]!.offset < ranges[i - 1]!.offset + ranges[i - 1]!.length)
      invalid('OpenType tables overlap.');
  const required = (tag: string, minimum: number) => {
    const table = tables.get(tag);
    if (!table || table.length < minimum) return invalid(`Missing or truncated ${tag} font table.`);
    return table;
  };
  const head = required('head', 54),
    maxp = required('maxp', 6),
    cmap = required('cmap', 4);
  const name = required('name', 6);
  const nameVersion = view.getUint16(name.offset),
    nameCount = view.getUint16(name.offset + 2);
  const storage = view.getUint16(name.offset + 4),
    recordsEnd = 6 + nameCount * 12;
  if (
    nameVersion > 1 ||
    nameCount > 4096 ||
    recordsEnd > name.length ||
    storage < recordsEnd ||
    storage > name.length
  )
    invalid('Invalid OpenType name directory.');
  if (nameVersion === 1) {
    if (recordsEnd + 2 > name.length) invalid('Truncated name language-tag directory.');
    const tags = view.getUint16(name.offset + recordsEnd);
    if (tags > 256 || recordsEnd + 2 + tags * 4 > storage) invalid('Invalid font language-tag records.');
    for (let i = 0; i < tags; i++) {
      const p = name.offset + recordsEnd + 2 + i * 4;
      if (storage + view.getUint16(p + 2) + view.getUint16(p) > name.length)
        invalid('Font language-tag strings are out of bounds.');
    }
  }
  const names: { value: string; priority: number; kind: number }[] = [];
  for (let i = 0; i < nameCount; i++) {
    const p = name.offset + 6 + i * 12,
      platform = view.getUint16(p),
      encoding = view.getUint16(p + 2);
    const language = view.getUint16(p + 4),
      kind = view.getUint16(p + 6),
      length = view.getUint16(p + 8);
    const relative = storage + view.getUint16(p + 10);
    if (relative + length > name.length) invalid('Font name strings are out of bounds.');
    if (
      (kind !== 1 && kind !== 16) ||
      !length ||
      length > 256 ||
      !(platform === 0 || (platform === 3 && [0, 1, 10].includes(encoding)))
    )
      continue;
    if (length % 2) invalid('Unicode font name has an odd byte count.');
    let value: string;
    try {
      value = new TextDecoder('utf-16be', { fatal: true })
        .decode(bytes.subarray(name.offset + relative, name.offset + relative + length))
        .trim();
    } catch {
      return invalid('Unicode font name is invalid UTF-16.');
    }
    if (value && !/[\p{Cc}\p{Cf}]/u.test(value))
      names.push({ value, kind, priority: (language === 0x409 ? 0 : 2) + (kind === 16 ? 0 : 1) });
  }
  names.sort((a, b) => a.priority - b.priority || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
  const preferred = names.some((entry) => entry.kind === 16)
    ? names.filter((entry) => entry.kind === 16)
    : names;
  const familyNames = [...new Set(preferred.map((entry) => entry.value))].slice(0, 32);
  required('hhea', 36);
  required('hmtx', 4);
  if (view.getUint32(head.offset + 12) !== 0x5f0f3cf5) invalid('Invalid font head magic.');
  if (format === 'ttf') {
    required('glyf', 0);
    required('loca', 2);
  } else if (!tables.has('CFF ') && !tables.has('CFF2')) invalid('OpenType CFF outlines are missing.');
  const glyphs = view.getUint16(maxp.offset + 4);
  if (!glyphs) invalid('Font has no glyphs.');
  const os2 = tables.get('OS/2');
  const embeddingFlags = os2 && os2.length >= 10 ? view.getUint16(os2.offset + 8) : 0;
  if (view.getUint16(cmap.offset) !== 0) invalid('Unsupported cmap version.');
  const records = view.getUint16(cmap.offset + 2);
  if (!records || records > 256 || 4 + records * 8 > cmap.length) invalid('Invalid cmap encoding records.');
  let selected: { start: number; format: 4 | 12 | 13 } | undefined;
  for (let i = 0; i < records; i++) {
    const p = cmap.offset + 4 + i * 8,
      platform = view.getUint16(p),
      encoding = view.getUint16(p + 2);
    const relative = view.getUint32(p + 4),
      start = cmap.offset + relative;
    if (relative < 4 + records * 8 || relative + 2 > cmap.length) invalid('cmap subtable offset is invalid.');
    if (platform !== 0 && !(platform === 3 && (encoding === 1 || encoding === 10))) continue;
    const kind = view.getUint16(start);
    if (kind !== 4 && kind !== 12 && kind !== 13) continue;
    if (!selected || (selected.format === 4 && kind !== 4)) selected = { start, format: kind };
  }
  if (!selected) fail('FONT_CMAP_UNSUPPORTED', id, 'Font needs a Unicode cmap format 4, 12 or 13.');
  const start = selected.start,
    cmapFormat = selected.format,
    cmapEnd = cmap.offset + cmap.length;
  let entries: number, end: number, hasCharacter: (codepoint: number) => boolean;
  const validGlyph = (glyph: number) => glyph > 0 && glyph < glyphs;
  if (cmapFormat === 4) {
    if (start + 16 > cmapEnd) invalid('Truncated cmap format 4.');
    end = start + view.getUint16(start + 2);
    entries = view.getUint16(start + 6) / 2;
    if (!Number.isInteger(entries) || !entries || end > cmapEnd || end < start + 16 + entries * 8)
      invalid('Invalid cmap format 4 size.');
    const ends = start + 14,
      starts = ends + entries * 2 + 2;
    const deltas = starts + entries * 2,
      offsets = deltas + entries * 2,
      glyphArray = offsets + entries * 2;
    if (view.getUint16(ends + entries * 2) !== 0 || view.getUint16(ends + (entries - 1) * 2) !== 0xffff)
      invalid('Invalid cmap format 4 terminator.');
    let previous = -1;
    for (let i = 0; i < entries; i++) {
      const a = view.getUint16(starts + i * 2),
        b = view.getUint16(ends + i * 2);
      const offset = view.getUint16(offsets + i * 2),
        target = offsets + i * 2 + offset;
      if (
        a > b ||
        a <= previous ||
        (offset && (offset % 2 || target < glyphArray || target + (b - a + 1) * 2 > end))
      )
        invalid('Invalid cmap segments or glyph-array bounds.');
      previous = b;
    }
    hasCharacter = (codepoint) => {
      if (
        !Number.isInteger(codepoint) ||
        codepoint < 0 ||
        codepoint > 0xffff ||
        (codepoint >= 0xd800 && codepoint <= 0xdfff)
      )
        return false;
      let lo = 0,
        hi = entries - 1;
      while (lo <= hi) {
        const i = (lo + hi) >>> 1,
          a = view.getUint16(starts + i * 2),
          b = view.getUint16(ends + i * 2);
        if (codepoint < a) hi = i - 1;
        else if (codepoint > b) lo = i + 1;
        else {
          const offset = view.getUint16(offsets + i * 2),
            delta = view.getInt16(deltas + i * 2);
          const raw = offset ? view.getUint16(offsets + i * 2 + offset + (codepoint - a) * 2) : codepoint;
          return validGlyph(offset && !raw ? 0 : (raw + delta) & 0xffff);
        }
      }
      return false;
    };
  } else {
    if (start + 16 > cmapEnd) invalid('Truncated cmap group header.');
    end = start + view.getUint32(start + 4);
    entries = view.getUint32(start + 12);
    if (view.getUint16(start + 2) || entries > 65536 || end > cmapEnd || end !== start + 16 + entries * 12)
      invalid('Invalid cmap group size.');
    let previous = -1;
    for (let i = 0; i < entries; i++) {
      const p = start + 16 + i * 12,
        a = view.getUint32(p),
        b = view.getUint32(p + 4),
        glyph = view.getUint32(p + 8);
      if (
        a > b ||
        b > 0x10ffff ||
        a <= previous ||
        glyph >= glyphs ||
        (cmapFormat === 12 && glyph + b - a >= glyphs)
      )
        invalid('Invalid Unicode cmap groups.');
      previous = b;
    }
    hasCharacter = (codepoint) => {
      if (
        !Number.isInteger(codepoint) ||
        codepoint < 0 ||
        codepoint > 0x10ffff ||
        (codepoint >= 0xd800 && codepoint <= 0xdfff)
      )
        return false;
      let lo = 0,
        hi = entries - 1;
      while (lo <= hi) {
        const i = (lo + hi) >>> 1,
          p = start + 16 + i * 12,
          a = view.getUint32(p),
          b = view.getUint32(p + 4);
        if (codepoint < a) hi = i - 1;
        else if (codepoint > b) lo = i + 1;
        else return validGlyph(view.getUint32(p + 8) + (cmapFormat === 12 ? codepoint - a : 0));
      }
      return false;
    };
  }
  return { format, glyphs, embeddingFlags, cmapFormat, familyNames, hasCharacter };
}
/** Validates and inspects a bounded font publication; never mutates caller records. */
export function validateEmbeddedFonts(value: unknown): Map<string, OpenTypeInspection> {
  if (!Array.isArray(value) || value.length > FONT_MAX_COUNT)
    fail('FONT_BUDGET', null, 'Use at most 32 embedded fonts.');
  const inspected = new Map<string, OpenTypeInspection>(),
    ids = new Set<string>();
  let total = 0;
  const nonempty = (value: unknown, maximum: number) =>
    typeof value === 'string' && !!value.trim() && value.length <= maximum;
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      fail('FONT_METADATA', null, 'Invalid font record.');
    const font = item as EmbeddedFont,
      id = typeof font.id === 'string' ? font.id : null;
    if (
      !nonempty(font.id, 128) ||
      ids.has(font.id) ||
      !nonempty(font.family, 128) ||
      font.family !== font.family.trim() ||
      isGenericFontFamily(font.family) ||
      inspected.has(fontFamilyKey(font.family))
    )
      fail('FONT_METADATA', id, 'Fonts need unique IDs and distinct nongeneric family names.');
    ids.add(font.id);
    const license = font.license;
    if (
      !license ||
      typeof license !== 'object' ||
      Array.isArray(license) ||
      !nonempty(license.name, 256) ||
      typeof license.text !== 'string' ||
      license.text.length > 65536 ||
      !['allowed', 'unknown', 'restricted'].includes(license.redistribution) ||
      (license.redistribution === 'allowed' && !license.text.trim()) ||
      (license.sourceUrl !== undefined &&
        (typeof license.sourceUrl !== 'string' ||
          license.sourceUrl.length > 2048 ||
          !/^https?:\/\/[^\s]+$/.test(license.sourceUrl)))
    )
      fail(
        'FONT_LICENSE_METADATA',
        id,
        'Preserve a bounded font license name/text and redistribution status.',
      );
    if (typeof font.base64 !== 'string') fail('FONT_ENCODING', id, 'Invalid font encoding.');
    const estimate =
      (font.base64.length / 4) * 3 - (font.base64.endsWith('==') ? 2 : font.base64.endsWith('=') ? 1 : 0);
    if (total + estimate > FONT_TOTAL_BYTES)
      fail('FONT_BUDGET', id, 'Embedded fonts exceed the 16 MiB total budget.');
    const bytes = decodeFontBytes(font.base64, id),
      inspection = inspectOpenType(bytes, id);
    total += bytes.length;
    if (font.format !== inspection.format)
      fail('FONT_FORMAT', id, 'Declared font format does not match its OpenType header.');
    inspected.set(fontFamilyKey(font.family), inspection);
  }
  return inspected;
}
