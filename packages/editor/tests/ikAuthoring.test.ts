import { describe, expect, it } from 'vitest';
import { serializeProject, deserializeProject, type IKConstraintData } from '@limber/core';
import { EditorEngine } from '../src/engine/EditorEngine';
import { HistoryManager } from '../src/history/history';
import {
  PinLimbCommand,
  AddIKConstraintCommand,
  SetIKPropsCommand,
  RemoveIKConstraintCommand,
  MoveIKConstraintCommand,
} from '../src/commands/ikCommands';
import { AddHumanGuideCommand } from '../src/commands/rigHelperCommands';

function limb() {
  const engine = new EditorEngine();
  const data = engine.skeleton.data;
  data.bones = ['body', 'upper', 'lower', 'hand'].map((id, i) => ({
    id,
    name: id,
    parentId: i ? ['body', 'upper', 'lower'][i - 1]! : null,
    length: i === 1 ? 40 : i === 2 ? 35 : 10,
    setupPose: {
      x: i === 2 ? 40 : i === 3 ? 35 : 0,
      y: 0,
      rotation: i === 2 ? -0.6 : 0,
      scaleX: 1,
      scaleY: 1,
      shearX: 0,
      shearY: 0,
    },
  }));
  data.slots = [{ id: 'slot', name: 'art', boneId: 'lower', defaultAttachmentId: 'art', color: 0xffffffff }];
  data.attachments = [
    {
      id: 'art',
      name: 'art',
      type: 'region',
      textureId: '',
      vertices: [0, 0, 4, 0, 4, 4, 0, 4],
      uvs: [0, 0, 1, 0, 1, 1, 0, 1],
      weights: Array.from({ length: 4 }, () => [1, 2, 1]).flat(),
    },
  ];
  engine.loadDocument({ skeleton: data, animations: [], assetManifest: {} });
  engine.tick(0);
  return engine;
}
const position = (engine: EditorEngine, id: string) =>
  Array.from(
    engine.skeleton.pose.worldMatrices.slice(
      engine.skeleton.boneIndexMap.get(id)! * 6 + 4,
      engine.skeleton.boneIndexMap.get(id)! * 6 + 6,
    ),
  );
const pose = (engine: EditorEngine) => ({
  pose: structuredClone(engine.skeleton.pose),
  indices: [...engine.skeleton.boneIndexMap],
});

describe('semantic pins and transactional IK', () => {
  it.each([
    { scaleX: 1.8, scaleY: 0.7, shearX: 0.2 },
    { scaleX: -1.3, scaleY: 0.8, rotation: 0.4 },
    { scaleX: 1.2, scaleY: -1.4, shearY: -0.3 },
  ])('pins affine limbs without a setup jump and holds the wrist on body movement: %j', (parent) => {
    const engine = limb(),
      history = new HistoryManager();
    Object.assign(engine.skeleton.data.bones[0]!.setupPose, parent);
    Object.assign(engine.skeleton.data.bones[1]!.setupPose, { scaleX: 1.4, scaleY: 0.8, shearX: 0.2 });
    Object.assign(engine.skeleton.data.bones[2]!.setupPose, { scaleX: -0.9, shearY: 0.15 });
    engine.skeleton.rebuild();
    engine.tick(0);
    const point = position(engine, 'hand'),
      before = structuredClone(engine.document);
    const pin = new PinLimbCommand(engine, 'hand', 'hand');
    history.execute(pin);
    engine.tick(0);
    position(engine, 'hand').forEach((v, i) => expect(v).toBeCloseTo(point[i]!, 3));
    const after = structuredClone(engine.document);
    history.undo();
    expect(engine.document).toEqual(before);
    history.redo();
    expect(engine.document).toEqual(after);
    const body = engine.skeleton.data.bones.find((b) => b.id === 'body')!;
    body.setupPose.x += 2;
    body.setupPose.y += 1;
    engine.skeleton.rebuild();
    engine.tick(0);
    position(engine, 'hand').forEach((v, i) => expect(v).toBeCloseTo(point[i]!, 3));
  });
  it('edits pole/softness atomically and preserves them through exact history and native reopen', () => {
    const engine = limb(),
      history = new HistoryManager();
    const pin = new PinLimbCommand(engine, 'hand', 'hand');
    history.execute(pin);
    const before = structuredClone(engine.document);
    history.execute(new SetIKPropsCommand(engine, pin.constraintId, { poleVectorId: 'body', softness: 12 }));
    const after = structuredClone(engine.document);
    history.undo();
    expect(engine.document).toEqual(before);
    history.redo();
    expect(engine.document).toEqual(after);
    expect(deserializeProject(serializeProject(engine.project))).toEqual(engine.project);
    for (const patch of [
      { poleVectorId: 'lower' },
      { poleVectorId: 'missing' },
      { softness: -1 },
      { softness: Infinity },
    ]) {
      expect(() => history.execute(new SetIKPropsCommand(engine, pin.constraintId, patch))).toThrow();
      expect(engine.document).toEqual(after);
    }
  });
  it('pins the wrist pivot, preserves setup bend, weights and exact undo/redo IDs', () => {
    const engine = limb(),
      history = new HistoryManager();
    const before = structuredClone(engine.document),
      point = position(engine, 'hand');
    const pin = new PinLimbCommand(engine, 'hand', 'hand');
    history.execute(engine.bindCommand(pin));
    engine.tick(0);
    const c = engine.skeleton.data.ikConstraints[0]!;
    expect(c.bones).toEqual(['upper', 'lower']);
    expect(c.targetId).toBe(pin.targetBoneId);
    expect(engine.skeleton.data.bones.find((b) => b.id === pin.targetBoneId)!.parentId).toBeNull();
    position(engine, 'hand').forEach((value, i) => expect(value).toBeCloseTo(point[i]!, 4));
    expect(engine.skeleton.data.attachments[0]!.weights).toEqual(before.skeleton.attachments[0]!.weights);
    expect(engine.document.animations).toEqual(before.animations);
    const after = structuredClone(engine.document);
    for (let n = 0; n < 3; n++) {
      history.undo();
      expect(engine.document).toEqual(before);
      history.redo();
      expect(engine.document).toEqual(after);
    }
    expect(deserializeProject(serializeProject(engine.project))).toEqual(engine.project);
  });
  it('keeps the pin in rig space as the body moves, and allows target animation keys', () => {
    const engine = limb();
    new PinLimbCommand(engine, 'hand', 'hand').do();
    engine.tick(0);
    const c = engine.skeleton.data.ikConstraints[0]!,
      point = position(engine, 'hand');
    const body = engine.skeleton.data.bones.find((b) => b.id === 'body')!;
    body.setupPose.x = 8;
    body.setupPose.y = 6;
    engine.skeleton.rebuild();
    engine.tick(0);
    position(engine, 'hand').forEach((value, i) => expect(value).toBeCloseTo(point[i]!, 4));
    const target = engine.skeleton.data.bones.find((b) => b.id === c.targetId)!;
    engine.document.animations.push({
      name: 'pinned',
      duration: 1,
      loop: false,
      timelines: [
        {
          kind: 'boneProperty',
          boneId: target.id,
          property: 'y',
          keyframes: [
            { time: 0, value: point[1]!, curve: { type: 'linear' } },
            { time: 1, value: point[1]! + 10, curve: { type: 'linear' } },
          ],
        },
      ],
    });
    engine.mode = 'animate';
    engine.setAnimation('pinned');
    engine.currentTime = 0.5;
    engine.tick(0);
    expect(position(engine, 'hand')[1]).toBeCloseTo(point[1]! + 5, 4);
    expect(target.setupPose.y).toBe(point[1]);
  });
  it('authors independent hand/foot pins on the human guide', () => {
    const engine = new EditorEngine();
    new AddHumanGuideCommand(engine, { height: 300, x: 0, y: 0, name: 'Hero' }).do();
    for (const [name, kind] of [
      ['Hero.hand.L', 'hand'],
      ['Hero.foot.R', 'foot'],
    ] as const) {
      const id = engine.skeleton.data.bones.find((b) => b.name === name)!.id;
      new PinLimbCommand(engine, id, kind).do();
    }
    expect(engine.skeleton.data.ikConstraints.map((c) => c.order)).toEqual([0, 1]);
    expect(engine.skeleton.data.markers).toHaveLength(4);
    engine.tick(0);
    expect(Array.from(engine.skeleton.pose.worldMatrices).every(Number.isFinite)).toBe(true);
  });
  it('keeps pin history attached to its original rig after navigation', () => {
    const engine = limb(),
      history = new HistoryManager(),
      artboard = engine.project.artboards[0]!;
    const original = artboard.nodes[0]!;
    const other = structuredClone(original);
    other.id = 'other-rig';
    artboard.nodes.push(other);
    const untouched = structuredClone(other);
    const pin = new PinLimbCommand(engine, 'hand', 'hand');
    history.execute(engine.bindCommand(pin));
    engine.focusRig(artboard.id, 'other-rig');
    history.undo();
    expect(engine.project.editor.activeRigId).toBe(original.id);
    expect(engine.skeleton.data.ikConstraints).toHaveLength(0);
    expect(other).toEqual(untouched);
    engine.focusRig(artboard.id, 'other-rig');
    history.redo();
    expect(engine.project.editor.activeRigId).toBe(original.id);
    expect(engine.skeleton.data.ikConstraints[0]!.targetId).toBe(pin.targetBoneId);
    expect(other).toEqual(untouched);
  });
  it('rejects malformed/duplicate/singular pins without changing the source or redo', () => {
    const engine = limb(),
      history = new HistoryManager();
    history.execute(new PinLimbCommand(engine, 'hand', 'hand'));
    history.undo();
    engine.tick(0);
    const before = structuredClone(engine.document),
      beforePose = pose(engine);
    expect(() => history.execute(new PinLimbCommand(engine, 'body', 'hand'))).toThrow(/two limb/);
    expect(engine.document).toEqual(before);
    expect(pose(engine)).toEqual(beforePose);
    expect(history.canRedo).toBe(true);
    history.redo();
    const pinned = structuredClone(engine.document);
    expect(() => history.execute(new PinLimbCommand(engine, 'hand', 'hand'))).toThrow(/already has IK/);
    expect(engine.document).toEqual(pinned);
    for (const mutation of ['offset', 'singular'] as const) {
      const e = limb(),
        d = e.skeleton.data;
      if (mutation === 'offset') d.bones[3]!.setupPose.y = 5;
      else d.bones[0]!.setupPose.scaleX = 0;
      e.skeleton.rebuild();
      const snapshot = structuredClone(e.document);
      expect(() => new PinLimbCommand(e, 'hand', 'foot').do()).toThrow(/tip|nonzero scale/);
      expect(e.document).toEqual(snapshot);
    }
  });
  it('failed edits preserve pose, indices, weights and redo, including singular target creation', () => {
    const engine = limb(),
      history = new HistoryManager();
    const add = new AddIKConstraintCommand(engine, 'lower');
    history.execute(add);
    history.execute(new SetIKPropsCommand(engine, add.constraintId, { mix: 0.5 }));
    history.undo();
    engine.tick(0);
    const before = structuredClone(engine.document),
      beforePose = pose(engine);
    for (const patch of [
      { targetId: 'missing' },
      { targetId: 'hand' },
      { mix: NaN },
      { mix: 2 },
      { order: -1 },
    ]) {
      expect(() => history.execute(new SetIKPropsCommand(engine, add.constraintId, patch))).toThrow();
      expect(engine.document).toEqual(before);
      expect(pose(engine)).toEqual(beforePose);
      expect(history.canRedo).toBe(true);
    }
    const singular = limb();
    singular.skeleton.data.bones[0]!.setupPose.scaleX = 0;
    singular.skeleton.rebuild();
    const original = structuredClone(singular.document);
    expect(() => new AddIKConstraintCommand(singular, 'lower').do()).toThrow(/zero-scale parent/);
    expect(singular.document).toEqual(original);
  });
  it('retains keyed target bones on deletion and rejects constraint authoring in Animate', () => {
    const engine = limb(),
      add = new AddIKConstraintCommand(engine, 'lower');
    add.do();
    engine.document.animations.push({
      name: 'target keys',
      duration: 1,
      loop: false,
      timelines: [
        {
          kind: 'boneProperty',
          boneId: add.targetBoneId,
          property: 'x',
          keyframes: [{ time: 0, value: 10, curve: { type: 'linear' } }],
        },
      ],
    });
    const before = structuredClone(engine.document);
    engine.mode = 'animate';
    for (const command of [
      new RemoveIKConstraintCommand(engine, add.constraintId),
      new SetIKPropsCommand(engine, add.constraintId, { mix: 0.2 }),
      new AddIKConstraintCommand(engine, 'lower'),
      new PinLimbCommand(engine, 'hand', 'hand'),
    ]) {
      expect(() => command.do()).toThrow(/Switch to Setup/);
      expect(engine.document).toEqual(before);
    }
    engine.mode = 'setup';
    const remove = new RemoveIKConstraintCommand(engine, add.constraintId);
    remove.do();
    expect(engine.skeleton.data.bones.some((b) => b.id === add.targetBoneId)).toBe(true);
    expect(engine.document.animations[0]!.timelines).toHaveLength(1);
    remove.undo();
    expect(engine.document).toEqual(before);
  });
  it('reorders independent constraints exactly and rejects inverted dependencies atomically', () => {
    const engine = limb(),
      history = new HistoryManager();
    const a = new AddIKConstraintCommand(engine, 'lower');
    a.do();
    const b = new AddIKConstraintCommand(engine, 'lower');
    b.do();
    const initial = structuredClone(engine.document);
    history.execute(new MoveIKConstraintCommand(engine, b.constraintId, -1));
    expect(engine.skeleton.data.ikConstraints.map((c) => c.id)).toEqual([b.constraintId, a.constraintId]);
    history.undo();
    expect(engine.document).toEqual(initial);
    expect(history.canRedo).toBe(true);
    const data = engine.skeleton.data;
    const target = data.bones.find((bone) => bone.id === a.targetBoneId)!;
    // A new writer controls A's target from an independent ancestor; B stays independent.
    data.bones.push({
      id: 'target-parent',
      name: 'target-parent',
      parentId: null,
      length: 10,
      setupPose: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 },
    });
    target.parentId = 'target-parent';
    const writer: IKConstraintData = {
      id: 'writer',
      bones: ['target-parent'],
      targetId: b.targetBoneId,
      poleVectorId: null,
      bendDirection: 1,
      mix: 1,
      softness: 0,
      order: 0,
    };
    data.ikConstraints[0]!.order = 1;
    data.ikConstraints[1]!.order = 2;
    data.ikConstraints.push(writer);
    engine.skeleton.rebuild();
    engine.tick(0);
    const snapshot = structuredClone(engine.document),
      beforePose = pose(engine);
    expect(() => history.execute(new MoveIKConstraintCommand(engine, 'writer', 1))).toThrow(/must run after/);
    expect(engine.document).toEqual(snapshot);
    expect(pose(engine)).toEqual(beforePose);
    expect(history.canRedo).toBe(true);
  });
});
