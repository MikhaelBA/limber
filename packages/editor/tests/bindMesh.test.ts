import { describe, expect, it } from 'vitest';
import {
  deserializeProject,
  serializeProject,
  Skeleton,
  worldToAttachmentVertex,
  exportSpineJson,
} from '@limber/core';
import { EditorEngine } from '../src/engine/EditorEngine';
import { HistoryManager } from '../src/history/history';
import { AddBoneCommand, RemoveBoneCommand } from '../src/commands/boneCommands';
import { AddSlotCommand } from '../src/commands/slotCommands';
import { AddMeshCommand, PaintWeightsCommand } from '../src/commands/meshCommands';
import { BindMeshCommand } from '../src/commands/bindMeshCommand';
import { AutoKeyDeformCommand } from '../src/commands/animationCommands';

function fixture() {
  const engine = new EditorEngine(),
    root = engine.skeleton.data.bones[0]!.id;
  const target = new AddBoneCommand(engine, null, { x: 100, y: 0 });
  target.do();
  const spare = new AddBoneCommand(engine, null, { x: 20, y: 30 });
  spare.do();
  const slot = new AddSlotCommand(engine, root);
  slot.do();
  const mesh = new AddMeshCommand(engine, slot.slotId, {
    textureId: '',
    x: 0,
    y: 0,
    width: 20,
    height: 20,
    cols: 1,
    rows: 1,
  });
  mesh.do();
  engine.tick(0);
  return {
    engine,
    root,
    target: target.boneId,
    spare: spare.boneId,
    slot: slot.slotId,
    mesh: mesh.attachmentId,
  };
}
function paint(engine: EditorEngine, mesh: string, bone: string) {
  const command = new PaintWeightsCommand(engine, mesh);
  command.open();
  command.update(0, engine.skeleton.boneIndexMap.get(bone)!, 0, 1);
  command.commit();
  engine.tick(0);
  return command;
}

describe('mesh binding and evaluated editing', () => {
  it('preserves setup shape when weights change, follows motion, and restores exact source', () => {
    const { engine, target, slot, mesh } = fixture(),
      history = new HistoryManager();
    const before = structuredClone(engine.project),
      original = [...engine.skeleton.pose.attachments.get(mesh)!.verts];
    history.execute(new BindMeshCommand(engine, mesh, slot, [target]));
    const bound = structuredClone(engine.project);
    history.undo();
    expect(engine.project).toEqual(before);
    history.redo();
    expect(engine.project).toEqual(bound);
    const brush = paint(engine, mesh, target);
    expect([...engine.skeleton.pose.attachments.get(mesh)!.verts]).toEqual(original);
    engine.skeleton.data.bones.find((bone) => bone.id === target)!.setupPose.x += 50;
    engine.tick(0);
    expect([...engine.skeleton.pose.attachments.get(mesh)!.verts].slice(0, 2)).toEqual([40, -10]);
    const after = structuredClone(engine.project);
    expect(deserializeProject(serializeProject(after))).toEqual(after);
    expect(() => exportSpineJson(engine.document)).toThrow(/native mesh bindings/);
    brush.undo();
    engine.tick(0);
    expect(engine.skeleton.attachmentById.get(mesh)!.boneBindings).toEqual(
      bound.artboards[0]!.nodes[0]!.type === 'rig'
        ? bound.artboards[0]!.nodes[0]!.skeleton.attachments[0]!.boneBindings
        : undefined,
    );
  });

  it('preserves reflected/sheared bind shape and solves weighted cursor/deform positions', () => {
    const { engine, root, target, slot, mesh } = fixture();
    Object.assign(engine.skeleton.data.bones[0]!.setupPose, {
      rotation: 0.4,
      scaleX: -1.2,
      scaleY: 0.8,
      shearY: 0.2,
      x: 12,
      y: 30,
    });
    const bone = engine.skeleton.data.bones.find((bone) => bone.id === target)!;
    bone.parentId = root;
    Object.assign(bone.setupPose, { rotation: -0.3, scaleX: 1.4, scaleY: 0.7, shearY: -0.2 });
    engine.skeleton.rebuild();
    engine.tick(0);
    const before = [...engine.skeleton.pose.attachments.get(mesh)!.verts];
    new BindMeshCommand(engine, mesh, slot, [target]).do();
    paint(engine, mesh, target);
    const state = engine.skeleton.pose.attachments.get(mesh)!;
    before.forEach((value, i) => expect(state.verts[i]).toBeCloseTo(value, 4));
    engine.skeleton.data.bones.find((item) => item.id === target)!.setupPose.x += 20;
    engine.tick(0);
    const point = { x: 0, y: 0 },
      wx = state.verts[0]! + 5,
      wy = state.verts[1]! - 7;
    worldToAttachmentVertex(
      engine.skeleton.attachmentById.get(mesh)!,
      engine.skeleton.boneIndexMap.get(root)!,
      engine.skeleton.pose.worldMatrices,
      state,
      0,
      wx,
      wy,
      point,
    );
    engine.document.animations.push({ name: 'deform', duration: 1, loop: false, timelines: [] });
    engine.setAnimation('deform');
    engine.mode = 'animate';
    const command = new AutoKeyDeformCommand(engine, mesh);
    command.open();
    command.update(0, point.x, point.y);
    command.commit();
    engine.tick(0);
    expect(engine.skeleton.pose.attachments.get(mesh)!.verts[0]).toBeCloseTo(wx, 4);
    expect(engine.skeleton.pose.attachments.get(mesh)!.verts[1]).toBeCloseTo(wy, 4);
  });

  it('rejects bad binding selections/matrices and singular blends before changing source or redo', () => {
    const { engine, target, spare, slot, mesh } = fixture(),
      history = new HistoryManager();
    history.execute(new BindMeshCommand(engine, mesh, slot, [target]));
    history.undo();
    const before = structuredClone(engine.project);
    for (const ids of [[], [target, target], ['missing']]) {
      expect(() => history.execute(new BindMeshCommand(engine, mesh, slot, ids))).toThrow();
      expect(engine.project).toEqual(before);
      expect(history.canRedo).toBe(true);
    }
    engine.mode = 'animate';
    expect(() => new BindMeshCommand(engine, mesh, slot, [target]).do()).toThrow(/Setup/);
    engine.mode = 'setup';
    engine.skeleton.data.bones.find((bone) => bone.id === spare)!.setupPose.scaleX = 0;
    const singular = structuredClone(engine.project);
    expect(() => history.execute(new BindMeshCommand(engine, mesh, slot, [spare]))).toThrow(/singular/);
    expect(engine.project).toEqual(singular);
    expect(history.canRedo).toBe(true);
    history.redo();
    paint(engine, mesh, target);
    const brush = new PaintWeightsCommand(engine, mesh);
    brush.open();
    expect(() => brush.update(0, engine.skeleton.boneIndexMap.get(spare)!, 0, 0.5)).toThrow(/Bind/);
    const data = structuredClone(engine.skeleton.data);
    for (const matrix of [
      [1, 0],
      [0, 0, 0, 0, 0, 0],
      [1, 0, 0, 1, NaN, 0],
    ]) {
      data.attachments[0]!.boneBindings![0]!.matrix = matrix;
      expect(() => new Skeleton(structuredClone(data))).toThrow();
    }
    const state = engine.skeleton.pose.attachments.get(mesh)!;
    state.skinMatrices!.fill(0);
    const point = { x: 2, y: 3 };
    expect(() =>
      worldToAttachmentVertex(
        engine.skeleton.attachmentById.get(mesh)!,
        0,
        engine.skeleton.pose.worldMatrices,
        state,
        0,
        4,
        5,
        point,
      ),
    ).toThrow(/singular/);
    expect(point).toEqual({ x: 2, y: 3 });
  });

  it('cleans unused bindings when deleting a bone and retains weighted bindings through reordering', () => {
    const { engine, target, spare, slot, mesh } = fixture();
    new BindMeshCommand(engine, mesh, slot, [target, spare]).do();
    paint(engine, mesh, target);
    const before = structuredClone(engine.project),
      command = new RemoveBoneCommand(engine, spare);
    command.do();
    expect(
      engine.skeleton.attachmentById.get(mesh)!.boneBindings!.some((binding) => binding.boneId === spare),
    ).toBe(false);
    command.undo();
    expect(engine.project).toEqual(before);
    expect(() => new RemoveBoneCommand(engine, target).do()).toThrow(/Rebind/);
    engine.tick(0);
    const vertices = [...engine.skeleton.pose.attachments.get(mesh)!.verts];
    new AddBoneCommand(engine, null, { x: 500, y: 0 }).do();
    engine.tick(0);
    expect([...engine.skeleton.pose.attachments.get(mesh)!.verts]).toEqual(vertices);
  });
});
