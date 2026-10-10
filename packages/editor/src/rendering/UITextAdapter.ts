export { rasterizeUIText, previewUIText, type LocalizationPreview } from '@limber/runtime-web';
let fontReady: Promise<void> | undefined;
export function ensureUIFonts(): Promise<void> {
  return (fontReady ??= (async () => {
    const face = new FontFace(
      'Noto Sans Arabic',
      `url(${import.meta.env.BASE_URL}fonts/NotoSansArabic.ttf)`,
      { weight: '100 900' },
    );
    await face.load();
    document.fonts.add(face);
  })());
}
