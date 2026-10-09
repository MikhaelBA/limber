import { useEngine } from '../hooks/useEngine';
import { useEditorStore } from '../store/editorStore';
import { CreateSharedMeshCommand, DetachSharedMeshCommand, SetMeshTextureCommand } from '../commands/sharedMeshCommands';
import type { Command } from '../history/history';
import { RemoveAttachmentCommand } from '../commands/attachmentCommands';

export function SharedMeshControls({ attachmentId }: { attachmentId: string }) {
  const engine = useEngine();
  const mode = useEditorStore((state) => state.mode);
  const slotId = useEditorStore((state) => state.selectedSlotId);
  useEditorStore((state) => state.dataRevision);
  const execute = useEditorStore((state) => state.execute);
  const setStatus = useEditorStore((state) => state.setStatus);
  const mesh = engine.skeleton.attachmentById.get(attachmentId)!;
  const source = mesh.meshSourceId && engine.skeleton.attachmentById.get(mesh.meshSourceId);
  const run = (make: () => Command, message: string) => {
    try { execute(make()); setStatus(message); }
    catch (error) { setStatus((error as Error).message); }
  };
  return <fieldset disabled={mode !== 'setup'} className="space-y-1 rounded border border-neutral-700 p-2 text-xs disabled:opacity-40">
    <legend>Shared geometry</legend>
    <p className="text-neutral-400">{source ? `Geometry from ${source.name}. Editing vertices updates every linked mesh.` : 'Share vertices, UVs and triangles between variants.'} Weights, binding and Deform are independent.</p>
    <button className="rounded bg-neutral-700 px-2 py-1" disabled={!slotId} onClick={() => run(
      () => new CreateSharedMeshCommand(engine, attachmentId, slotId!, engine.skeleton.data.activeSkin ? 'skin' : 'default'),
      'Shared mesh created and assigned. Its weights, binding and Deform can be edited independently.')}>Create shared mesh</button>
    {source && <button className="ml-1 rounded bg-neutral-700 px-2 py-1" onClick={() => run(
      () => new DetachSharedMeshCommand(engine, attachmentId), 'Mesh detached; geometry is now independent.')}>Detach shared mesh</button>}
    <label className="block">Texture<select aria-label="Mesh texture" className="ml-1 rounded bg-neutral-800" value={mesh.textureId}
      onChange={(event) => run(() => new SetMeshTextureCommand(engine, attachmentId, event.target.value), 'Mesh texture changed.')}>
      <option value="">No texture</option>
      {Object.entries(engine.document.assetManifest).map(([id, meta]) => <option key={id} value={id}>{meta.name}</option>)}
    </select></label>
    <button className="rounded px-2 py-1 text-red-300 hover:bg-neutral-800" onClick={() => run(
      () => new RemoveAttachmentCommand(engine, attachmentId), 'Mesh deleted.')}>Delete mesh</button>
  </fieldset>;
}
