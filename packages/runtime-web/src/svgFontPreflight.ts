import {
  DOMParser,
  XMLSerializer,
  onWarningStopParsing,
  type Node as XmlNode,
  type Element as XmlElement,
} from '@xmldom/xmldom';
import {
  fontFamilyKey,
  inspectOpenType,
  isGenericFontFamily,
  FontFormatError,
  type OpenTypeInspection,
} from '@limber/core';
import { AtlasError, atlasFail } from '@limber/atlas';

export interface SvgFontContext {
  defaultFamily: string;
  named: Map<string, OpenTypeInspection>;
  fonts: OpenTypeInspection[];
}
/** Own explicit font buffers; no browser/system fallback is installed in the worker. */
export async function inspectSvgFonts(buffers: readonly ArrayBuffer[], id: string): Promise<SvgFontContext> {
  if (!buffers.length)
    atlasFail(
      'SVG_FONT_REQUIRED',
      id,
      'SVG text requires explicit OpenType font buffers.',
      'Supply its fonts or convert text to paths.',
    );
  const named = new Map<string, OpenTypeInspection>(),
    owners = new Map<string, number>(),
    fonts: OpenTypeInspection[] = [];
  const compared = new Map<string, boolean>();
  let comparedBytes = 0;
  for (const [i, buffer] of buffers.entries()) {
    const bytes = new Uint8Array(buffer);
    let inspection: OpenTypeInspection;
    try {
      inspection = inspectOpenType(bytes, id);
    } catch (error) {
      if (error instanceof FontFormatError)
        throw new AtlasError(
          error.code,
          id,
          error.message,
          'Supply a valid single OpenType font or convert text to paths.',
        );
      throw error;
    }
    if (!inspection.familyNames.length)
      atlasFail(
        'SVG_FONT_NAME',
        id,
        'SVG fonts need an internal Unicode family name.',
        'Use a font with Unicode name records or convert text to paths.',
      );
    if (typeof FontFace !== 'function')
      atlasFail('WORKER_FONT_API', id, 'Worker font decoding is unavailable.');
    try {
      await new FontFace(`BoneByBoneSvgFont${i}`, buffer).load();
    } catch {
      atlasFail(
        'FONT_DECODE',
        id,
        'SVG font body could not be decoded.',
        'Reimport a complete OpenType font.',
      );
    }
    fonts.push(inspection);
    for (const name of inspection.familyNames) {
      const key = fontFamilyKey(name),
        previous = owners.get(key);
      if (previous !== undefined) {
        const pair = `${previous}:${i}`;
        let same = compared.get(pair);
        if (same === undefined) {
          const old = new Uint8Array(buffers[previous]!);
          same = old.length === bytes.length;
          if (same) {
            comparedBytes += bytes.length;
            if (comparedBytes > 64 * 1024 * 1024)
              atlasFail('SVG_FONT_BUDGET', id, 'Ambiguous font comparison exceeds its work budget.');
            same = old.every((value, p) => value === bytes[p]);
          }
          compared.set(pair, same);
        }
        if (!same)
          atlasFail(
            'SVG_FONT_AMBIGUOUS',
            id,
            `Different supplied font bodies share internal family "${name}".`,
            'Supply one face per internal family or convert text to paths.',
          );
      } else {
        owners.set(key, i);
        named.set(key, inspection);
      }
    }
  }
  return { defaultFamily: fonts[0]!.familyNames[0]!, named, fonts };
}
function familyList(value: string, id: string): string[] {
  const names: string[] = [];
  let rest = value.trim();
  while (rest) {
    const match = /^(?:"([^"\\]+)"|'([^'\\]+)'|([^,'"\\()]+))\s*(,|$)/.exec(rest);
    if (!match || names.length >= 32)
      atlasFail(
        'SVG_FONT_STYLE',
        id,
        'SVG font-family needs a literal, bounded family list.',
        'Inline literal family names or convert text to paths.',
      );
    const family = (match[1] ?? match[2] ?? match[3]!).trim();
    if (!family || family.length > 128) atlasFail('SVG_FONT_STYLE', id, 'Invalid SVG font family.');
    names.push(family);
    rest = rest.slice(match[0].length).trim();
    if (match[4] === ',' && !rest)
      atlasFail('SVG_FONT_STYLE', id, 'SVG font-family ends with an empty entry.');
  }
  return names;
}
/** Strict XML and inherited literal text fonts. Unsupported CSS is diagnosed, never silently substituted. */
export async function preflightSvgText(
  svg: string,
  id: string,
  getFonts: () => Promise<SvgFontContext>,
): Promise<{ svg: string; defaultFontFamily?: string }> {
  if (svg.length > 4 * 1024 * 1024 || /<!\s*(?:DOCTYPE|ENTITY)\b/i.test(svg))
    atlasFail(
      'SVG_STRUCTURE',
      id,
      'SVG must be bounded, self-contained XML without document/entity declarations.',
    );
  let tags = 0;
  for (let p = svg.indexOf('<'); p >= 0; p = svg.indexOf('<', p + 1))
    if (++tags > 16384) atlasFail('SVG_STRUCTURE', id, 'SVG markup exceeds the bounded node budget.');
  let document: ReturnType<DOMParser['parseFromString']>;
  try {
    document = new DOMParser({ onError: onWarningStopParsing }).parseFromString(svg, 'image/svg+xml');
  } catch {
    return atlasFail('SVG_DECODE', id, 'SVG must contain well-formed XML.');
  }
  const root = document.documentElement;
  if (!root || root.localName !== 'svg' || root.namespaceURI !== 'http://www.w3.org/2000/svg')
    atlasFail('SVG_DECODE', id, 'Expected an SVG document root.');
  const ns = 'http://www.w3.org/2000/svg';
  const text = document.getElementsByTagNameNS(ns, 'text').length > 0;
  if (text && document.getElementsByTagNameNS(ns, 'style').length)
    atlasFail(
      'SVG_FONT_STYLE',
      id,
      'SVG text stylesheet fonts are not resolved by this exporter.',
      'Inline text font-family/style attributes or convert text to paths.',
    );
  const context = text ? await getFonts() : undefined;
  const queue: { node: XmlNode; depth: number; families: readonly string[]; text: boolean }[] = [
    { node: root, depth: 0, families: context ? [context.defaultFamily] : [], text: false },
  ];
  let characters = 0;
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i]!;
    if (item.depth > 512 || queue.length > 32768)
      atlasFail('SVG_STRUCTURE', id, 'SVG exceeds the bounded tree/depth budget.');
    let families = item.families,
      inText = item.text;
    if (item.node.nodeType === 1) {
      const element = item.node as XmlElement;
      if (element.namespaceURI === ns) {
        inText ||= element.localName === 'text';
        const attribute = element.getAttribute('font-family');
        const style = element.getAttribute('style') ?? '';
        if (context && /\bfont\s*:|\\|\/\*/i.test(style))
          atlasFail(
            'SVG_FONT_STYLE',
            id,
            'SVG text requires explicit font-family without shorthand/escaped CSS.',
            'Inline literal font-family attributes or convert text to paths.',
          );
        const declarations = style
          .split(';')
          .map((part) => /^\s*font-family\s*:\s*(.*?)\s*$/i.exec(part))
          .filter(Boolean);
        const declared = declarations.at(-1)?.[1] ?? attribute;
        if (context && declared && fontFamilyKey(declared) !== 'inherit') {
          families = familyList(declared, id);
          const canonical = families.map((family) => {
            const font = context.named.get(fontFamilyKey(family));
            if (font) return font.familyNames.find((name) => fontFamilyKey(name) === fontFamilyKey(family))!;
            if (isGenericFontFamily(family)) return context.defaultFamily;
            return family;
          });
          element.setAttribute('font-family', canonical.map((name) => JSON.stringify(name)).join(','));
          if (declarations.length)
            element.setAttribute(
              'style',
              style
                .split(';')
                .filter((part) => !/^\s*font-family\s*:/i.test(part))
                .join(';'),
            );
        }
      }
    } else if (context && inText && (item.node.nodeType === 3 || item.node.nodeType === 4)) {
      const available = families.flatMap((family) => {
        const font = context.named.get(fontFamilyKey(family));
        return font ? [font] : isGenericFontFamily(family) ? [context.fonts[0]!] : [];
      });
      if (!available.length)
        atlasFail(
          'SVG_FONT_MISSING',
          id,
          `SVG text fonts are absent: ${families.join(', ')}.`,
          'Supply matching internal font families or convert text to paths.',
        );
      for (const char of item.node.nodeValue ?? '') {
        if (++characters > 262144)
          atlasFail('SVG_FONT_BUDGET', id, 'SVG text exceeds its glyph-inspection budget.');
        const point = char.codePointAt(0)!;
        if (/^[\p{Cc}\p{Cf}]$/u.test(char)) continue;
        if ((point >= 0xfe00 && point <= 0xfe0f) || (point >= 0xe0100 && point <= 0xe01ef))
          atlasFail(
            'SVG_FONT_VARIATION',
            id,
            'SVG variation sequences need explicit path conversion.',
            'Convert the requested glyph variants to paths.',
          );
        if (!available.some((font) => font.hasCharacter(point)))
          atlasFail(
            'SVG_FONT_GLYPH',
            id,
            `No supplied SVG fallback has U+${point.toString(16).toUpperCase()}.`,
            'Supply a font covering this character or convert text to paths.',
          );
      }
    }
    for (let c = 0; c < item.node.childNodes.length; c++) {
      const child = item.node.childNodes.item(c);
      if (child) queue.push({ node: child, depth: item.depth + 1, families, text: inText });
    }
  }
  return {
    svg: context ? new XMLSerializer().serializeToString(document) : svg,
    defaultFontFamily: context?.defaultFamily,
  };
}
