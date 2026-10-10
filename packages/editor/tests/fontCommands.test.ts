import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deserializeProject, serializeProject, type EmbeddedFont } from '@limber/core';
import { EditProjectFontsCommand } from '../src/commands/fontCommands';
import { HistoryManager } from '../src/history/history';

const source = () =>
  deserializeProject(
    readFileSync(new URL('../../../fixtures/bbbproj-v13-interactive.json', import.meta.url), 'utf8'),
  );
const font = (): EmbeddedFont => ({
  id: 'noto',
  family: 'Noto Sans Arabic',
  format: 'ttf',
  base64: readFileSync(new URL('../../editor/public/fonts/NotoSansArabic.ttf', import.meta.url)).toString(
    'base64',
  ),
  license: { name: 'Unspecified license', text: '', redistribution: 'unknown' },
});
describe('project font transactions', () => {
  it('owns imported bytes/metadata and restores the exact absent field across undo/redo/save/reopen', () => {
    const project = source(),
      before = serializeProject(project),
      input = font();
    const command = new EditProjectFontsCommand(project, [input]),
      history = new HistoryManager();
    input.base64 = '';
    input.license.name = 'changed';
    history.execute(command);
    expect(project.fonts).toEqual([font()]);
    const after = serializeProject(project);
    expect(deserializeProject(after).fonts).toEqual([font()]);
    history.undo();
    expect(serializeProject(project)).toBe(before);
    expect(Object.hasOwn(project, 'fonts')).toBe(false);
    history.redo();
    expect(serializeProject(project)).toBe(after);
    history.execute(new EditProjectFontsCommand(project, []));
    expect(project.fonts).toEqual([]);
    history.undo();
    expect(serializeProject(project)).toBe(after);
  });
  it('retains valid redo/source on malformed bytes, duplicate families and invalid license edits', () => {
    const project = source(),
      history = new HistoryManager();
    history.execute(new EditProjectFontsCommand(project, [font()]));
    history.undo();
    const before = serializeProject(project),
      damaged = font();
    damaged.base64 = 'AA==';
    expect(() => history.execute(new EditProjectFontsCommand(project, [damaged]))).toThrow();
    expect(serializeProject(project)).toBe(before);
    expect(history.canRedo).toBe(true);
    const duplicate = font();
    duplicate.id = 'other';
    duplicate.family = 'NOTO SANS ARABIC';
    expect(() => history.execute(new EditProjectFontsCommand(project, [font(), duplicate]))).toThrow();
    history.redo();
    const previous = serializeProject(project),
      licensed = font();
    licensed.license.redistribution = 'allowed';
    expect(() => history.execute(new EditProjectFontsCommand(project, [licensed]))).toThrow();
    expect(serializeProject(project)).toBe(previous);
  });
});
