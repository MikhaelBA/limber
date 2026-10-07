import { describe, expect, it } from 'vitest';
import { projectFromLegacy, sceneTransform, serializeProject, type GroupNode } from '@limber/core';
import { makeSkeletonData } from '../../core/tests/helpers';
import { seededRandom } from '../../core/tests/fixtures';
import { EditSceneCommand, duplicateSceneCommand, sceneSubtreeIds } from '../src/commands/sceneCommands';
import { CompositeCommand, HistoryManager, type Command } from '../src/history/history';

function fixture() {
  const project = projectFromLegacy({ skeleton: makeSkeletonData([]), animations: [], assetManifest: {} });
  const artboard = project.artboards[0]!;
  const group = (id: string, parentId: string | null = null): GroupNode => ({
    id,
    parentId,
    type: 'group',
    name: id,
    transform: sceneTransform(),
    opacity: 1,
    visible: true,
  });
  artboard.nodes.push(group('a'), group('b'), group('child', 'a'));
  return { project, artboard, group };
}

describe('scene edit transactions', () => {
  it('adds, edits and restores a node without changing identity or unrelated rig payloads', () => {
    const { project, artboard, group } = fixture();
    const original = serializeProject(project);
    const rig = artboard.nodes[0];
    const history = new HistoryManager();
    history.execute(new EditSceneCommand(project, artboard.id, { kind: 'add', node: group('new') }));
    history.execute(
      new EditSceneCommand(project, artboard.id, {
        kind: 'update',
        nodeId: 'new',
        patch: { name: 'Renamed', opacity: 0.4 },
      }),
    );
    expect(artboard.nodes.find((n) => n.id === 'new')?.name).toBe('Renamed');
    expect(artboard.nodes[0]).toBe(rig);
    history.undo();
    history.undo();
    expect(serializeProject(project)).toBe(original);
    history.redo();
    history.redo();
    expect(artboard.nodes.find((n) => n.id === 'new')?.opacity).toBe(0.4);
  });

  it('rejects parent cycles atomically and preserves the redo branch', () => {
    const { project, artboard } = fixture();
    const history = new HistoryManager();
    history.execute(
      new EditSceneCommand(project, artboard.id, { kind: 'update', nodeId: 'a', patch: { name: 'Changed' } }),
    );
    history.undo();
    const before = serializeProject(project);
    expect(() =>
      history.execute(
        new EditSceneCommand(project, artboard.id, { kind: 'reparent', nodeId: 'a', parentId: 'child' }),
      ),
    ).toThrow(/cycle/);
    expect(serializeProject(project)).toBe(before);
    expect(history.canRedo).toBe(true);
    history.redo();
    expect(artboard.nodes.find((n) => n.id === 'a')?.name).toBe('Changed');
  });

  it('reparents by stable ID and preserves local transforms', () => {
    const { project, artboard } = fixture();
    const before = serializeProject(project);
    const cmd = new EditSceneCommand(project, artboard.id, {
      kind: 'reparent',
      nodeId: 'child',
      parentId: 'b',
    });
    cmd.do();
    expect(artboard.nodes.find((n) => n.id === 'child')?.parentId).toBe('b');
    cmd.undo();
    expect(serializeProject(project)).toBe(before);
  });

  it('groups siblings reversibly and rejects selection across hierarchy levels', () => {
    const { project, artboard } = fixture();
    const before = serializeProject(project);
    const cmd = new EditSceneCommand(project, artboard.id, {
      kind: 'group',
      nodeIds: ['a', 'b'],
      groupId: 'group',
      name: 'Group',
    });
    cmd.do();
    expect(artboard.nodes.find((n) => n.id === 'a')?.parentId).toBe('group');
    expect(artboard.nodes.find((n) => n.id === 'child')?.parentId).toBe('a');
    cmd.undo();
    expect(serializeProject(project)).toBe(before);
    expect(() =>
      new EditSceneCommand(project, artboard.id, {
        kind: 'group',
        nodeIds: ['a', 'child'],
        groupId: 'group',
        name: 'Group',
      }).do(),
    ).toThrow(/siblings/);
  });

  it('deletes a subtree and restores all IDs and ordering on undo', () => {
    const { project, artboard } = fixture();
    const before = serializeProject(project);
    const cmd = new EditSceneCommand(project, artboard.id, { kind: 'remove', nodeIds: ['a', 'child'] });
    cmd.do();
    expect(artboard.nodes.some((n) => n.id === 'child')).toBe(false);
    cmd.undo();
    expect(serializeProject(project)).toBe(before);
  });

  it('updates active rig references when deleting and undoing a rig', () => {
    const { project, artboard } = fixture();
    const id = project.editor.activeRigId!;
    const cmd = new EditSceneCommand(project, artboard.id, { kind: 'remove', nodeIds: [id] });
    cmd.do();
    expect(project.editor.activeRigId).toBe(null);
    cmd.undo();
    expect(project.editor.activeRigId).toBe(id);
  });

  it('duplicates a hierarchy with fresh IDs and stable redo IDs', () => {
    const { project, artboard } = fixture();
    const before = serializeProject(project);
    const cmd = duplicateSceneCommand(project, artboard.id, ['a', 'child']);
    cmd.do();
    const after = serializeProject(project);
    const copy = artboard.nodes.find((n) => n.name === 'a copy')!;
    expect(copy.id).not.toBe('a');
    expect(artboard.nodes.some((n) => n.parentId === copy.id && n.id !== 'child')).toBe(true);
    expect(artboard.nodes).toHaveLength(6);
    cmd.undo();
    expect(serializeProject(project)).toBe(before);
    cmd.do();
    expect(serializeProject(project)).toBe(after);
  });

  it('reorders siblings without allowing cross-parent moves', () => {
    const { project, artboard } = fixture();
    const before = serializeProject(project);
    const cmd = new EditSceneCommand(project, artboard.id, { kind: 'reorder', nodeId: 'b', beforeId: 'a' });
    cmd.do();
    expect(artboard.nodes.findIndex((n) => n.id === 'b')).toBeLessThan(
      artboard.nodes.findIndex((n) => n.id === 'a'),
    );
    cmd.undo();
    expect(serializeProject(project)).toBe(before);
    expect(() =>
      new EditSceneCommand(project, artboard.id, { kind: 'reorder', nodeId: 'b', beforeId: 'child' }).do(),
    ).toThrow(/siblings/);
  });

  it('replays serializable intent against an identical starting project', () => {
    const { project, artboard } = fixture();
    const copy = structuredClone(project);
    const cmd = duplicateSceneCommand(project, artboard.id, ['a']);
    const replay = JSON.parse(JSON.stringify(cmd));
    cmd.do();
    new EditSceneCommand(copy, replay.artboardId, replay.edit).do();
    expect(copy).toEqual(project);
  });

  it('handles deep subtree selection without recursive overflow', () => {
    const { group } = fixture();
    const nodes = Array.from({ length: 10000 }, (_, i) => group(`n${i}`, i ? `n${i - 1}` : null));
    expect(sceneSubtreeIds(nodes, ['n0']).size).toBe(10000);
  });

  it('reverses 1000 seeded scene edits including structural commands exactly', () => {
    const { project, artboard, group } = fixture();
    const random = seededRandom();
    const history = new HistoryManager();
    for (let batch = 0; batch < 10; batch++) {
      history.clear();
      const before = serializeProject(project);
      for (let i = 0; i < 100; i++) {
        const id = `new-${batch}-${i}`;
        const cmd =
          i % 2
            ? new EditSceneCommand(project, artboard.id, {
                kind: 'update',
                nodeId: 'a',
                patch: { name: `Name ${random()}`, opacity: random() },
              })
            : new EditSceneCommand(project, artboard.id, {
                kind: 'add',
                node: group(id, random() > 0.5 ? 'a' : null),
              });
        history.execute(cmd);
      }
      const after = serializeProject(project);
      for (let i = 0; i < 100; i++) history.undo();
      expect(serializeProject(project)).toBe(before);
      for (let i = 0; i < 100; i++) history.redo();
      expect(serializeProject(project)).toBe(after);
    }
  });
});

describe('history failures', () => {
  it('rolls back completed composite parts when a later command fails', () => {
    let value = 0;
    const first: Command = {
      label: 'First',
      do: () => {
        value++;
      },
      undo: () => {
        value--;
      },
    };
    const fail: Command = {
      label: 'Fail',
      do: () => {
        throw new Error('Invalid edit');
      },
      undo: () => {},
    };
    const history = new HistoryManager();
    expect(() => history.execute(new CompositeCommand('Transaction', [first, fail]))).toThrow(/Invalid edit/);
    expect(value).toBe(0);
    expect(history.canUndo).toBe(false);
  });

  it('keeps an undo entry available when undo fails', () => {
    const history = new HistoryManager();
    history.execute({
      label: 'Failing undo',
      do: () => {},
      undo: () => {
        throw new Error('Try again');
      },
    });
    expect(() => history.undo()).toThrow(/Try again/);
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);
  });
});
