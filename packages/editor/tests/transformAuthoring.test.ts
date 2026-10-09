import { describe, expect, it } from 'vitest';
import { serializeProject, deserializeProject } from '@limber/core';
import { EditorEngine } from '../src/engine/EditorEngine';
import { HistoryManager } from '../src/history/history';
import {
  AddTransformConstraintCommand,
  EditTransformConstraintCommand,
  RemoveTransformConstraintCommand,
} from '../src/commands/transformConstraintCommands';
import { MoveConstraintCommand, AddIKConstraintCommand } from '../src/commands/ikCommands';
import { RemoveBoneCommand } from '../src/commands/boneCommands';
function rig() {
  const e = new EditorEngine(),
    data = e.skeleton.data;
  data.bones = ['body', 'follower', 'target'].map((id, i) => ({
    id,
    name: id,
    parentId: i === 1 ? 'body' : null,
    length: 30,
    setupPose: {
      x: i === 1 ? 20 : i === 2 ? 50 : 0,
      y: i === 2 ? 40 : 0,
      rotation: i === 2 ? 0.6 : -0.2,
      scaleX: i === 2 ? 1.5 : 1,
      scaleY: i === 2 ? -1.2 : 1,
      shearX: 0.2,
      shearY: 0.1,
    },
  }));
  e.loadDocument({ skeleton: data, animations: [], assetManifest: {} });
  e.tick(0);
  return e;
}
const matrix = (e: EditorEngine, id: string) =>
  Array.from(
    e.skeleton.pose.worldMatrices.slice(
      e.skeleton.boneIndexMap.get(id)! * 6,
      e.skeleton.boneIndexMap.get(id)! * 6 + 6,
    ),
  );
describe('atomic transform follow authoring', () => {
  it('preserves evaluated setup pose on creation and exact source through repeated undo/redo and reopen', () => {
    const e = rig(),
      history = new HistoryManager(),
      before = structuredClone(e.document),
      beforeMatrix = matrix(e, 'follower');
    const c = new AddTransformConstraintCommand(e, 'follower', 'target');
    history.execute(e.bindCommand(c));
    e.tick(0);
    matrix(e, 'follower').forEach((v, i) => expect(v).toBeCloseTo(beforeMatrix[i]!, 4));
    const after = structuredClone(e.document);
    expect(e.skeleton.data.transformConstraints?.[0]!.id).toBe(c.constraintId);
    for (let i = 0; i < 3; i++) {
      history.undo();
      expect(e.document).toEqual(before);
      history.redo();
      expect(e.document).toEqual(after);
    }
    expect(deserializeProject(serializeProject(e.project))).toEqual(e.project);
    const target = e.skeleton.data.bones.find((b) => b.id === 'target')!;
    target.setupPose.x += 10;
    e.skeleton.rebuild();
    e.tick(0);
    expect(matrix(e, 'follower')[4]).toBeCloseTo(beforeMatrix[4]! + 10, 4);
  });
  it('copies with no offset, edits/deletes atomically and rejects invalid target/mix/singular creation', () => {
    const e = rig(),
      history = new HistoryManager();
    const c = new AddTransformConstraintCommand(e, 'follower', 'target', false);
    history.execute(c);
    e.tick(0);
    matrix(e, 'follower').forEach((v, i) => expect(v).toBeCloseTo(matrix(e, 'target')[i]!, 4));
    history.execute(
      new EditTransformConstraintCommand(e, c.constraintId, {
        mixTranslation: 0.5,
        offset: { x: 4 },
        space: 'local',
      }),
    );
    const edited = structuredClone(e.document);
    history.undo();
    const before = structuredClone(e.document),
      pose = structuredClone(e.skeleton.pose),
      indices = [...e.skeleton.boneIndexMap];
    for (const patch of [
      { targetId: 'follower' },
      { targetId: 'missing' },
      { mixRotation: NaN },
      { mixScale: 2 },
      { offset: { scaleX: Infinity } },
    ]) {
      expect(() => history.execute(new EditTransformConstraintCommand(e, c.constraintId, patch))).toThrow();
      expect(e.document).toEqual(before);
      expect(e.skeleton.pose).toEqual(pose);
      expect([...e.skeleton.boneIndexMap]).toEqual(indices);
      expect(history.canRedo).toBe(true);
    }
    history.redo();
    expect(e.document).toEqual(edited);
    history.execute(new RemoveTransformConstraintCommand(e, c.constraintId));
    expect(e.skeleton.data.transformConstraints).toEqual([]);
    history.undo();
    expect(e.document).toEqual(edited);
    const singular = rig();
    singular.skeleton.data.bones.find((b) => b.id === 'target')!.setupPose.scaleX = 0;
    singular.skeleton.rebuild();
    const source = structuredClone(singular.document);
    expect(() => new AddTransformConstraintCommand(singular, 'follower', 'target').do()).toThrow(
      /singular target/,
    );
    expect(singular.document).toEqual(source);
  });
  it('orders IK/follow in one namespace and rejects dependency inversion without discarding redo', () => {
    const e = rig(),
      history = new HistoryManager();
    const ik = new AddIKConstraintCommand(e, 'follower');
    history.execute(ik);
    const follow = new AddTransformConstraintCommand(e, 'follower', 'target');
    history.execute(follow);
    expect(e.skeleton.constraintOrder.map((x) => x.data.order)).toEqual([0, 1]);
    history.execute(new EditTransformConstraintCommand(e, follow.constraintId, { mixTranslation: 0.8 }));
    history.undo();
    const before = structuredClone(e.document);
    expect(() => history.execute(new MoveConstraintCommand(e, follow.constraintId, -1))).toThrow(
      /must run after/,
    );
    expect(e.document).toEqual(before);
    expect(history.canRedo).toBe(true);
  });
  it('removes references on bone deletion and preserves rig-scoped history after navigation', () => {
    const e = rig(),
      history = new HistoryManager();
    history.execute(new AddTransformConstraintCommand(e, 'follower', 'target'));
    const original = e.project.artboards[0]!.nodes[0]!,
      other = structuredClone(original);
    other.id = 'other-rig';
    e.project.artboards[0]!.nodes.push(other);
    const untouched = structuredClone(other),
      before = structuredClone(e.document);
    history.execute(e.bindCommand(new RemoveBoneCommand(e, 'target')));
    expect(e.skeleton.data.transformConstraints).toEqual([]);
    e.focusRig(e.project.artboards[0]!.id, other.id);
    history.undo();
    expect(e.project.editor.activeRigId).toBe(original.id);
    expect(e.document).toEqual(before);
    expect(other).toEqual(untouched);
    e.mode = 'animate';
    expect(() =>
      new EditTransformConstraintCommand(e, e.skeleton.data.transformConstraints![0]!.id, {
        mixRotation: 0.5,
      }).do(),
    ).toThrow(/Setup/);
  });
});
