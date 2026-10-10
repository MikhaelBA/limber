import { isGenericFontFamily, fontFamilyKey, type TextNode, type UIBox } from '@limber/core';
export type LocalizationPreview = 'expected' | 'short' | 'long' | 'numeric';
export function previewUIText(node: TextNode, mode: LocalizationPreview): string {
  if (mode === 'short') return node.direction === 'rtl' ? 'نعم' : 'OK';
  if (mode === 'numeric') return '9,999,999,999';
  if (mode === 'long') return `${node.text} — ${node.text} — ${node.text}`;
  return node.text;
}
/** Web shaping adapter. Whole lines go through native bidi/shaping, never reversed glyph arrays. */
export function rasterizeUIText(
  node: TextNode,
  box: Pick<UIBox, 'width' | 'height'>,
  preview: LocalizationPreview = 'expected',
  families: readonly string[] = node.fontFamilies,
) {
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 4096 / Math.max(1, box.width), 4096 / Math.max(1, box.height));
  canvas.width = Math.max(1, Math.ceil(box.width * scale));
  canvas.height = Math.max(1, Math.ceil(box.height * scale));
  const context = canvas.getContext('2d')!;
  context.scale(scale, scale);
  context.font = `${node.fontSize}px ${families.map((family) => isGenericFontFamily(family) ? fontFamilyKey(family) : JSON.stringify(family)).join(',')}`;
  context.direction = node.direction;
  context.textAlign = node.align;
  context.textBaseline = 'alphabetic';
  context.fillStyle = `#${node.color.toString(16).padStart(6, '0')}`;
  const value = previewUIText(node, preview),
    lines = value.split(/\r?\n/);
  const x =
    node.align === 'center'
      ? box.width / 2
      : (node.align === 'start') === (node.direction === 'rtl')
        ? box.width
        : 0;
  const measured = lines.map((line) => context.measureText(line));
  const widths = measured.map((metrics) => metrics.width);
  lines.forEach((line, index) => context.fillText(line, x, node.fontSize + index * node.lineHeight));
  const overflow =
    Math.max(0, ...widths) > box.width ||
    measured.some((metrics, index) => {
      const baseline = node.fontSize + index * node.lineHeight;
      return (
        baseline - metrics.actualBoundingBoxAscent < 0 ||
        baseline + metrics.actualBoundingBoxDescent > box.height ||
        x - metrics.actualBoundingBoxLeft < -0.01 ||
        x + metrics.actualBoundingBoxRight > box.width + 0.01
      );
    });
  return { canvas, overflow, value, widths };
}
