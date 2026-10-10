import { describe, expect, it } from 'vitest';
import { serializeProject, type TextNode } from '@limber/core';
import { logicBindingsFixture } from '../../../tools/logic-bindings-fixture.mjs';
import { EditLogicCommand } from '../src/commands/logicCommands';
import { EditSceneCommand, duplicateSceneCommand } from '../src/commands/sceneCommands';
import { EditUICommand } from '../src/commands/uiCommands';
import { HistoryManager } from '../src/history/history';
const owner = { artboardId: 'board', rigId: null };
describe('atomic binding authoring and structural history', () => {
  it('renames/deletes direct text references and explicit bindings with exact undo/redo and dormant graph removal', () => {
    const p = logicBindingsFixture(),
      board = p.artboards[0]!,
      h = new HistoryManager(),
      before = serializeProject(p),
      text = board.nodes[1] as TextNode,
      defs = p.components;
    h.execute(
      new EditLogicCommand(p, owner, {
        kind: 'parameter',
        id: 'label',
        parameter: { id: 'label', name: 'caption', type: 'string', initial: 'new' },
      }),
    );
    expect(text.binding).toBe('caption');
    const renamed = serializeProject(p);
    h.execute(new EditLogicCommand(p, owner, { kind: 'removeParameter', id: 'label' }));
    expect(Object.hasOwn(text, 'binding')).toBe(false);
    expect(board.logic!.bindings).toHaveLength(3);
    h.undo();
    expect(serializeProject(p)).toBe(renamed);
    h.undo();
    expect(serializeProject(p)).toBe(before);
    h.redo();
    expect(serializeProject(p)).toBe(renamed);
    h.redo();
    expect(Object.hasOwn(text, 'binding')).toBe(false);
    expect(p.components).toBe(defs);
    h.undo();
    h.execute(new EditLogicCommand(p, owner, { kind: 'removeGraph' }));
    expect(text.binding).toBe('caption');
    h.undo();
    expect(serializeProject(p)).toBe(renamed);
  });
  it('adds/patches/removes bindings and rejects bad types/identities without losing redo', () => {
    const p = logicBindingsFixture(),
      h = new HistoryManager(),
      before = serializeProject(p);
    h.execute(new EditLogicCommand(p, owner, { kind: 'removeBinding', id: 'binding-0' }));
    h.execute(
      new EditLogicCommand(p, owner, {
        kind: 'addBinding',
        binding: {
          id: 'new',
          parameterId: 'label',
          instanceId: 'instance',
          exposureName: 'text',
          property: 'text',
        },
      }),
    );
    const added = serializeProject(p);
    h.execute(
      new EditLogicCommand(p, owner, { kind: 'binding', id: 'new', patch: { parameterId: 'label' } }),
    );
    h.undo();
    for (const patch of [{ parameterId: 'shown' }, { instanceId: 'missing' }, { id: 'changed' }]) {
      expect(() =>
        h.execute(new EditLogicCommand(p, owner, { kind: 'binding', id: 'new', patch: patch as never })),
      ).toThrow();
      expect(serializeProject(p)).toBe(added);
      expect(h.canRedo).toBe(true);
    }
    h.redo();
    h.undo();
    h.undo();
    h.undo();
    expect(serializeProject(p)).toBe(before);
  });
  it('duplicates/removes all dependent bindings with stable IDs and exact history', () => {
    const p = logicBindingsFixture(),
      board = p.artboards[0]!,
      h = new HistoryManager(),
      before = serializeProject(p),
      defs = p.components;
    const duplicate = duplicateSceneCommand(p, board.id, ['instance']);
    h.execute(duplicate);
    const after = serializeProject(p),
      id =
        duplicate.toJSON().edit.kind === 'duplicate'
          ? (duplicate.toJSON().edit as { idMap: Record<string, string> }).idMap.instance!
          : '';
    expect(board.logic!.bindings).toHaveLength(8);
    expect(new Set(board.logic!.bindings!.map((b) => b.id)).size).toBe(8);
    h.execute(new EditSceneCommand(p, board.id, { kind: 'remove', nodeIds: ['instance'] }));
    expect(board.logic!.bindings).toHaveLength(4);
    expect(board.logic!.bindings!.every((b) => b.instanceId === id)).toBe(true);
    h.undo();
    expect(serializeProject(p)).toBe(after);
    h.undo();
    expect(serializeProject(p)).toBe(before);
    h.redo();
    expect(serializeProject(p)).toBe(after);
    expect(p.components).toBe(defs);
  });
  it('rejects duplicate identity collisions, destructive exposure edits and extraction before publication', () => {
    const p = logicBindingsFixture(),
      h = new HistoryManager();
    h.execute(new EditLogicCommand(p, owner, { kind: 'settings', patch: { enabled: false } }));
    h.undo();
    const before = serializeProject(p),
      component = structuredClone(p.components![0]!);
    component.nodes.push({ ...component.nodes[0]!, id: 'other' });
    component.exposed[0]!.nodeId = 'other';
    for (const cmd of [
      new EditSceneCommand(p, 'board', {
        kind: 'duplicate',
        nodeIds: ['instance'],
        idMap: { instance: 'copy' },
        bindingIdMap: { 'binding-0': 'entry', 'binding-1': 'b', 'binding-2': 'c', 'binding-3': 'd' },
      }),
      new EditUICommand(p, { kind: 'component', component }),
      new EditUICommand(p, {
        kind: 'extract',
        artboardId: 'board',
        nodeId: 'direct',
        componentId: 'extracted',
        idMap: { direct: 'child' },
      }),
      new EditUICommand(p, {
        kind: 'extract',
        artboardId: 'board',
        nodeId: 'instance',
        componentId: 'extracted',
        idMap: { instance: 'child' },
      }),
    ]) {
      expect(() => h.execute(cmd)).toThrow();
      expect(serializeProject(p)).toBe(before);
      expect(h.canRedo).toBe(true);
    }
  });
  it('preflights stale text targets before publishing graph or other text metadata', () => {
    const p = logicBindingsFixture(),
      board = p.artboards[0]!,
      text = board.nodes[1] as TextNode;
    board.nodes.push({ ...text, id: 'second' });
    const cmd = new EditLogicCommand(p, owner, {
      kind: 'parameter',
      id: 'label',
      parameter: { id: 'label', name: 'caption', type: 'string', initial: '' },
    });
    cmd.do();
    board.nodes = board.nodes.filter((n) => n.id !== 'second');
    const before = serializeProject(p);
    expect(() => cmd.undo()).toThrow(/no longer exists/);
    expect(serializeProject(p)).toBe(before);
    expect(text.binding).toBe('caption');
  });
});
