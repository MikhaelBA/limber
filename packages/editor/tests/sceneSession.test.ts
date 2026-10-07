import { describe, expect, it } from 'vitest';
import { sceneTransform, serializeProject, type RigNode } from '@limber/core';
import { EditorEngine } from '../src/engine/EditorEngine';
import { EditArtboardCommand } from '../src/commands/artboardCommands';
import { EditSceneCommand } from '../src/commands/sceneCommands';
import { AddBoneCommand } from '../src/commands/boneCommands';
import { HistoryManager } from '../src/history/history';

describe('multi-artboard command routing', () => {
  it('routes old commands to the originating rig after changing artboards', () => {
    const engine = new EditorEngine(),
      history = new HistoryManager();
    const original = { ...engine.project.editor };
    const rig = structuredClone(engine.project.artboards[0]!.nodes[0]!) as RigNode;
    rig.id = 'second'; // Internal bone IDs intentionally match, testing isolation rather than lookup failure.
    const add = new AddBoneCommand(engine, null, { x: 12, y: 34 });
    history.execute(engine.bindCommand(add));
    new EditArtboardCommand(engine.project, {
      kind: 'add',
      artboard: { id: 'board2', name: 'Second', width: 100, height: 100, nodes: [rig] },
    }).do();
    engine.focusRig('board2', rig.id);
    expect(engine.skeleton.data.bones).toHaveLength(1);
    history.undo();
    expect(engine.project.editor).toEqual(original);
    expect(engine.skeleton.data.bones).toHaveLength(1);
    expect(rig.skeleton.bones).toHaveLength(1);
    engine.focusRig('board2', rig.id);
    history.redo();
    expect(engine.project.editor).toEqual(original);
    expect(engine.skeleton.boneIndexMap.has(add.boneId)).toBe(true);
    expect(rig.skeleton.bones).toHaveLength(1);
  });

  it('deletes an active rig, restores it, then undoes its edits safely', () => {
    const engine = new EditorEngine(),
      history = new HistoryManager();
    const { activeArtboardId, activeRigId } = engine.project.editor;
    const before = serializeProject(engine.project);
    history.execute(engine.bindCommand(new AddBoneCommand(engine, null, { x: 1, y: 2 })));
    history.execute(
      engine.bindCommand(
        new EditSceneCommand(engine.project, activeArtboardId, { kind: 'remove', nodeIds: [activeRigId!] }),
      ),
    );
    expect(engine.project.editor.activeRigId).toBeNull();
    expect(engine.skeleton.data.bones).toHaveLength(0);
    history.undo();
    expect(engine.skeleton.data.bones).toHaveLength(2);
    history.undo();
    expect(serializeProject(engine.project)).toBe(before);
    history.redo();
    history.redo();
    expect(engine.project.editor.activeRigId).toBeNull();
  });

  it('reversibly removes an active artboard and rejects invalid dimensions atomically', () => {
    const engine = new EditorEngine(),
      history = new HistoryManager();
    const before = serializeProject(engine.project);
    history.execute(
      engine.bindCommand(
        new EditArtboardCommand(engine.project, {
          kind: 'add',
          artboard: { id: 'ui', name: 'UI', width: 320, height: 640, nodes: [] },
        }),
      ),
    );
    engine.focusRig('ui', null);
    history.execute(
      engine.bindCommand(new EditArtboardCommand(engine.project, { kind: 'remove', id: 'ui' })),
    );
    expect(engine.project.artboards).toHaveLength(1);
    history.undo();
    expect(engine.project.editor.activeArtboardId).toBe('ui');
    history.undo();
    expect(serializeProject(engine.project)).toBe(before);
    expect(() =>
      history.execute(
        engine.bindCommand(
          new EditArtboardCommand(engine.project, {
            kind: 'update',
            id: engine.project.editor.activeArtboardId,
            patch: { width: -1 },
          }),
        ),
      ),
    ).toThrow();
    expect(serializeProject(engine.project)).toBe(before);
    expect(history.canRedo).toBe(true);
    expect(() =>
      new EditArtboardCommand(engine.project, {
        kind: 'remove',
        id: engine.project.editor.activeArtboardId,
      }).do(),
    ).toThrow(/at least one/);
  });

  it('accepts grouped transformed rigs while retaining source identity', () => {
    const engine = new EditorEngine();
    const project = engine.project;
    const artboard = project.artboards[0]!,
      rig = artboard.nodes[0]!;
    artboard.nodes.push({
      id: 'group',
      name: 'Group',
      type: 'group',
      parentId: null,
      transform: { ...sceneTransform(), scaleX: -2 },
      opacity: 0.5,
      visible: true,
    });
    rig.parentId = 'group';
    rig.transform.pivotX = 30;
    engine.loadProject(project);
    expect(engine.document.skeleton).toBe((rig as RigNode).skeleton);
  });
});
