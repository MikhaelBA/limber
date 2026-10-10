import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fontFamilyKey, inspectOpenType } from '@limber/core';
import { AtlasError } from '@limber/atlas';
import { preflightSvgText } from '../src/svgFontPreflight';

const font = inspectOpenType(
  new Uint8Array(readFileSync(new URL('../../editor/public/fonts/NotoSansArabic.ttf', import.meta.url))),
);
const context = async () => ({
  defaultFamily: 'Noto Sans Arabic',
  named: new Map(font.familyNames.map((name) => [fontFamilyKey(name), font])),
  fonts: [font],
});
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40">${body}</svg>`;
const reject = async (body: string, code: string) => {
  try {
    await preflightSvgText(svg(body), 'art', context);
    throw new Error('Expected rejection.');
  } catch (error) {
    expect(error).toBeInstanceOf(AtlasError);
    expect((error as AtlasError).code).toBe(code);
    expect((error as AtlasError).objectId).toBe('art');
  }
};
describe('explicit SVG text fonts', () => {
  it('preserves font-free SVG and resolves inherited/inline/case-insensitive/default families and entities', async () => {
    const original = svg('<rect width="80" height="40"/>');
    expect(
      (
        await preflightSvgText(original, 'art', () => {
          throw new Error('No fonts needed.');
        })
      ).svg,
    ).toBe(original);
    const result = await preflightSvgText(
      svg(
        '<g font-family="noto sans arabic"><text>سلام <tspan style="font-family: sans-serif;fill:red">A&#x31;</tspan></text></g>',
      ),
      'art',
      context,
    );
    expect(result.defaultFontFamily).toBe('Noto Sans Arabic');
    expect(result.svg).toContain('Noto Sans Arabic');
    expect(result.svg).not.toContain('font-family: sans-serif');
    expect(result.svg).toContain('fill:red');
    await preflightSvgText(svg('<text>سلام <![CDATA[A]]></text>'), 'art', context);
  });
  it('rejects absent internal families, missing glyphs, selectors and unresolved stylesheet/shorthand fonts', async () => {
    await reject('<text font-family="Absent">A</text>', 'SVG_FONT_MISSING');
    await reject('<text>🦊</text>', 'SVG_FONT_GLYPH');
    await reject('<text>A&#xFE0F;</text>', 'SVG_FONT_VARIATION');
    await reject('<style>text { font-family: Absent }</style><text>A</text>', 'SVG_FONT_STYLE');
    await reject('<text style="font: 12px Noto">A</text>', 'SVG_FONT_STYLE');
    await reject('<text font-family="Noto Sans Arabic,">A</text>', 'SVG_FONT_STYLE');
  });
  it('rejects recovered XML, declarations, excessive depth and bounded glyph work', async () => {
    await reject('<text>A</other>', 'SVG_DECODE');
    await expect(preflightSvgText('<!DOCTYPE svg><svg/>', 'art', context)).rejects.toMatchObject({
      code: 'SVG_STRUCTURE',
    });
    await reject('<g>'.repeat(514) + '<text>A</text>' + '</g>'.repeat(514), 'SVG_STRUCTURE');
    await reject(`<text>${'A'.repeat(262145)}</text>`, 'SVG_FONT_BUDGET');
  });
});
