import {
  FontFormatError,
  fontFamilyKey,
  isGenericFontFamily,
  validateEmbeddedFonts,
  type EmbeddedFont,
  type OpenTypeInspection,
} from '@limber/core';
import { runtimeFail, type RuntimeDiagnostic, type RuntimeProgram } from './model';

export function runtimeFontRequirements(
  source: Pick<RuntimeProgram, 'artboards' | 'components'>,
): { nodeId: string; families: readonly string[]; text: string }[] {
  return [...source.artboards, ...source.components].flatMap((board) =>
    board.nodes.flatMap((node) =>
      node.type === 'text' ? [{ nodeId: node.id, families: [...node.fontFamilies], text: node.text }] : [],
    ),
  );
}
export function validateNativeFonts(program: RuntimeProgram): Map<string, OpenTypeInspection> {
  let inspected: Map<string, OpenTypeInspection>;
  try {
    inspected = validateEmbeddedFonts(program.fonts);
  } catch (error) {
    if (error instanceof FontFormatError)
      runtimeFail(
        error.code,
        error.message,
        error.objectId,
        'Reimport valid OpenType bytes and retain their license metadata.',
      );
    throw error;
  }
  const referenced = new Set(runtimeFontRequirements(program).flatMap((r) => r.families.map(fontFamilyKey)));
  for (const font of program.fonts)
    if (!referenced.has(fontFamilyKey(font.family)))
      runtimeFail(
        'UNUSED_FONT',
        'The runtime contains an unreferenced font.',
        font.id,
        'Recompile to remove unused fonts.',
      );
  return inspected;
}
/** Package only declared fallback families, with no implicit discovery of OS font files. */
export function referencedEmbeddedFonts(
  source: Pick<RuntimeProgram, 'artboards' | 'components'>,
  fonts: readonly EmbeddedFont[],
): EmbeddedFont[] {
  const referenced = new Set(runtimeFontRequirements(source).flatMap((r) => r.families.map(fontFamilyKey)));
  return structuredClone(fonts.filter((font) => referenced.has(fontFamilyKey(font.family)))).sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
}
/** Coverage is default Unicode cmap evidence, never a promise of contextual shaping parity. */
export function diagnoseNativeFonts(program: RuntimeProgram): RuntimeDiagnostic[] {
  const inspected = validateNativeFonts(program),
    diagnostics: RuntimeDiagnostic[] = [];
  const warn = (code: string, objectId: string, explanation: string, remedy: string) =>
    diagnostics.push({ code, severity: 'warning', objectId, explanation, remedy });
  for (const font of program.fonts) {
    const flags = inspected.get(fontFamilyKey(font.family))!.embeddingFlags;
    if (font.license.redistribution !== 'allowed')
      warn(
        'FONT_LICENSE',
        font.id,
        `Font "${font.family}" has ${font.license.redistribution} redistribution metadata.`,
        'Record the applicable redistribution license or replace this font before distribution.',
      );
    if (flags & (2 | 4 | 512))
      warn(
        'FONT_EMBEDDING_FLAGS',
        font.id,
        `Font "${font.family}" declares embedding flags 0x${flags.toString(16)}.`,
        'Check the font license and embedding restrictions before shipping this font.',
      );
  }
  let remaining = 262144,
    limited = false;
  for (const node of runtimeFontRequirements(program)) {
    const names = node.families.filter((f) => !isGenericFontFamily(f) && !inspected.has(fontFamilyKey(f)));
    if (names.length)
      warn(
        'EXTERNAL_FONT',
        node.nodeId,
        `Text depends on host fonts: ${names.join(', ')}.`,
        'Embed the declared OpenType fonts or explicitly supply them in the target host.',
      );
    const coverage = node.families
      .map((f) => inspected.get(fontFamilyKey(f)))
      .filter((f): f is OpenTypeInspection => !!f);
    const missing = new Set<number>();
    let variation = false;
    for (const char of node.text) {
      if (--remaining < 0) {
        if (!limited)
          warn(
            'FONT_COVERAGE_LIMIT',
            node.nodeId,
            'Static glyph inspection reached its bounded text budget.',
            'Inspect long/localized runtime values in the target renderer.',
          );
        limited = true;
        break;
      }
      const point = char.codePointAt(0)!;
      if ((point >= 0xfe00 && point <= 0xfe0f) || (point >= 0xe0100 && point <= 0xe01ef)) {
        variation = true;
        continue;
      }
      if (/^[\p{Cc}\p{Cf}]$/u.test(char)) continue;
      if (!coverage.some((font) => font.hasCharacter(point))) missing.add(point);
    }
    if (missing.size) {
      const sample = [...missing]
        .slice(0, 16)
        .map((p) => `U+${p.toString(16).toUpperCase().padStart(4, '0')}`)
        .join(', ');
      warn(
        'FONT_FALLBACK',
        node.nodeId,
        `${missing.size} static character(s) lack packaged glyphs (${sample}); host fallback remains required.`,
        'Embed a fallback font covering these characters in the authored family order and preview localization values.',
      );
    }
    if (variation)
      warn(
        'FONT_VARIATION_UNVERIFIED',
        node.nodeId,
        'Text contains Unicode variation selectors; cmap coverage alone does not verify the requested variant.',
        'Verify variation sequences and contextual shaping in the target renderer.',
      );
    if (node.families.some(isGenericFontFamily))
      warn(
        'SYSTEM_FONT_FALLBACK',
        node.nodeId,
        'The authored fallback list includes host system font families.',
        'Use packaged fallback families when identical glyph selection across devices is required.',
      );
  }
  return diagnostics;
}
