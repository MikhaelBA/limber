import { describe, expect, it } from 'vitest';
import { decodeWeights, encodeWeights } from '@limber/mesh';
import { serializeProject, deserializeProject } from '@limber/core';
import { compileRuntime, loadRuntime, encodeRuntime, NativeRigPlayer } from '@limber/runtime';
import { EditorEngine } from '../src/engine/EditorEngine';
import { AddBoneCommand } from '../src/commands/boneCommands';
import { AddSlotCommand } from '../src/commands/slotCommands';
import { AddMeshCommand, PaintWeightsCommand } from '../src/commands/meshCommands';
import { BindMeshCommand } from '../src/commands/bindMeshCommand';
import {
  DirectWeightsCommand,
  WeightMetadataCommand,
  UpdateBindingsCommand,
  weightContext,
  prunePreview,
  pasteWeights,
  swapWeights,
  weldWeights,
  weightRowsCommand,
} from '../src/commands/weightEditingCommands';
import { DuplicateBonesCommand } from '../src/commands/duplicateBonesCommand';
import { CompositeCommand, HistoryManager } from '../src/history/history';

function fixture() {
  const engine = new EditorEngine(),
    root = engine.skeleton.data.bones[0]!.id;
  const tip = new AddBoneCommand(engine, root, { x: 100, y: 0 });
  tip.do();
  const spare = new AddBoneCommand(engine, root, { x: 200, y: 0 });
  spare.do();
  const slot = new AddSlotCommand(engine, root);
  slot.do();
  const mesh = new AddMeshCommand(engine, slot.slotId, {
    textureId: '',
    x: 50,
    y: 0,
    width: 100,
    height: 40,
    cols: 1,
    rows: 1,
  });
  mesh.do();
  const bones = [root, tip.boneId, spare.boneId];
  new BindMeshCommand(engine, mesh.attachmentId, slot.slotId, bones, true).do();
  const attachment = engine.skeleton.attachmentById.get(mesh.attachmentId)!;
  attachment.weights = encodeWeights(
    Array.from({ length: 4 }, () => [
      { boneIndex: 0, weight: 0.2 },
      { boneIndex: 1, weight: 0.3 },
      { boneIndex: 2, weight: 0.5 },
    ]),
  );
  engine.tick(0);
  return { engine, bones, id: mesh.attachmentId, slot: slot.slotId };
}
describe('practical weight authoring commands', () => {
  it('first public Bind uses exactly chosen bones, and adding bindings preserves frozen matrices', () => {
    const { engine, id, slot, bones } = fixture(),
      a = engine.skeleton.attachmentById.get(id)!;
    delete a.weights;
    delete a.boneBindings;
    new BindMeshCommand(engine, id, slot, [bones[1]!], true).do();
    engine.tick(0);
    expect(engine.skeleton.attachmentById.get(id)!.boneBindings!.map((binding) => binding.boneId)).toEqual([
      bones[1]!,
    ]);
    expect(
      weightContext(engine, id).rows.every(
        (row) => row.length === 1 && row[0]!.boneIndex === 1 && row[0]!.weight === 1,
      ),
    ).toBe(true);
    const matrix = [...engine.skeleton.attachmentById.get(id)!.boneBindings![0]!.matrix];
    engine.skeleton.data.bones[1]!.setupPose.y += 20;
    new BindMeshCommand(engine, id, slot, [bones[1]!, bones[2]!], true).do();
    expect(
      engine.skeleton.attachmentById.get(id)!.boneBindings!.find((binding) => binding.boneId === bones[1])!
        .matrix,
    ).toEqual(matrix);
  });
  it('first Bind auto weights preserves the visible setup geometry', () => {
    const { engine, id, slot, bones } = fixture();
    delete engine.skeleton.attachmentById.get(id)!.weights;
    delete engine.skeleton.attachmentById.get(id)!.boneBindings;
    new BindMeshCommand(engine, id, slot, bones, true).do();
    engine.tick(0);
    expect(weightContext(engine, id).rows.every((row) => row.length > 0)).toBe(true);
    expect([...engine.skeleton.pose.attachments.get(id)!.verts]).toEqual(
      engine.skeleton.attachmentById.get(id)!.meshVertices,
    );
  });
  it('Direct while playing changes only selected weights, with exact undo/redo', () => {
    const { engine, id, bones } = fixture(),
      history = new HistoryManager(),
      before = structuredClone(engine.project);
    engine.mode = 'animate';
    engine.playing = true;
    const cmd = new DirectWeightsCommand(engine, id, [1], [bones[0]!]);
    cmd.open();
    cmd.update(0.7);
    cmd.commit();
    history.execute(cmd);
    const rows = weightContext(engine, id).rows;
    expect(rows[1]![0]!.weight).toBe(0.7);
    expect(rows[0]![0]!.weight).toBe(0.2);
    expect(engine.document.animations).toEqual(
      before.artboards[0]!.nodes[0]!.type === 'rig' ? before.artboards[0]!.nodes[0]!.animations : [],
    );
    const after = structuredClone(engine.project);
    history.undo();
    expect(engine.project).toEqual(before);
    history.redo();
    expect(engine.project).toEqual(after);
  });
  it('Replace lowers an existing weight and Remove reduces it while locks stay exact', () => {
    const { engine, id, bones } = fixture();
    new WeightMetadataCommand(engine, id, 'lock', [bones[2]!]).do();
    const brush = new PaintWeightsCommand(engine, id);
    brush.open();
    brush.update(0, 1, 0, 0.1, 'replace');
    expect(weightContext(engine, id).rows[0]!.find((item) => item.boneIndex === 1)!.weight).toBe(0.1);
    brush.update(0, 1, 0, 0.05, 'remove');
    expect(weightContext(engine, id).rows[0]!.find((item) => item.boneIndex === 1)!.weight).toBe(0.05);
    expect(weightContext(engine, id).rows[0]!.find((item) => item.boneIndex === 2)!.weight).toBe(0.5);
  });
  it('copy/paste uses bone identity, equal selection counts and lock preservation', () => {
    const { engine, id, bones } = fixture();
    expect(() => pasteWeights(engine, id, [0, 1], [[{ boneId: bones[0]!, weight: 1 }]])).toThrow(
      /same number/,
    );
    new WeightMetadataCommand(engine, id, 'lock', [bones[2]!]).do();
    pasteWeights(engine, id, [0], [[{ boneId: bones[1]!, weight: 1 }]]).do();
    expect(weightContext(engine, id).rows[0]).toEqual([
      { boneIndex: 1, weight: 0.5 },
      { boneIndex: 2, weight: 0.5 },
    ]);
    expect(() => pasteWeights(engine, id, [1], [[{ boneId: 'missing', weight: 1 }]])).toThrow(/Bind/);
  });
  it('Swap requires two unlocked bones and preserves unselected vertices', () => {
    const { engine, id, bones } = fixture();
    swapWeights(engine, id, [0], bones.slice(0, 2)).do();
    expect(weightContext(engine, id).rows[0]!.find((item) => item.boneIndex === 0)!.weight).toBe(0.3);
    expect(weightContext(engine, id).rows[1]![0]!.weight).toBe(0.2);
    expect(() => swapWeights(engine, id, [], [bones[0]!])).toThrow(/exactly two/);
  });
  it('unbinding normalizes survivors, and removing every binding restores slot rigidity', () => {
    const { engine, id, bones } = fixture(),
      before = structuredClone(engine.project),
      history = new HistoryManager();
    history.execute(new WeightMetadataCommand(engine, id, 'remove', [bones[0]!]));
    expect(weightContext(engine, id).rows[0]![0]!.weight).toBeCloseTo(0.375);
    history.execute(new WeightMetadataCommand(engine, id, 'remove', bones.slice(1)));
    expect(engine.skeleton.attachmentById.get(id)!.weights).toBeUndefined();
    expect(engine.skeleton.attachmentById.get(id)!.boneBindings).toBeUndefined();
    history.undo();
    history.undo();
    expect(engine.project).toEqual(before);
  });
  it('batch prune previews exactly match publication, with one history step', () => {
    const { engine, id, slot } = fixture(),
      history = new HistoryManager();
    const second = structuredClone(engine.skeleton.attachmentById.get(id)!);
    second.id = 'second';
    second.name = 'second';
    engine.skeleton.data.attachments.push(second);
    engine.skeleton.data.slots.push({
      ...engine.skeleton.data.slots[0]!,
      id: 'second-slot',
      name: 'second-slot',
      defaultAttachmentId: second.id,
    });
    engine.skeleton.rebuild();
    void slot;
    const before = structuredClone(engine.project),
      options = { maxInfluences: 2, threshold: 0.25 };
    const previews = [id, second.id].map((id) => prunePreview(engine, id, [], options));
    expect(previews.map((p) => p.removed)).toEqual([4, 4]);
    history.execute(
      new CompositeCommand(
        'Batch prune',
        previews.map((p, i) => weightRowsCommand(engine, [id, second.id][i]!, p.rows, 'Prune')),
      ),
    );
    expect(weightContext(engine, id).rows).toEqual(previews[0]!.rows);
    history.undo();
    expect(engine.project).toEqual(before);
  });
  it('Update bindings keeps the posed shape when subsequent weights change', () => {
    const { engine, id, bones } = fixture();
    engine.skeleton.data.bones[1]!.setupPose.y += 10;
    engine.tick(0);
    const visible = [...engine.skeleton.pose.attachments.get(id)!.verts];
    new UpdateBindingsCommand(engine, id).do();
    const cmd = new DirectWeightsCommand(engine, id, [0, 1, 2, 3], [bones[0]!]);
    cmd.open();
    cmd.update(0.7);
    cmd.commit();
    engine.tick(0);
    [...engine.skeleton.pose.attachments.get(id)!.verts].forEach((value, i) =>
      expect(value).toBeCloseTo(visible[i]!, 4),
    );
  });
  it('Duplicate remaps copied mesh influences to copied bones and restores exact history', () => {
    const { engine, bones, id } = fixture(),
      history = new HistoryManager(),
      before = structuredClone(engine.project);
    const command = new DuplicateBonesCommand(engine, bones[0]!);
    history.execute(command);
    const copy = engine.skeleton.data.attachments.find((a) => a.id !== id)!;
    const copied = new Set(
      engine.skeleton.data.bones.filter((b) => b.name.includes('.copy')).map((b) => b.id),
    );
    expect(copy.boneBindings!.every((binding) => copied.has(binding.boneId))).toBe(true);
    expect(
      decodeWeights(copy.weights!, 4, engine.skeleton.data.bones.length).every((row) =>
        row.every((item) => copied.has(engine.skeleton.data.bones[item.boneIndex]!.id)),
      ),
    ).toBe(true);
    const after = structuredClone(engine.project);
    history.undo();
    expect(engine.project).toEqual(before);
    history.redo();
    expect(engine.project).toEqual(after);
  });
  it('weighted bounding boxes and clipping survive native compile/load', () => {
    for (const type of ['boundingBox', 'clipping'] as const) {
      const { engine, id } = fixture();
      const a = engine.skeleton.attachmentById.get(id)!;
      a.type = type;
      delete a.meshUVs;
      delete a.meshTriangles;
      if (type === 'clipping') a.endSlotId = null;
      engine.skeleton.rebuild();
      engine.tick(0);
      const { program } = compileRuntime(engine.project),
        native = new NativeRigPlayer(
          loadRuntime(encodeRuntime(program)),
          engine.project.editor!.activeRigId!,
        );
      expect([...native.getDeformedVertices(id)]).toEqual([
        ...engine.skeleton.pose.attachments.get(id)!.verts,
      ]);
      expect(deserializeProject(serializeProject(engine.project))).toEqual(engine.project);
    }
  });
  it('weld rejects same mesh and fewer than two shared bindings', () => {
    const { engine, id } = fixture();
    expect(() => weldWeights(engine, id, id, false)).toThrow(/different/);
  });
  it('weld copies overlapping vertices, leaves distant vertices and supports All', () => {
    const { engine, id } = fixture(),
      source = engine.skeleton.attachmentById.get(id)!;
    const target = structuredClone(source);
    target.id = 'weld-target';
    target.name = 'weld-target';
    target.meshVertices![0] -= 5;
    target.weights = encodeWeights(
      Array.from({ length: 4 }, () => [
        { boneIndex: 0, weight: 0.9 },
        { boneIndex: 1, weight: 0.1 },
      ]),
    );
    engine.skeleton.data.attachments.push(target);
    engine.skeleton.data.slots.push({
      ...engine.skeleton.data.slots[0]!,
      id: 'weld-slot',
      name: 'weld-slot',
      defaultAttachmentId: target.id,
    });
    engine.skeleton.rebuild();
    engine.tick(0);
    weldWeights(engine, target.id, id, true).do();
    expect(weightContext(engine, target.id).rows[0]).toEqual([
      { boneIndex: 0, weight: 0.9 },
      { boneIndex: 1, weight: 0.1 },
    ]);
    expect(weightContext(engine, target.id).rows[1]).toEqual(weightContext(engine, id).rows[1]);
    weldWeights(engine, target.id, id, false).do();
    expect(weightContext(engine, target.id).rows[0]).toEqual(weightContext(engine, id).rows[0]);
  });
  it('brush edits selected bone groups proportionally and respects per-mesh locks', () => {
    const { engine, id } = fixture(),
      cmd = new PaintWeightsCommand(engine, id);
    cmd.open();
    cmd.update(0, 0, 0, 0.8, 'replace', [0, 1]);
    const row = weightContext(engine, id).rows[0]!;
    expect(row.find((i) => i.boneIndex === 0)!.weight).toBeCloseTo(0.32);
    expect(row.find((i) => i.boneIndex === 1)!.weight).toBeCloseTo(0.48);
    expect(row.find((i) => i.boneIndex === 2)!.weight).toBeCloseTo(0.2);
  });
});
