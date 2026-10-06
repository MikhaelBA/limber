import { describe, expect, it } from 'vitest';
import { EditorEngine } from '../src/engine/EditorEngine';
import {
  AddPolygonAttachmentCommand,
  SetClipEndSlotCommand,
} from '../src/commands/attachmentCommands';
import { AddSlotCommand } from '../src/commands/slotCommands';

function setup() {
  const engine = new EditorEngine();
  const rootId = engine.skeleton.data.bones[0]!.id;
  const slotCmd = new AddSlotCommand(engine, rootId);
  slotCmd.do();
  return { engine, rootId, slotId: slotCmd.slotId };
}

describe('AddPolygonAttachmentCommand', () => {
  it('creates a bounding box quad, assigns it, skins it rigid; undo removes', () => {
    const { engine, slotId } = setup();
    const cmd = new AddPolygonAttachmentCommand(engine, slotId, { x: 0, y: 0, width: 40, height: 20 }, 'boundingBox');
    cmd.do();
    const att = engine.skeleton.data.attachments[0]!;
    expect(att.type).toBe('boundingBox');
    expect(att.meshVertices).toEqual([-20, -10, 20, -10, 20, 10, -20, 10]);
    expect(att.meshHull).toEqual([0, 1, 2, 3]);
    expect(engine.skeleton.data.slots[0]!.defaultAttachmentId).toBe(cmd.attachmentId);
    expect(att.name).toBe('boundingBox');

    engine.tick(0); // Skinning runs — the pose cache carries the world quad.
    expect([...engine.skeleton.pose.attachments.get(cmd.attachmentId)!.verts]).toEqual(
      [-20, -10, 20, -10, 20, 10, -20, 10],
    );

    cmd.undo();
    expect(engine.skeleton.data.attachments).toHaveLength(0);
    expect(engine.skeleton.data.slots[0]!.defaultAttachmentId).toBeNull();
    cmd.do();
    expect(engine.skeleton.data.attachments).toHaveLength(1);
  });

  it('creates a clipping polygon (endSlotId null) and the end slot is editable + undoable', () => {
    const { engine, slotId } = setup();
    const clip = new AddPolygonAttachmentCommand(engine, slotId, { x: 0, y: 0, width: 80, height: 80 }, 'clipping');
    clip.do();
    const att = engine.skeleton.data.attachments[0] as { type: 'clipping'; endSlotId?: string | null };
    expect(att.type).toBe('clipping');
    expect(att.endSlotId ?? null).toBeNull(); // Clip through the last slot by default.

    const cmd = new SetClipEndSlotCommand(engine, clip.attachmentId, slotId);
    cmd.do();
    expect(att.endSlotId).toBe(slotId);
    cmd.undo();
    expect(att.endSlotId ?? null).toBeNull();
    cmd.do();
    expect(att.endSlotId).toBe(slotId);
  });
});
