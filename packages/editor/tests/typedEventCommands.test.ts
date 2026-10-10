import { describe, it, expect } from 'vitest';
import { activeRigNode, serializeProject, type TypedEventPayload } from '@limber/core';
import { EditorEngine } from '../src/engine/EditorEngine';
import { AddAnimationCommand, KeyEventCommand } from '../src/commands/animationCommands';
import { EditSceneMotionCommand } from '../src/commands/sceneMotionCommands';
import { HistoryManager } from '../src/history/history';
function boot() {
  const engine = new EditorEngine(),
    add = new AddAnimationCommand(engine);
  add.do();
  engine.setAnimation(add.name);
  engine.mode = 'animate';
  return engine;
}
describe('atomic typed event authoring', () => {
  it('captures payload/time, restores clip length and preserves exact rig history after playhead moves', () => {
    const engine = boot(),
      history = new HistoryManager(),
      before = serializeProject(engine.project);
    engine.currentAnimation!.duration = 0.1;
    engine.currentTime = 0.5;
    const initial = serializeProject(engine.project),
      payload: TypedEventPayload = { type: 'float', value: 0.1 };
    const command = new KeyEventCommand(engine, 'Haptic', payload);
    payload.value = 12;
    history.execute(command);
    const after = serializeProject(engine.project);
    expect(engine.currentAnimation!.duration).toBe(0.5);
    const key = engine.currentAnimation!.timelines[0]!.keyframes[0] as {
      payload: TypedEventPayload;
      time: number;
    };
    expect(key.payload).toEqual({ type: 'float', value: 0.1 });
    expect(key.time).toBe(0.5);
    engine.currentTime = 0;
    history.undo();
    expect(serializeProject(engine.project)).toBe(initial);
    history.redo();
    expect(serializeProject(engine.project)).toBe(after);
    history.undo();
    expect(serializeProject(engine.project)).toBe(initial);
    expect(before).not.toBe(initial);
  });
  it('rejects malformed rig edits without clearing redo, including the shared event count limit', () => {
    const engine = boot(),
      history = new HistoryManager();
    history.execute(new KeyEventCommand(engine, 'UIConfirm', { type: 'bool', value: true }));
    history.undo();
    const before = serializeProject(engine.project);
    for (const payload of [
      { type: 'bool', value: 1 },
      { type: 'int', value: 1.5 },
      { type: 'float', value: NaN },
    ])
      expect(() => history.execute(new KeyEventCommand(engine, 'bad', payload as TypedEventPayload))).toThrow(
        /payload/,
      );
    expect(serializeProject(engine.project)).toBe(before);
    expect(history.canRedo).toBe(true);
    history.redo();
    const animation = engine.currentAnimation!;
    animation.timelines[0]!.keyframes = Array.from({ length: 512 }, (_, i) => ({
      time: 0,
      eventName: `e-${i}`,
      curve: { type: 'stepped' },
    })) as never;
    const full = serializeProject(engine.project);
    expect(() => history.execute(new KeyEventCommand(engine, 'extra'))).toThrow(/512/);
    expect(serializeProject(engine.project)).toBe(full);
  });
  it('round trips typed scene edits/history and rejects bad records before publication', () => {
    const engine = boot(),
      project = engine.project,
      board = project.artboards[0]!,
      history = new HistoryManager();
    const clip = { id: 'scene', name: 'Scene', duration: 1, loop: false, fps: 30, tracks: [], events: [] };
    history.execute(new EditSceneMotionCommand(project, board.id, { kind: 'add', clip }));
    const before = serializeProject(project),
      owner = activeRigNode(project)!,
      skeleton = owner.skeleton;
    history.execute(
      new EditSceneMotionCommand(project, board.id, {
        kind: 'event',
        clipId: 'scene',
        event: {
          id: 'event',
          name: 'AttackHit',
          time: 0.5,
          payload: { type: 'int', value: 10 },
        },
      }),
    );
    const after = serializeProject(project);
    history.undo();
    expect(serializeProject(project)).toBe(before);
    const invalid = new EditSceneMotionCommand(project, board.id, {
      kind: 'event',
      clipId: 'scene',
      event: {
        id: 'invalid',
        name: 'AttackHit',
        time: 0.5,
        payload: { type: 'int', value: 0.5 },
      },
    });
    expect(() => history.execute(invalid)).toThrow(/int payload/);
    expect(history.canRedo).toBe(true);
    expect(serializeProject(project)).toBe(before);
    history.redo();
    expect(serializeProject(project)).toBe(after);
    expect(activeRigNode(project)!.skeleton).toBe(skeleton);
  });
});
