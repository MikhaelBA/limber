import { atlasFail } from './model';

/** Allocation-free dimension/animation preflight, followed by real browser body decode. */
export function readRasterSize(
  bytes: Uint8Array,
  mime: string,
  id: string,
): { width: number; height: number } {
  const fail = (): never =>
    atlasFail(
      'IMAGE_HEADER',
      id,
      'Image header is missing, truncated or inconsistent.',
      'Reimport a complete PNG, JPEG or WebP image.',
    );
  const be16 = (p: number) => (bytes[p]! << 8) | bytes[p + 1]!;
  const be32 = (p: number) =>
    bytes[p]! * 0x1000000 + (bytes[p + 1]! << 16) + (bytes[p + 2]! << 8) + bytes[p + 3]!;
  const le24 = (p: number) => bytes[p]! | (bytes[p + 1]! << 8) | (bytes[p + 2]! << 16);
  const le32 = (p: number) => le24(p) + bytes[p + 3]! * 0x1000000;
  const text = (p: number, s: string) => [...s].every((c, i) => bytes[p + i] === c.charCodeAt(0));
  if (mime === 'image/png') {
    if (
      bytes.length < 33 ||
      ![137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v) ||
      be32(8) !== 13 ||
      !text(12, 'IHDR')
    )
      fail();
    for (let p = 8; p + 12 <= bytes.length;) {
      const size = be32(p);
      if (size > bytes.length - p - 12) fail();
      if (text(p + 4, 'acTL'))
        atlasFail(
          'IMAGE_ANIMATION_UNSUPPORTED',
          id,
          'Animated PNG needs explicit frame authoring.',
          'Import individual still frames instead.',
        );
      p += size + 12;
    }
    return { width: be32(16), height: be32(20) };
  }
  if (mime === 'image/jpeg') {
    if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216) fail();
    for (let p = 2; p < bytes.length;) {
      if (bytes[p++] !== 255) fail();
      while (bytes[p] === 255) p++;
      const marker = bytes[p++];
      if (marker === undefined || marker === 218 || marker === 217) fail();
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (p + 2 > bytes.length) fail();
      const length = be16(p);
      if (length < 2 || length > bytes.length - p) fail();
      if (marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker)) {
        if (length < 8) fail();
        return { width: be16(p + 5), height: be16(p + 3) };
      }
      p += length;
    }
    return fail();
  }
  if (mime === 'image/webp') {
    if (bytes.length < 20 || !text(0, 'RIFF') || !text(8, 'WEBP') || le32(4) + 8 !== bytes.length) fail();
    for (let p = 12; p + 8 <= bytes.length;) {
      const size = le32(p + 4),
        start = p + 8;
      if (size > bytes.length - start) fail();
      if (text(p, 'VP8X')) {
        if (size !== 10) fail();
        if (bytes[start]! & 2)
          atlasFail(
            'IMAGE_ANIMATION_UNSUPPORTED',
            id,
            'Animated WebP needs explicit frame authoring.',
            'Import individual still frames instead.',
          );
        return { width: 1 + le24(start + 4), height: 1 + le24(start + 7) };
      }
      if (text(p, 'VP8L')) {
        if (size < 5 || bytes[start] !== 47 || bytes[start + 4]! >> 5 !== 0) fail();
        return {
          width: 1 + (bytes[start + 1]! | ((bytes[start + 2]! & 63) << 8)),
          height:
            1 + ((bytes[start + 2]! >> 6) | (bytes[start + 3]! << 2) | ((bytes[start + 4]! & 15) << 10)),
        };
      }
      if (text(p, 'VP8 ')) {
        if (size < 10 || ![157, 1, 42].every((v, i) => bytes[start + 3 + i] === v)) fail();
        return {
          width: (bytes[start + 6]! | (bytes[start + 7]! << 8)) & 16383,
          height: (bytes[start + 8]! | (bytes[start + 9]! << 8)) & 16383,
        };
      }
      p = start + size + (size % 2);
    }
    return fail();
  }
  return fail();
}
