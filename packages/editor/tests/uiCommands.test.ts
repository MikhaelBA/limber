import { describe, expect, it } from 'vitest';
import { expandUIComponents, serializeProject, type TextNode } from '@limber/core';
import { uiFixture, uiText } from '../../core/tests/uiFixtures';
import { EditUICommand } from '../src/commands/uiCommands';
import { HistoryManager } from '../src/history/history';

describe('component transactions', () => {
  it('propagates defaults with stable overrides and revisions through undo/redo', () => {
    const project = uiFixture(),
      history = new HistoryManager(),
      before = serializeProject(project);
    const definition = structuredClone(project.components![0]!);
    (definition.nodes[0] as TextNode).text = 'New default';
    history.execute(new EditUICommand(project, { kind: 'component', component: definition }));
    expect(project.components![0]!.revision).toBe(2);
    expect((expandUIComponents(project, project.artboards[0]!).artboard.nodes[1] as TextNode).text).toBe(
      'Claim 123',
    );
    const after = serializeProject(project);
    history.undo();
    expect(serializeProject(project)).toBe(before);
    history.redo();
    expect(serializeProject(project)).toBe(after);
  });
  it('rejects destructive exposed-property changes and removal without corrupting redo', () => {
    const project = uiFixture(),
      history = new HistoryManager(),
      before = serializeProject(project);
    const definition = structuredClone(project.components![0]!);
    history.execute(new EditUICommand(project, { kind: 'component', component: definition }));
    history.undo();
    definition.nodes.push(uiText('other'));
    definition.exposed[0]!.nodeId = 'other';
    expect(() =>
      history.execute(new EditUICommand(project, { kind: 'component', component: definition })),
    ).toThrow(/migration/);
    expect(history.canRedo).toBe(true);
    expect(serializeProject(project)).toBe(before);
    expect(() =>
      history.execute(new EditUICommand(project, { kind: 'removeComponent', componentId: definition.id })),
    ).toThrow(/missing/);
    expect(serializeProject(project)).toBe(before);
  });
});
