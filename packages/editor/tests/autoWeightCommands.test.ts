import { describe, expect, it } from 'vitest';
import { autoWeights } from '@limber/mesh';
import { EditorEngine } from '../src/engine/EditorEngine';
import { HistoryManager } from '../src/history/history';
import { AddBoneCommand } from '../src/commands/boneCommands';
import { AddSlotCommand } from '../src/commands/slotCommands';
import { AddMeshCommand } from '../src/commands/meshCommands';
import { BindMeshCommand } from '../src/commands/bindMeshCommand';
import {
  ApplyAutoWeightsCommand,
  prepareAutoWeights,
  rigFingerprint,
} from '../src/commands/autoWeightCommands';

function fixture() {
  const engine = new EditorEngine(),
    root = engine.skeleton.data.bones[0]!.id;
  const target = new AddBoneCommand(engine, null, { x: 100, y: 0 });
  target.do();
  const slot = new AddSlotCommand(engine, root);
  slot.do();
  const mesh = new AddMeshCommand(engine, slot.slotId, {
    textureId: '',
    x: 100,
    y: 0,
    width: 20,
    height: 20,
    cols: 1,
    rows: 1,
  });
  mesh.do();
  new BindMeshCommand(engine, mesh.attachmentId, slot.slotId, [target.boneId]).do();
  engine.document.animations.push({
    name: 'deform',
    duration: 1,
    loop: false,
    timelines: [
      {
        kind: 'deform',
        attachmentId: mesh.attachmentId,
        keyframes: [{ time: 0, offsets: Array(8).fill(0), curve: { type: 'linear' } }],
      },
    ],
  });
  return { engine, slot: slot.slotId, mesh: mesh.attachmentId };
}
describe('automatic weights publication', () => {
  it('preserves bind shape, deform tracks and exact source through undo/redo', () => {
    const { engine, slot, mesh } = fixture(),
      history = new HistoryManager();
    engine.tick(0);
    const vertices = [...engine.skeleton.pose.attachments.get(mesh)!.verts];
    const before = structuredClone(engine.project),
      input = prepareAutoWeights(engine, mesh, slot, 2);
    const weights = autoWeights(input),
      command = new ApplyAutoWeightsCommand(engine, mesh, weights, rigFingerprint(engine));
    weights.fill(99);
    history.execute(command);
    engine.tick(0);
    const after = structuredClone(engine.project);
    vertices.forEach((value, i) =>
      expect(engine.skeleton.pose.attachments.get(mesh)!.verts[i]).toBeCloseTo(value, 4),
    );
    expect(engine.document.animations).toEqual(
      before.artboards[0]!.nodes[0]!.type === 'rig' ? before.artboards[0]!.nodes[0]!.animations : [],
    );
    history.undo();
    expect(engine.project).toEqual(before);
    history.redo();
    expect(engine.project).toEqual(after);
  });
  it('rejects stale, invalid and wrong-mode results before source or redo changes', () => {
    const { engine, slot, mesh } = fixture(),
      history = new HistoryManager();
    const input = prepareAutoWeights(engine, mesh, slot, 2),
      fingerprint = rigFingerprint(engine);
    history.execute(new ApplyAutoWeightsCommand(engine, mesh, autoWeights(input), fingerprint));
    history.undo();
    const before = structuredClone(engine.project);
    expect(() => history.execute(new ApplyAutoWeightsCommand(engine, mesh, [], fingerprint))).toThrow();
    expect(engine.project).toEqual(before);
    expect(history.canRedo).toBe(true);
    engine.skeleton.data.slots[0]!.name = 'changed';
    const changed = structuredClone(engine.project);
    expect(() =>
      history.execute(new ApplyAutoWeightsCommand(engine, mesh, autoWeights(input), fingerprint)),
    ).toThrow(/rig changed/);
    expect(engine.project).toEqual(changed);
    expect(history.canRedo).toBe(true);
    engine.mode = 'animate';
    expect(() => prepareAutoWeights(engine, mesh, slot, 2)).toThrow(/Setup/);
    expect(() =>
      history.execute(new ApplyAutoWeightsCommand(engine, mesh, autoWeights(input), rigFingerprint(engine))),
    ).toThrow();
    expect(engine.project).toEqual(changed);
    expect(history.canRedo).toBe(true);
  });
});
