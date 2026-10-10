import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  decodeFontBytes,
  inspectOpenType,
  validateEmbeddedFonts,
  FontFormatError,
  FONT_MAX_BYTES,
  FONT_TOTAL_BYTES,
  fontFamilyKey,
  isGenericFontFamily,
  deserializeProject,
  serializeProject,
  PROJECT_SCHEMA_VERSION,
  type EmbeddedFont,
} from '@limber/core';

const notoBytes = new Uint8Array(
  readFileSync(new URL('../../editor/public/fonts/NotoSansArabic.ttf', import.meta.url)),
);
const notice = readFileSync(
  new URL('../../editor/public/fonts/OFL-NotoSansArabic.txt', import.meta.url),
  'utf8',
);
const font = (): EmbeddedFont => ({
  id: 'noto',
  family: 'Noto Sans Arabic',
  format: 'ttf',
  base64: Buffer.from(notoBytes).toString('base64'),
  license: {
    name: 'SIL Open Font License 1.1',
    text: notice,
    redistribution: 'allowed',
    sourceUrl: 'https://github.com/google/fonts/tree/main/ofl/notosansarabic',
  },
});
function table(bytes: Uint8Array, tag: string) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < view.getUint16(4); i++) {
    const p = 12 + i * 16;
    if (String.fromCharCode(...bytes.subarray(p, p + 4)) === tag)
      return { entry: p, offset: view.getUint32(p + 8) };
  }
  throw new Error(`Missing ${tag}`);
}
/** Synthetic cmap metadata only. These stubs deliberately do not claim real font decoding. */
function stub(format: 4 | 12 | 13) {
  const subt = new Uint8Array(format === 4 ? 46 : 40),
    map = new DataView(subt.buffer);
  map.setUint16(0, format);
  if (format === 4) {
    map.setUint16(2, 46);
    map.setUint16(6, 6);
    map.setUint16(8, 4);
    map.setUint16(10, 1);
    map.setUint16(12, 2);
    [0x41, 0x62, 0xffff].forEach((v, i) => map.setUint16(14 + i * 2, v));
    [0x41, 0x61, 0xffff].forEach((v, i) => map.setUint16(22 + i * 2, v));
    map.setInt16(28, 1 - 0x41);
    map.setInt16(30, 1);
    map.setInt16(32, 1);
    map.setUint16(36, 4);
    map.setUint16(40, 2);
    map.setUint16(42, 0);
  } else {
    map.setUint32(4, 40);
    map.setUint32(12, 2);
    map.setUint32(16, 0x41);
    map.setUint32(20, 0x41);
    map.setUint32(24, 1);
    map.setUint32(28, 0x1f980);
    map.setUint32(32, 0x1f981);
    map.setUint32(36, 2);
  }
  const cmap = new Uint8Array(12 + subt.length),
    cv = new DataView(cmap.buffer);
  cv.setUint16(2, 1);
  cv.setUint16(4, 3);
  cv.setUint16(6, format === 4 ? 1 : 10);
  cv.setUint32(8, 12);
  cmap.set(subt, 12);
  const head = new Uint8Array(54);
  new DataView(head.buffer).setUint32(12, 0x5f0f3cf5);
  const maxp = new Uint8Array(6);
  new DataView(maxp.buffer).setUint16(4, 8);
  const entries = [
    ['head', head],
    ['maxp', maxp],
    ['cmap', cmap],
    ['name', new Uint8Array(6)],
    ['hhea', new Uint8Array(36)],
    ['hmtx', new Uint8Array(4)],
    ['loca', new Uint8Array(2)],
    ['glyf', new Uint8Array(4)],
  ] as const;
  const bytes = new Uint8Array(512),
    view = new DataView(bytes.buffer);
  view.setUint32(0, 0x10000);
  view.setUint16(4, entries.length);
  let offset = 12 + entries.length * 16;
  entries.forEach(([tag, data], i) => {
    offset = Math.ceil(offset / 4) * 4;
    const p = 12 + i * 16;
    bytes.set(
      [...tag].map((c) => c.charCodeAt(0)),
      p,
    );
    view.setUint32(p + 8, offset);
    view.setUint32(p + 12, data.length);
    bytes.set(data, offset);
    offset += data.length;
  });
  return bytes.subarray(0, offset);
}
const rejects = (action: () => unknown, code: string) => {
  try {
    action();
    throw new Error('Expected rejection.');
  } catch (error) {
    expect(error).toBeInstanceOf(FontFormatError);
    expect((error as FontFormatError).code).toBe(code);
  }
};
describe('portable font resources', () => {
  it('preflights the real bundled Arabic variable font and Unicode coverage without changing bytes', () => {
    const before = notoBytes.slice(),
      result = inspectOpenType(notoBytes);
    expect(result.format).toBe('ttf');
    expect(result.glyphs).toBeGreaterThan(1000);
    for (const point of [0x41, 0x31, 0x633, 0x6cc, 0x67e]) expect(result.hasCharacter(point)).toBe(true);
    for (const point of [0x1f98a, -1, 0x110000, 2.5]) expect(result.hasCharacter(point)).toBe(false);
    expect(notoBytes).toEqual(before);
    expect(validateEmbeddedFonts([font()]).get('noto sans arabic')!.hasCharacter(0x633)).toBe(true);
  });
  it('uses format 4 delta and relative glyph offsets, preserving missing glyph zero', () => {
    const result = inspectOpenType(stub(4));
    expect(result.cmapFormat).toBe(4);
    expect(result.hasCharacter(0x41)).toBe(true);
    expect(result.hasCharacter(0x61)).toBe(true);
    expect(result.hasCharacter(0x62)).toBe(false);
    expect(result.hasCharacter(0xffff)).toBe(false);
    expect(result.hasCharacter(0x1f980)).toBe(false);
  });
  it('handles supplementary format 12 and constant last-resort format 13 groups', () => {
    for (const format of [12, 13] as const) {
      const result = inspectOpenType(stub(format));
      expect(result.cmapFormat).toBe(format);
      expect(result.hasCharacter(0x1f980)).toBe(true);
      expect(result.hasCharacter(0x1f981)).toBe(true);
      expect(result.hasCharacter(0x1f982)).toBe(false);
      expect(result.hasCharacter(0xd800)).toBe(false);
    }
  });
  it('rejects malformed directory, signature, magic and cmap bounds before host decode', () => {
    const mutate = (patch: (view: DataView, bytes: Uint8Array) => void, code = 'FONT_STRUCTURE') => {
      const bytes = notoBytes.slice();
      patch(new DataView(bytes.buffer), bytes);
      rejects(() => inspectOpenType(bytes), code);
    };
    mutate((v) => v.setUint32(0, 0x74746366), 'FONT_FORMAT');
    mutate((v) => v.setUint16(4, 257));
    mutate((v) => v.setUint32(20, 1));
    mutate((v, b) => v.setUint32(table(b, 'head').offset + 12, 0));
    mutate((v, b) => v.setUint32(table(b, 'cmap').offset + 8, 0xffffffff));
    const bytes = stub(4),
      v = new DataView(bytes.buffer);
    const cmap = table(bytes, 'cmap').offset + 12;
    v.setUint16(cmap + 36, 65534);
    rejects(() => inspectOpenType(bytes), 'FONT_STRUCTURE');
    rejects(() => inspectOpenType(notoBytes.subarray(0, 12)), 'FONT_STRUCTURE');
  });
  it('preflights canonical encoding and per-font/aggregate budgets', () => {
    for (const value of ['Zh==', 'Zm9=', 'AA A=', '', 'AA'])
      rejects(() => decodeFontBytes(value), 'FONT_ENCODING');
    rejects(() => decodeFontBytes('A'.repeat(Math.ceil(FONT_MAX_BYTES / 3) * 4 + 4)), 'FONT_ENCODING');
    const f = font();
    f.base64 = 'A'.repeat(Math.ceil(FONT_TOTAL_BYTES / 3) * 4 + 4);
    rejects(() => validateEmbeddedFonts([f]), 'FONT_BUDGET');
    expect(decodeFontBytes('AA==')).toEqual(new Uint8Array([0]));
  });
  it('validates family identity, format, license publication and authored save/reopen', () => {
    const f = font(),
      other = font();
    other.id = 'other';
    other.family = 'NOTO SANS ARABIC';
    rejects(() => validateEmbeddedFonts([f, other]), 'FONT_METADATA');
    other.family = 'sans-serif';
    rejects(() => validateEmbeddedFonts([other]), 'FONT_METADATA');
    other.family = 'Custom';
    other.format = 'otf';
    rejects(() => validateEmbeddedFonts([other]), 'FONT_FORMAT');
    other.format = 'ttf';
    other.license.text = '';
    rejects(() => validateEmbeddedFonts([other]), 'FONT_LICENSE_METADATA');
    other.license.redistribution = 'unknown';
    expect(validateEmbeddedFonts([other]).size).toBe(1);
    const project = deserializeProject(
      readFileSync(new URL('../../../fixtures/bbbproj-v13-interactive.json', import.meta.url), 'utf8'),
    );
    project.fonts = [f];
    const before = structuredClone(project);
    expect(deserializeProject(serializeProject(project))).toEqual(before);
    expect(project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(PROJECT_SCHEMA_VERSION).toBe(14);
    expect(fontFamilyKey('  SaNs-SeRiF ')).toBe('sans-serif');
    expect(isGenericFontFamily('SANS-SERIF')).toBe(true);
  });
});
