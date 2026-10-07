import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deserializeProject, serializeProject } from '@limber/core';
import { EditSceneMotionCommand } from '../src/commands/sceneMotionCommands';
import { EditSceneCommand, duplicateSceneCommand } from '../src/commands/sceneCommands';
import { HistoryManager } from '../src/history/history';
const json = readFileSync(new URL('../../../fixtures/bbbproj-v2-motion.json', import.meta.url), 'utf8');
const fresh = () => deserializeProject(json);

describe('scene motion commands', () => {
  it('upserts keys with stable IDs and reverses add/remove clip edits exactly', () => {
    const project = fresh(),
      board = project.artboards[0]!,
      history = new HistoryManager(),
      before = serializeProject(project);
    history.execute(
      new EditSceneMotionCommand(project, board.id, {
        kind: 'key',
        clipId: 'motion',
        nodeId: 'image-0',
        property: 'x',
        trackId: 'unused',
        key: { id: 'replacement', time: 1, value: 250, curve: { type: 'linear' } },
      }),
    );
    expect(board.clips![0]!.tracks[0]!.keys[1]!.id).toBe('x1');
    expect(board.clips![0]!.tracks[0]!.keys[1]!.value).toBe(250);
    history.undo();
    expect(serializeProject(project)).toBe(before);
    history.redo();
    expect(board.clips![0]!.tracks[0]!.keys[1]!.value).toBe(250);
    history.execute(new EditSceneMotionCommand(project, board.id, { kind: 'remove', clipId: 'motion' }));
    expect(board.clips).toHaveLength(0);
    history.undo();
    expect(board.clips).toHaveLength(1);
    history.undo();
    expect(serializeProject(project)).toBe(before);
  });
  it('moves, duplicates, curves and deletes multiple keys atomically', () => {
    const project = fresh(),
      board = project.artboards[0]!,
      history = new HistoryManager(),
      before = serializeProject(project);
    history.execute(
      new EditSceneMotionCommand(project, board.id, {
        kind: 'keys',
        clipId: 'motion',
        keyIds: ['x1', 'a1'],
        origin: 0,
        scale: 0.5,
        offset: 0,
      }),
    );
    expect(board.clips![0]!.tracks.map((track) => track.keys[1]!.time)).toEqual([0.5, 0.5]);
    history.execute(
      new EditSceneMotionCommand(project, board.id, {
        kind: 'keys',
        clipId: 'motion',
        keyIds: ['x1', 'a1'],
        origin: 0,
        scale: 1,
        offset: 0.25,
        duplicateIds: { x1: 'x-copy', a1: 'a-copy' },
      }),
    );
    history.execute(
      new EditSceneMotionCommand(project, board.id, {
        kind: 'curve',
        clipId: 'motion',
        keyIds: ['x1', 'a1'],
        curve: { type: 'bezier', c1: 0.4, c2: 0, c3: 0.6, c4: 1 },
      }),
    );
    expect(board.clips![0]!.tracks[0]!.keys[1]!.curve.type).toBe('bezier');
    history.execute(
      new EditSceneMotionCommand(project, board.id, {
        kind: 'deleteKeys',
        clipId: 'motion',
        keyIds: ['x-copy', 'a-copy', 'middle'],
      }),
    );
    expect(board.clips![0]!.events.map((event) => event.id)).toEqual(['start', 'end']);
    const after = serializeProject(project);
    for (let i = 0; i < 4; i++) history.undo();
    expect(serializeProject(project)).toBe(before);
    for (let i = 0; i < 4; i++) history.redo();
    expect(serializeProject(project)).toBe(after);
  });
  it('rejects colliding or out-of-range moves without changing source or redo', () => {
    const project = fresh(),
      board = project.artboards[0]!,
      history = new HistoryManager(),
      before = serializeProject(project);
    history.execute(
      new EditSceneMotionCommand(project, board.id, {
        kind: 'metadata',
        clipId: 'motion',
        patch: { name: 'Rename' },
      }),
    );
    history.undo();
    for (const offset of [-1, 1])
      expect(() =>
        history.execute(
          new EditSceneMotionCommand(project, board.id, {
            kind: 'keys',
            clipId: 'motion',
            keyIds: ['x1'],
            origin: 0,
            scale: 1,
            offset,
          }),
        ),
      ).toThrow();
    expect(serializeProject(project)).toBe(before);
    expect(history.canRedo).toBe(true);
  });
  it('duplicates animation targets and removes dangling tracks together with nodes', () => {
    const project = fresh(),
      board = project.artboards[0]!,
      history = new HistoryManager(),
      before = serializeProject(project);
    const duplicate = duplicateSceneCommand(project, board.id, ['image-0']);
    history.execute(duplicate);
    expect(board.clips![0]!.tracks).toHaveLength(3);
    const copy = board.clips![0]!.tracks[2]!;
    expect(copy.nodeId).not.toBe('image-0');
    expect(copy.keys[0]!.id).not.toBe('x0');
    const duplicated = serializeProject(project);
    history.undo();
    expect(serializeProject(project)).toBe(before);
    history.redo();
    expect(serializeProject(project)).toBe(duplicated);
    history.execute(new EditSceneCommand(project, board.id, { kind: 'remove', nodeIds: ['image-0'] }));
    expect(board.clips![0]!.tracks.some((track) => track.nodeId === 'image-0')).toBe(false);
    history.undo();
    expect(serializeProject(project)).toBe(duplicated);
    const replay = fresh();
    new EditSceneCommand(replay, board.id, duplicate.toJSON().edit).do();
    expect(serializeProject(replay)).toBe(duplicated);
  });
});
