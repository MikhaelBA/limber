import {
  decodeFontBytes,
  fontFamilyKey,
  isGenericFontFamily,
  validateEmbeddedFonts,
  FONT_MAX_BYTES,
  FONT_TOTAL_BYTES,
  FontFormatError,
  type BoneByBoneProject,
} from '@limber/core';
import { runtimeFontRequirements } from '@limber/runtime';
import { AtlasError, atlasFail } from '@limber/atlas';
import type { NativeFontFetchSource } from './atlasProtocol';

async function fetchBounded(url: string, maximum: number, id: string): Promise<Uint8Array> {
  if (typeof url !== 'string' || url.length > 8192 || !/^https?:\/\/[^\s]+$/.test(url))
    atlasFail('FONT_SOURCE', id, 'Bundled font resources need an absolute HTTP(S) URL.');
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    return atlasFail('FONT_FETCH', id, 'Bundled font resource could not be fetched.');
  }
  if (!response.ok || !response.body)
    atlasFail('FONT_FETCH', id, `Bundled font resource returned HTTP ${response.status}.`);
  if (Number(response.headers.get('content-length')) > maximum)
    atlasFail('FONT_BUDGET', id, 'Bundled font resource exceeds its byte limit.');
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maximum) atlasFail('FONT_BUDGET', id, 'Bundled font resource exceeds its byte limit.');
      chunks.push(next.value);
    }
  } catch (error) {
    if (error instanceof AtlasError) throw error;
    return atlasFail('FONT_FETCH', id, 'Bundled font resource body could not be read.');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let position = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, position);
    position += chunk.byteLength;
  }
  return bytes;
}
function base64(bytes: Uint8Array): string {
  let text = '';
  for (let p = 0; p < bytes.length; p += 8192) text += String.fromCharCode(...bytes.subarray(p, p + 8192));
  return btoa(text);
}
/** Fetch and decode only referenced packaged families, in the owned cancellable worker. */
export async function nativeSourceFonts(
  source: BoneByBoneProject,
  fetched: readonly NativeFontFetchSource[] = [],
  progress: (fraction: number) => void,
): Promise<{ project: BoneByBoneProject; buffers: ArrayBuffer[]; durationMs: number }> {
  const start = performance.now();
  try {
    validateEmbeddedFonts(source.fonts ?? []);
    if (!Array.isArray(fetched) || fetched.length > 32)
      atlasFail('FONT_BUDGET', null, 'Use at most 32 bundled font sources.');
    const required = new Set(
      runtimeFontRequirements({ artboards: source.artboards, components: source.components ?? [] }).flatMap(
        (r) => r.families.filter((f) => !isGenericFontFamily(f)).map(fontFamilyKey),
      ),
    );
    const fonts = (source.fonts ?? []).filter((f) => required.has(fontFamilyKey(f.family)));
    const families = new Set(fonts.map((f) => fontFamilyKey(f.family))),
      declared = new Set<string>();
    for (const item of fetched) {
      if (
        !item ||
        typeof item.family !== 'string' ||
        !item.family.trim() ||
        declared.has(fontFamilyKey(item.family))
      )
        atlasFail('FONT_SOURCE', null, 'Bundled font sources need distinct nonempty families.');
      declared.add(fontFamilyKey(item.family));
    }
    const needed = fetched.filter(
      (f) => required.has(fontFamilyKey(f.family)) && !families.has(fontFamilyKey(f.family)),
    );
    if (fonts.length + needed.length > 32) atlasFail('FONT_BUDGET', null, 'Use at most 32 packaged fonts.');
    let total = fonts.reduce(
      (sum, font) =>
        sum +
        (font.base64.length / 4) * 3 -
        (font.base64.endsWith('==') ? 2 : font.base64.endsWith('=') ? 1 : 0),
      0,
    );
    progress(0);
    for (const item of needed) {
      if (
        typeof item.id !== 'string' ||
        !item.id.trim() ||
        !['ttf', 'otf'].includes(item.format) ||
        !item.license ||
        typeof item.license.name !== 'string'
      )
        atlasFail('FONT_SOURCE', null, 'Invalid bundled font source metadata.');
      if (total >= FONT_TOTAL_BYTES)
        atlasFail('FONT_BUDGET', item.id, 'Packaged fonts exceed their total byte limit.');
      const bytes = await fetchBounded(item.url, Math.min(FONT_MAX_BYTES, FONT_TOTAL_BYTES - total), item.id);
      total += bytes.byteLength;
      let licenseText = item.license.text;
      if (licenseText === undefined && item.license.textUrl !== undefined) {
        const bytes = await fetchBounded(item.license.textUrl, 65536, item.id);
        try {
          licenseText = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        } catch {
          atlasFail('FONT_LICENSE_METADATA', item.id, 'Font license must be valid UTF-8 text.');
        }
      }
      const { textUrl: _url, ...license } = item.license;
      fonts.push({
        id: item.id,
        family: item.family,
        format: item.format,
        base64: base64(bytes),
        license: { ...license, text: licenseText ?? '' },
      });
      families.add(fontFamilyKey(item.family));
    }
    validateEmbeddedFonts(fonts);
    const buffers: ArrayBuffer[] = [];
    for (const [i, font] of fonts.entries()) {
      if (typeof FontFace !== 'function')
        atlasFail('WORKER_FONT_API', font.id, 'This browser cannot decode fonts in a worker.');
      const buffer = decodeFontBytes(font.base64, font.id).buffer as ArrayBuffer;
      try {
        await new FontFace(`BoneByBoneWorkerFont${i}`, buffer).load();
      } catch {
        atlasFail(
          'FONT_DECODE',
          font.id,
          'Embedded font body could not be decoded.',
          'Reimport a complete valid OpenType font.',
        );
      }
      buffers.push(buffer);
      progress((i + 1) / fonts.length);
    }
    progress(1);
    return { project: { ...source, fonts }, buffers, durationMs: performance.now() - start };
  } catch (error) {
    if (error instanceof FontFormatError)
      throw new AtlasError(
        error.code,
        error.objectId,
        error.message,
        'Reimport valid OpenType bytes and retain their license.',
      );
    throw error;
  }
}
