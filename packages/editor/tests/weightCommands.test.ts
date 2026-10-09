import { describe, expect, it } from 'vitest';
import { deserializeProject, serializeProject } from '@limber/core';
import { EditorEngine } from '../src/engine/EditorEngine';
import { HistoryManager } from '../src/history/history';
import { NormalizeMeshWeightsCommand } from '../src/commands/weightCommands';
import { PaintWeightsCommand, AddMeshCommand, vertexWeightOf } from '../src/commands/meshCommands';
import { AddBoneCommand } from '../src/commands/boneCommands';
import { AddSlotCommand } from '../src/commands/slotCommands';

function fixture() {
  const engine = new EditorEngine();
  new AddBoneCommand(engine, null, { x: 50, y: 0 }).do();
  new AddBoneCommand(engine, null, { x: 100, y: 0 }).do();
  const slot = new AddSlotCommand(engine, engine.skeleton.data.bones[0]!.id);
  slot.do();
  const mesh = new AddMeshCommand(engine, slot.slotId, {
    textureId: '',
    x: 0,
    y: 0,
    width: 30,
    height: 30,
    cols: 1,
    rows: 1,
  });
  mesh.do();
  engine.skeleton.attachmentById.get(mesh.attachmentId)!.weights = Array.from({ length: 4 }, () => [
    3, 0, 0.2, 1, 0.3, 2, 0.5,
  ]).flat();
  engine.skeleton.rebuild();
  return { engine, id: mesh.attachmentId };
}
describe('mesh influence editing', () => {
  it('prunes and normalizes in one exact undo step, preserves animation and roundtrips through native save', () => {
    const { engine, id } = fixture(),
      history = new HistoryManager();
    engine.document.animations.push({
      name: 'deform',
      duration: 1,
      loop: true,
      timelines: [
        {
          kind: 'deform',
          attachmentId: id,
          keyframes: [{ time: 0, offsets: new Array(8).fill(2), curve: { type: 'linear' } }],
        },
      ],
    });
    const before = structuredClone(engine.project);
    history.execute(new NormalizeMeshWeightsCommand(engine, id, { maxInfluences: 2 }));
    const weights = engine.skeleton.attachmentById.get(id)!.weights!;
    expect(weights.slice(0, 5).filter((_, index) => index !== 2 && index !== 4)).toEqual([2, 1, 2]);
    expect(weights[2]).toBeCloseTo(0.375, 12);
    expect(weights[4]).toBeCloseTo(0.625, 12);
    const after = structuredClone(engine.project);
    expect(deserializeProject(serializeProject(after))).toEqual(after);
    history.undo();
    expect(engine.project).toEqual(before);
    history.redo();
    expect(engine.project).toEqual(after);
    history.undo();
    expect(() =>
      history.execute(new NormalizeMeshWeightsCommand(engine, id, { maxInfluences: 0 })),
    ).toThrow();
    engine.mode = 'animate';
    expect(() => history.execute(new NormalizeMeshWeightsCommand(engine, id))).toThrow(/Setup/);
    expect(engine.project).toEqual(before);
    expect(history.canRedo).toBe(true);
  });
  it('paints a third-bone distribution without discarding other bones and rejects invalid dabs', () => {
    const { engine, id } = fixture();
    const before = structuredClone(engine.project);
    const command = new PaintWeightsCommand(engine, id);
    command.open();
    for (const args of [
      [-1, 1, 0, 0.2],
      [0, 9, 0, 0.2],
      [0, 1, 0, NaN],
    ])
      expect(() => command.update(...(args as [number, number, number, number]))).toThrow();
    expect(engine.project).toEqual(before);
    command.update(0, 0, 0, 0.4);
    command.commit();
    const weights = engine.skeleton.attachmentById.get(id)!.weights;
    expect(vertexWeightOf(weights, 0, 0)).toBeCloseTo(0.6, 12);
    expect(vertexWeightOf(weights, 0, 1)).toBeCloseTo(0.15, 12);
    expect(vertexWeightOf(weights, 0, 2)).toBeCloseTo(0.25, 12);
    command.undo();
    expect(engine.project).toEqual(before);
  });
});
