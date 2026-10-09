import { describe, expect, it } from 'vitest';
import { autoMesh } from '@limber/mesh';
import { EditorEngine } from '../src/engine/EditorEngine';
import { HistoryManager } from '../src/history/history';
import { AddSlotCommand } from '../src/commands/slotCommands';
import { AddAttachmentCommand } from '../src/commands/attachmentCommands';
import { AddSkinCommand, SetActiveSkinCommand } from '../src/commands/skinCommands';
import { ApplyAutoMeshCommand, prepareAutoMesh } from '../src/commands/autoMeshCommands';
import { rigFingerprint } from '../src/commands/autoWeightCommands';

function fixture() {
  const engine = new EditorEngine();
  const slot = new AddSlotCommand(engine, engine.skeleton.data.bones[0]!.id);
  slot.do();
  const region = new AddAttachmentCommand(engine, slot.slotId, {
    textureId: '',
    x: 12,
    y: 30,
    width: 20,
    height: 40,
  });
  region.do();
  engine.tick(0);
  return { engine, slot: slot.slotId, region: region.attachmentId };
}
describe('auto mesh publication', () => {
  it('keeps the source region and keys, assigns a fresh stable mesh and restores exact undo/redo', () => {
    const { engine, slot, region } = fixture(),
      history = new HistoryManager(),
      before = structuredClone(engine.project);
    const geometry = autoMesh(prepareAutoMesh(engine, region, 2, 2));
    const command = new ApplyAutoMeshCommand(
      engine,
      slot,
      region,
      geometry,
      rigFingerprint(engine),
      'default',
    );
    geometry.vertices.fill(NaN);
    history.execute(command);
    const after = structuredClone(engine.project);
    expect(engine.skeleton.attachmentById.get(region)!.type).toBe('region');
    expect(engine.skeleton.attachmentById.get(command.attachmentId)!.meshVertices!.length).toBe(18);
    expect(engine.skeleton.data.slots[0]!.defaultAttachmentId).toBe(command.attachmentId);
    history.undo();
    expect(engine.project).toEqual(before);
    history.redo();
    expect(engine.project).toEqual(after);
  });
  it('assigns the active skin without changing defaults and rejects stale/invalid results before redo loss', () => {
    const { engine, slot, region } = fixture(),
      history = new HistoryManager();
    const skin = new AddSkinCommand(engine);
    skin.name = 'variant';
    skin.do();
    new SetActiveSkinCommand(engine, 'variant').do();
    const fingerprint = rigFingerprint(engine),
      geometry = autoMesh(prepareAutoMesh(engine, region, 2, 2));
    const command = new ApplyAutoMeshCommand(engine, slot, region, geometry, fingerprint, 'skin');
    history.execute(command);
    expect(engine.skeleton.data.slots[0]!.defaultAttachmentId).toBe(region);
    expect(engine.skeleton.data.skins[0]!.attachments[slot]).toBe(command.attachmentId);
    history.undo();
    const before = structuredClone(engine.project);
    expect(() =>
      history.execute(
        new ApplyAutoMeshCommand(engine, slot, region, { ...geometry, triangles: [] }, fingerprint, 'skin'),
      ),
    ).toThrow();
    expect(engine.project).toEqual(before);
    expect(history.canRedo).toBe(true);
    engine.skeleton.data.slots[0]!.name = 'changed';
    const changed = structuredClone(engine.project);
    expect(() =>
      history.execute(new ApplyAutoMeshCommand(engine, slot, region, geometry, fingerprint, 'skin')),
    ).toThrow(/rig changed/);
    expect(engine.project).toEqual(changed);
    expect(history.canRedo).toBe(true);
    engine.mode = 'animate';
    expect(() => prepareAutoMesh(engine, region, 2, 2)).toThrow(/Setup/);
  });
});
