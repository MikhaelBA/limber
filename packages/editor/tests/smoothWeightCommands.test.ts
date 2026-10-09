import { describe, expect, it } from 'vitest';
import { smoothWeights } from '@limber/mesh';
import { EditorEngine } from '../src/engine/EditorEngine';
import { HistoryManager } from '../src/history/history';
import { AddSlotCommand } from '../src/commands/slotCommands';
import { AddMeshCommand } from '../src/commands/meshCommands';
import { BindMeshCommand } from '../src/commands/bindMeshCommand';
import { ApplyAutoWeightsCommand, rigFingerprint } from '../src/commands/autoWeightCommands';
import { prepareSmoothWeights } from '../src/commands/smoothWeightCommands';

describe('smooth weight command context', () => {
  it('requires a bound weighted setup mesh and retains binding/deform/source through exact history', () => {
    const engine = new EditorEngine(),
      root = engine.skeleton.data.bones[0]!.id,
      history = new HistoryManager();
    const slot = new AddSlotCommand(engine, root);
    slot.do();
    const command = new AddMeshCommand(engine, slot.slotId, {
      textureId: '',
      x: 0,
      y: 0,
      width: 20,
      height: 20,
      cols: 1,
      rows: 1,
    });
    command.do();
    expect(() => prepareSmoothWeights(engine, command.attachmentId, slot.slotId, 0.5, 1, 4)).toThrow(
      /bound weighted/,
    );
    new BindMeshCommand(engine, command.attachmentId, slot.slotId, [root]).do();
    engine.skeleton.attachmentById.get(command.attachmentId)!.weights = [0, 1, 0, 1, 1, 0, 1, 1, 0, 1];
    engine.document.animations.push({
      name: 'deform',
      duration: 1,
      loop: true,
      timelines: [
        {
          kind: 'deform',
          attachmentId: command.attachmentId,
          keyframes: [{ time: 0, offsets: Array(8).fill(2), curve: { type: 'linear' } }],
        },
      ],
    });
    const before = structuredClone(engine.project),
      input = prepareSmoothWeights(engine, command.attachmentId, slot.slotId, 0.5, 2, 4);
    history.execute(
      new ApplyAutoWeightsCommand(
        engine,
        command.attachmentId,
        smoothWeights(input),
        rigFingerprint(engine),
        'Smooth weights',
      ),
    );
    const after = structuredClone(engine.project);
    expect(engine.skeleton.attachmentById.get(command.attachmentId)!.boneBindings).toEqual(
      before.artboards[0]!.nodes[0]!.type === 'rig'
        ? before.artboards[0]!.nodes[0]!.skeleton.attachments[0]!.boneBindings
        : undefined,
    );
    history.undo();
    expect(engine.project).toEqual(before);
    history.redo();
    expect(engine.project).toEqual(after);
    engine.mode = 'animate';
    expect(() => prepareSmoothWeights(engine, command.attachmentId, slot.slotId, 0.5, 1, 4)).toThrow(/Setup/);
  });
});
