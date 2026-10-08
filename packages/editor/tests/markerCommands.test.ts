import { describe, expect, it } from 'vitest';
import { deserializeProject, serializeProject } from '@limber/core';
import { EditorEngine } from '../src/engine/EditorEngine';
import { EditMarkerCommand, createMarker } from '../src/commands/markerCommands';
import { RemoveBoneCommand } from '../src/commands/boneCommands';
import { HistoryManager } from '../src/history/history';

describe('marker authoring commands', () => {
  it('adds, edits, saves and deletes markers with exact source undo and stable redo IDs', () => {
    const engine = new EditorEngine(),
      history = new HistoryManager();
    const marker = createMarker(engine.skeleton.data.bones[0]!.id);
    const before = structuredClone(engine.project);
    history.execute(new EditMarkerCommand(engine, { kind: 'put', marker }));
    expect(deserializeProject(serializeProject(engine.project))).toEqual(engine.project);
    history.undo();
    expect(engine.project).toEqual(before); // No stale optional markers field remains.
    history.redo();
    history.execute(
      new EditMarkerCommand(engine, {
        kind: 'put',
        marker: { ...marker, name: 'Weapon', transform: { ...marker.transform, x: 30 } },
      }),
    );
    expect(engine.skeleton.data.markers![0]!.name).toBe('Weapon');
    history.execute(new EditMarkerCommand(engine, { kind: 'remove', markerId: marker.id }));
    expect(engine.skeleton.data.markers).toEqual([]);
    history.undo();
    history.undo();
    expect(engine.skeleton.data.markers).toEqual([marker]);
    history.execute(new RemoveBoneCommand(engine, marker.boneId));
    expect(engine.skeleton.data.markers).toEqual([]);
    history.undo();
    expect(engine.skeleton.data.markers).toEqual([marker]);
  });

  it('rejects invalid edits and animate-mode authoring without changing setup, tracks or history', () => {
    const engine = new EditorEngine(),
      history = new HistoryManager();
    const marker = createMarker(engine.skeleton.data.bones[0]!.id, 'hurtbox');
    history.execute(new EditMarkerCommand(engine, { kind: 'put', marker }));
    history.undo();
    const before = structuredClone(engine.project);
    expect(() =>
      history.execute(
        new EditMarkerCommand(engine, { kind: 'put', marker: { ...marker, boneId: 'missing' } }),
      ),
    ).toThrow();
    engine.mode = 'animate';
    expect(() => history.execute(new EditMarkerCommand(engine, { kind: 'put', marker }))).toThrow(/Setup/);
    expect(engine.project).toEqual(before);
    expect(history.canRedo).toBe(true);
    history.redo(); // History replay stays valid even after a mode switch.
    expect(engine.skeleton.data.markers).toEqual([marker]);
    expect(engine.document.animations).toEqual([]);
  });
});
