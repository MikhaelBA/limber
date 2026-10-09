import { describe, expect, it } from 'vitest';
import { serializeProject, deserializeProject } from '@limber/core';
import { EditorEngine } from '../src/engine/EditorEngine';
import { HistoryManager } from '../src/history/history';
import {
  AddPathConstraintCommand,
  EditPathConstraintCommand,
  SetPathPointCommand,
  EditPathShapeCommand,
  RemovePathConstraintCommand,
  RemovePathCommand,
} from '../src/commands/pathConstraintCommands';
import { RemoveBoneCommand } from '../src/commands/boneCommands';
import { SetKeyframeCommand } from '../src/commands/animationCommands';
function rig() {
  const e = new EditorEngine(),
    data = e.skeleton.data;
  data.bones = ['body', 'tail', 'tip'].map((id, i) => ({
    id,
    name: id,
    parentId: i === 0 ? null : i === 1 ? 'body' : 'tail',
    length: 30,
    setupPose: { x: i === 0 ? 100 : 30, y: 50, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 },
  }));
  e.loadDocument({
    skeleton: data,
    animations: [{ name: 'Idle', duration: 1, loop: true, timelines: [] }],
    assetManifest: {},
  });
  e.tick(0);
  return e;
}
describe('atomic native path authoring', () => {
  it('creates stable owner/driver/path/chain identities and restores exact source with repeated undo/redo and reopen', () => {
    const e = rig(),
      h = new HistoryManager(),
      before = structuredClone(e.document),
      c = new AddPathConstraintCommand(e, ['tail', 'tip']);
    h.execute(e.bindCommand(c));
    e.tick(0);
    const after = structuredClone(e.document);
    expect(e.skeleton.data.pathConstraints?.[0]!.bones).toEqual(['tail', 'tip']);
    expect(e.skeleton.data.paths?.[0]!.id).toBe(c.pathId);
    expect(e.skeleton.pathSamplers.size).toBe(1);
    for (let i = 0; i < 3; i++) {
      h.undo();
      expect(e.document).toEqual(before);
      expect(e.skeleton.pathSamplers.size).toBe(0);
      h.redo();
      expect(e.document).toEqual(after);
      expect(e.skeleton.pathSamplers.size).toBe(1);
    }
    expect(deserializeProject(serializeProject(e.project))).toEqual(e.project);
    const second = new AddPathConstraintCommand(e, ['tail'], c.pathId);
    expect(() => h.execute(second)).not.toThrow();
    expect(e.skeleton.data.paths?.length).toBe(1);
  });
  it('keeps joined and closed endpoints continuous in a single edit/history step', () => {
    const e = rig(),
      h = new HistoryManager(),
      c = new AddPathConstraintCommand(e, ['tail']);
    h.execute(c);
    h.execute(new EditPathShapeCommand(e, c.pathId, 'extend'));
    const before = structuredClone(e.document);
    h.execute(new SetPathPointCommand(e, c.pathId, 0, 6, 250));
    const p = e.skeleton.data.paths![0]!;
    expect(p.segments[0]![6]).toBe(250);
    expect(p.segments[1]![0]).toBe(250);
    h.undo();
    expect(e.document).toEqual(before);
    h.redo();
    h.execute(new EditPathShapeCommand(e, c.pathId, 'close'));
    expect(e.skeleton.data.paths![0]!.closed).toBe(true);
    h.execute(new SetPathPointCommand(e, c.pathId, 0, 1, 17));
    const loop = e.skeleton.data.paths![0]!;
    expect(loop.segments.at(-1)![7]).toBe(17);
    const closed = structuredClone(e.document);
    expect(() => h.execute(new EditPathShapeCommand(e, c.pathId, 'removeLast'))).toThrow(/Open/);
    expect(e.document).toEqual(closed);
    h.execute(new EditPathShapeCommand(e, c.pathId, 'open'));
    h.execute(new EditPathShapeCommand(e, c.pathId, 'removeLast'));
    expect(e.skeleton.data.paths![0]!.segments.length).toBe(2);
  });
  it('rejects invalid edits without changing pose, history or source', () => {
    const e = rig(),
      h = new HistoryManager(),
      c = new AddPathConstraintCommand(e, ['tail', 'tip']);
    h.execute(c);
    e.tick(0);
    const before = structuredClone(e.document),
      pose = structuredClone(e.skeleton.pose),
      undo = h.canUndo,
      redo = h.canRedo;
    for (const invalid of [
      new EditPathConstraintCommand(e, c.constraintId, { spacing: -1 }),
      new EditPathConstraintCommand(e, c.constraintId, { pathId: 'missing' }),
      new SetPathPointCommand(e, c.pathId, 0, 3, Infinity),
      new AddPathConstraintCommand(e, ['body', 'tip']),
    ]) {
      expect(() => h.execute(invalid)).toThrow();
      expect(e.document).toEqual(before);
      expect(e.skeleton.pose).toEqual(pose);
      expect(h.canUndo).toBe(undo);
      expect(h.canRedo).toBe(redo);
    }
    e.mode = 'animate';
    expect(() => h.execute(new EditPathConstraintCommand(e, c.constraintId, { progress: 0.5 }))).toThrow(
      /Setup/,
    );
    expect(e.document).toEqual(before);
  });
  it('keys driver percentage points with the existing animation command and removes referencing constraints atomically', () => {
    const e = rig(),
      h = new HistoryManager(),
      c = new AddPathConstraintCommand(e, ['tail', 'tip']);
    h.execute(c);
    e.mode = 'animate';
    e.setAnimation('Idle');
    h.execute(new SetKeyframeCommand(e, c.driverId, 'x', 0, 50));
    e.tick(0);
    expect(e.currentAnimation!.timelines[0]).toMatchObject({
      kind: 'boneProperty',
      boneId: c.driverId,
      property: 'x',
      keyframes: [{ time: 0, value: 50 }],
    });
    e.mode = 'setup';
    const before = structuredClone(e.document);
    h.execute(new RemoveBoneCommand(e, c.driverId));
    expect(e.skeleton.data.pathConstraints).toEqual([]);
    expect(e.document.animations[0]!.timelines).toEqual([]);
    h.undo();
    expect(e.document).toEqual(before);
    h.execute(new RemoveBoneCommand(e, c.ownerId));
    expect(e.skeleton.data.paths).toEqual([]);
    expect(e.skeleton.data.pathConstraints).toEqual([]);
    h.undo();
    expect(e.document).toEqual(before);
  });
  it('deletes follows without deleting their controls/tracks and deletes paths with all followers', () => {
    const e = rig(),
      h = new HistoryManager(),
      c = new AddPathConstraintCommand(e, ['tail']);
    h.execute(c);
    const before = structuredClone(e.document);
    h.execute(new RemovePathConstraintCommand(e, c.constraintId));
    expect(e.skeleton.data.pathConstraints).toEqual([]);
    expect(e.skeleton.data.bones.some((b) => b.id === c.driverId)).toBe(true);
    h.undo();
    expect(e.document).toEqual(before);
    h.execute(new RemovePathCommand(e, c.pathId));
    expect(e.skeleton.pathSamplers.size).toBe(0);
    expect(e.skeleton.data.pathConstraints).toEqual([]);
    h.undo();
    expect(e.document).toEqual(before);
  });
});
