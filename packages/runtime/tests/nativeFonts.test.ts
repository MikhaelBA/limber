import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deserializeProject, type EmbeddedFont, type TextNode } from '@limber/core';
import {
  compileRuntime,
  loadRuntime,
  encodeRuntime,
  validateRuntimeProgram,
  NativeRuntimeAsset,
  NativeArtboardPlayer,
  RuntimeFormatError,
} from '@limber/runtime';

const font = (): EmbeddedFont => ({
  id: 'noto',
  family: 'Noto Sans Arabic',
  format: 'ttf',
  base64: readFileSync(new URL('../../editor/public/fonts/NotoSansArabic.ttf', import.meta.url)).toString(
    'base64',
  ),
  license: {
    name: 'SIL Open Font License 1.1',
    redistribution: 'allowed',
    text: readFileSync(new URL('../../editor/public/fonts/OFL-NotoSansArabic.txt', import.meta.url), 'utf8'),
    sourceUrl: 'https://github.com/google/fonts/tree/main/ofl/notosansarabic',
  },
});
function source() {
  const project = deserializeProject(
    readFileSync(new URL('../../../fixtures/bbbproj-v13-interactive.json', import.meta.url), 'utf8'),
  );
  for (const board of [...project.artboards, ...(project.components ?? [])])
    for (const node of board.nodes) if (node.type === 'text') node.fontFamilies = ['Noto Sans Arabic'];
  project.fonts = [font()];
  return project;
}
const text = (project: ReturnType<typeof source>) => {
  const node = [...project.artboards, ...(project.components ?? [])]
    .flatMap((b) => b.nodes)
    .find((n) => n.type === 'text');
  if (!node) throw new Error('Fixture needs text.');
  return node as TextNode;
};
describe('native packaged fonts', () => {
  it('ships actual font bytes and license once, preserves fallback order and source, and reloads independent players', () => {
    const project = source(),
      before = structuredClone(project),
      { program, diagnostics } = compileRuntime(project);
    expect(program.features).toContain('fonts');
    expect(program.fonts).toEqual([font()]);
    expect(diagnostics.filter((d) => d.code === 'EXTERNAL_FONT')).toEqual([]);
    expect(diagnostics.filter((d) => d.code === 'FONT_LICENSE')).toEqual([]);
    const decoded = loadRuntime(encodeRuntime(program));
    expect(decoded).toEqual(program);
    expect(JSON.stringify(program).split(font().base64).length).toBe(2);
    const asset = new NativeRuntimeAsset(decoded);
    expect(asset.getFonts()).toEqual([font()]);
    const copy = asset.getFonts() as EmbeddedFont[];
    copy[0]!.license.text = 'changed';
    copy[0]!.base64 = '';
    expect(asset.getFonts()).toEqual([font()]);
    expect(new NativeArtboardPlayer(asset).getView().nodes.length).toBeGreaterThan(0);
    expect(project).toEqual(before);
  });
  it('keeps unused source fonts out of the runtime and reports missing glyph/fallback and external families', () => {
    const project = source(),
      unused = font();
    unused.id = 'unused';
    unused.family = 'Unused';
    project.fonts!.push(unused);
    const node = text(project);
    node.text = 'سلام A 🦊';
    node.fontFamilies = ['Absent', 'NOTO SANS ARABIC', 'sans-serif'];
    const { program, diagnostics } = compileRuntime(project);
    expect(program.fonts.map((f) => f.id)).toEqual(['noto']);
    const out =
      program.artboards.flatMap((b) => b.nodes).find((n) => n.id === node.id) ??
      program.components.flatMap((b) => b.nodes).find((n) => n.id === node.id);
    expect((out as TextNode).fontFamilies).toEqual(node.fontFamilies);
    expect(
      diagnostics.find((d) => d.objectId === node.id && d.code === 'FONT_FALLBACK')!.explanation,
    ).toContain('U+1F98A');
    expect(diagnostics.some((d) => d.objectId === node.id && d.code === 'SYSTEM_FONT_FALLBACK')).toBe(true);
    expect(
      diagnostics.find((d) => d.objectId === node.id && d.code === 'EXTERNAL_FONT')!.explanation,
    ).toContain('Absent');
  });
  it('reports redistribution metadata, embedding flags and variation evidence without replacing font bytes', () => {
    const project = source(),
      f = project.fonts![0]!;
    f.license.redistribution = 'unknown';
    const bytes = Buffer.from(f.base64, 'base64');
    for (let i = 0; i < bytes.readUInt16BE(4); i++) {
      const p = 12 + i * 16;
      if (bytes.toString('ascii', p, p + 4) === 'OS/2') bytes.writeUInt16BE(2, bytes.readUInt32BE(p + 8) + 8);
    }
    f.base64 = bytes.toString('base64');
    text(project).text = 'A\ufe0f';
    const { program, diagnostics } = compileRuntime(project);
    for (const code of ['FONT_LICENSE', 'FONT_EMBEDDING_FLAGS', 'FONT_VARIATION_UNVERIFIED'])
      expect(diagnostics.some((d) => d.code === code)).toBe(true);
    expect(program.fonts[0]!.base64).toBe(f.base64);
  });
  it('strictly rejects duplicate/unused/unknown font metadata and mismatched capabilities', () => {
    const original = compileRuntime(source()).program;
    const reject = (patch: (p: typeof original) => void, code: string) => {
      const p = structuredClone(original);
      patch(p);
      try {
        validateRuntimeProgram(p);
        throw new Error('Expected rejection.');
      } catch (error) {
        expect(error).toBeInstanceOf(RuntimeFormatError);
        expect((error as RuntimeFormatError).diagnostic.code).toBe(code);
      }
    };
    reject((p) => p.fonts.push({ ...font(), id: 'another' }), 'FONT_METADATA');
    reject((p) => (p.fonts[0]!.family = 'Unused'), 'UNUSED_FONT');
    reject((p) => Object.assign(p.fonts[0]!.license, { silentPermission: true }), 'UNKNOWN_FIELD');
    reject((p) => (p.features = p.features.filter((f) => f !== 'fonts')), 'FEATURE_MISMATCH');
    reject((p) => (p.fonts[0]!.base64 = 'AA=='), 'FONT_STRUCTURE');
  });
});
