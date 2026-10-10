import { describe, expect, it } from 'vitest';
import { serializeProject, SceneLogicPlayer } from '@limber/core';
import { logicBindingsFixture } from '../../../tools/logic-bindings-fixture.mjs';
import { EditLogicCommand } from '../src/commands/logicCommands';
import { EditSceneCommand, duplicateSceneCommand } from '../src/commands/sceneCommands';
import { EditUICommand } from '../src/commands/uiCommands';
import { HistoryManager } from '../src/history/history';
const owner = { artboardId: 'board', rigId: null };
describe('route authoring and structural transactions', () => {
  it('adds/edits/removes routes, retains parameter IDs on rename and restores deletion with exact history', () => {
    const p = logicBindingsFixture(),
      board = p.artboards[0]!,
      h = new HistoryManager(),
      before = serializeProject(p);
    h.execute(
      new EditLogicCommand(p, owner, {
        kind: 'addRoute',
        route: { id: 'click', targetId: 'instance', event: 'click', parameterId: 'label', value: 'Clicked' },
      }),
    );
    h.execute(
      new EditLogicCommand(p, owner, {
        kind: 'route',
        id: 'click',
        patch: { event: 'focus', value: 'Focused' },
      }),
    );
    const routed = serializeProject(p);
    h.execute(
      new EditLogicCommand(p, owner, {
        kind: 'parameter',
        id: 'label',
        parameter: { id: 'label', name: 'caption', type: 'string', initial: 'New default' },
      }),
    );
    const renamed = serializeProject(p),
      player = new SceneLogicPlayer(board, p.components);
    player.dispatch('focus', 'instance');
    player.update(1 / 120);
    expect(player.getParameter('caption')).toBe('Focused');
    h.execute(new EditLogicCommand(p, owner, { kind: 'removeParameter', id: 'label' }));
    expect(board.logic!.routes).toEqual([]);
    h.undo();
    expect(serializeProject(p)).toBe(renamed);
    h.undo();
    expect(serializeProject(p)).toBe(routed);
    h.execute(new EditLogicCommand(p, owner, { kind: 'removeRoute', id: 'click' }));
    expect(board.logic!.routes).toEqual([]);
    h.undo();
    h.undo();
    h.undo();
    expect(serializeProject(p)).toBe(before);
    h.redo();
    h.redo();
    expect(serializeProject(p)).toBe(routed);
  });
  it('duplicates target routes with stable fresh IDs, preserves viewport routes and deletes dependent routes', () => {
    const p = logicBindingsFixture(),
      board = p.artboards[0]!,
      h = new HistoryManager();
    board.logic!.routes = [
      { id: 'target', targetId: 'instance', event: 'pointerDown', parameterId: 'shown', value: false },
      { id: 'viewport', targetId: null, event: 'blur', parameterId: 'shown', value: true },
    ];
    const before = serializeProject(p),
      duplicate = duplicateSceneCommand(p, board.id, ['instance']);
    h.execute(duplicate);
    const after = serializeProject(p);
    expect(board.logic!.routes).toHaveLength(3);
    expect(new Set(board.logic!.routes!.map((r) => r.id)).size).toBe(3);
    h.execute(new EditSceneCommand(p, board.id, { kind: 'remove', nodeIds: ['instance'] }));
    expect(board.logic!.routes).toHaveLength(2);
    expect(board.logic!.routes!.some((r) => r.id === 'viewport')).toBe(true);
    h.undo();
    expect(serializeProject(p)).toBe(after);
    h.undo();
    expect(serializeProject(p)).toBe(before);
    h.redo();
    expect(serializeProject(p)).toBe(after);
  });
  it('rejects route types/identity/targets/domains and extraction atomically without clearing redo', () => {
    const p = logicBindingsFixture(),
      h = new HistoryManager();
    h.execute(
      new EditLogicCommand(p, owner, {
        kind: 'addRoute',
        route: { id: 'target', targetId: 'direct', event: 'click', parameterId: 'alpha', value: 0.25 },
      }),
    );
    const before = serializeProject(p);
    h.execute(new EditLogicCommand(p, owner, { kind: 'settings', patch: { enabled: false } }));
    h.undo();
    for (const patch of [{ targetId: 'missing' }, { value: 2 }, { value: '2' }, { id: 'changed' }]) {
      expect(() =>
        h.execute(new EditLogicCommand(p, owner, { kind: 'route', id: 'target', patch: patch as never })),
      ).toThrow();
      expect(serializeProject(p)).toBe(before);
      expect(h.canRedo).toBe(true);
    }
    delete (p.artboards[0]!.nodes[1] as { binding?: string }).binding;
    const clean = serializeProject(p);
    expect(() =>
      h.execute(
        new EditUICommand(p, {
          kind: 'extract',
          artboardId: 'board',
          nodeId: 'direct',
          componentId: 'extracted',
          idMap: { direct: 'child' },
        }),
      ),
    ).toThrow(/Logic/);
    expect(serializeProject(p)).toBe(clean);
    expect(h.canRedo).toBe(true);
  });
});
