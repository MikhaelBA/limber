export { rasterizeUIText, previewUIText, type LocalizationPreview } from '@limber/runtime-web';
import { decodeFontBytes, fontFamilyKey, validateEmbeddedFonts, type EmbeddedFont } from '@limber/core';
let fontReady: Promise<void> | undefined;
const noFonts: readonly EmbeddedFont[] = [];
let generation = 0;
let aliases = new Map<string, string>(),
  owned: FontFace[] = [];
let requested: { source: readonly EmbeddedFont[]; ready: Promise<void> } | undefined;
export function resolveUIFonts(families: readonly string[]): string[] {
  return families.map((family) => aliases.get(fontFamilyKey(family)) ?? family);
}
/** Source-preview faces are staged atomically; a stale project/edit cannot publish over a newer one. */
export function ensureUIFonts(fonts: readonly EmbeddedFont[] = noFonts): Promise<void> {
  if (requested?.source === fonts) return requested.ready;
  const epoch = ++generation;
  const ready = (async () => {
    await (fontReady ??= (async () => {
      const face = new FontFace(
        'Noto Sans Arabic',
        `url(${import.meta.env.BASE_URL}fonts/NotoSansArabic.ttf)`,
        { weight: '100 900' },
      );
      await face.load();
      document.fonts.add(face);
    })().catch((error) => {
      fontReady = undefined;
      throw error;
    }));
    validateEmbeddedFonts(fonts);
    const staged: FontFace[] = [],
      next = new Map<string, string>();
    for (const [i, font] of fonts.entries()) {
      const alias = `BoneByBonePreview${epoch}Font${i}`;
      const face = await new FontFace(
        alias,
        decodeFontBytes(font.base64, font.id).buffer as ArrayBuffer,
      ).load();
      staged.push(face);
      next.set(fontFamilyKey(font.family), alias);
    }
    if (epoch !== generation) return;
    for (const face of staged) document.fonts.add(face);
    for (const face of owned) document.fonts.delete(face);
    owned = staged;
    aliases = next;
  })().catch((error) => {
    if (epoch !== generation) return;
    requested = undefined;
    throw error;
  });
  requested = { source: fonts, ready };
  return ready;
}
