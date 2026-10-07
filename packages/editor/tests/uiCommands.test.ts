import { describe, expect, it } from 'vitest';
import { expandUIComponents, serializeProject, evaluateScene, uiLayout, type TextNode } from '@limber/core';
import { uiFixture, uiText, uiBase } from '../../core/tests/uiFixtures';
import { AddUITemplateCommand, rewardTemplate } from '../src/commands/uiTemplateCommands';
import { EditUICommand } from '../src/commands/uiCommands';
import { HistoryManager } from '../src/history/history';

describe('component transactions', () => {
  it('extracts a transformed responsive subtree without moving it and undoes exactly', () => {
    const project = uiFixture(),
      board = project.artboards[0]!,
      history = new HistoryManager();
    const text = uiText('authored-text');
    text.parentId = 'root-group';
    text.transform.x = 18;
    board.nodes = [{ ...uiBase('root-group'), type: 'group', layout: uiLayout(300, 100) }, text];
    board.nodes[0]!.transform.rotation = 0.3;
    board.nodes[0]!.transform.scaleX = 1.2;
    const before = serializeProject(project),
      world = evaluateScene(board).find((e) => e.node.id === text.id)!.world;
    history.execute(
      new EditUICommand(project, {
        kind: 'extract',
        artboardId: board.id,
        nodeId: 'root-group',
        componentId: 'extracted',
        idMap: { 'root-group': 'definition-root', 'authored-text': 'definition-text' },
      }),
    );
    const expanded = evaluateScene(expandUIComponents(project, project.artboards[0]!).artboard).find(
      (e) => e.node.type === 'text',
    )!;
    expanded.world.forEach((value, i) => expect(value).toBeCloseTo(world[i]!));
    expect(project.artboards[0]!.nodes).toHaveLength(1);
    const after = serializeProject(project);
    history.undo();
    expect(serializeProject(project)).toBe(before);
    history.redo();
    expect(serializeProject(project)).toBe(after);
  });
  it('adds templates with fresh identities and rejects repeated invalid command attempts atomically', () => {
    const project = uiFixture(),
      history = new HistoryManager(),
      before = serializeProject(project);
    history.execute(new AddUITemplateCommand(project, rewardTemplate()));
    history.execute(new AddUITemplateCommand(project, rewardTemplate()));
    expect(project.artboards).toHaveLength(3);
    history.undo();
    history.undo();
    expect(serializeProject(project)).toBe(before);
    const invalid = rewardTemplate();
    invalid.artboards[0]!.id = project.artboards[0]!.id;
    const command = new AddUITemplateCommand(project, invalid);
    expect(() => history.execute(command)).toThrow();
    expect(() => history.execute(command)).toThrow();
    expect(serializeProject(project)).toBe(before);
    expect(history.canRedo).toBe(true);
  });
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
