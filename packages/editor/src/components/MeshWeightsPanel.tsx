import { useState } from 'react';
import { NormalizeMeshWeightsCommand } from '../commands/weightCommands';
import { BindMeshCommand } from '../commands/bindMeshCommand';
import { useEngine } from '../hooks/useEngine';
import { useEditorStore } from '../store/editorStore';

export function MeshWeightsPanel({ attachmentId }: { attachmentId: string }) {
  const engine = useEngine();
  const mode = useEditorStore((s) => s.mode);
  const slotId = useEditorStore((s) => s.selectedSlotId);
  useEditorStore((s) => s.dataRevision);
  const execute = useEditorStore((s) => s.execute);
  const setStatus = useEditorStore((s) => s.setStatus);
  const [limit, setLimit] = useState('4');
  const mesh = engine.skeleton.attachmentById.get(attachmentId);
  const [boneIds, setBoneIds] = useState(
    () =>
      mesh?.boneBindings?.map((binding) => binding.boneId) ??
      engine.skeleton.data.bones.map((bone) => bone.id),
  );
  const weighted = !!mesh?.weights;
  const bind = () => {
    try {
      if (!slotId) throw new Error('Select a mesh slot before binding.');
      execute(new BindMeshCommand(engine, attachmentId, slotId, boneIds));
      setStatus('Mesh bound to the setup pose. Paint weights to control each bone’s influence.');
    } catch (error) {
      setStatus((error as Error).message);
    }
  };
  const run = (prune: boolean) => {
    try {
      const options = prune ? { maxInfluences: limit.trim() ? Number(limit) : NaN } : {};
      execute(new NormalizeMeshWeightsCommand(engine, attachmentId, options));
      setStatus(
        prune
          ? `Weights pruned to at most ${limit} influences per vertex and normalized.`
          : 'Weights normalized; zero influences removed.',
      );
    } catch (error) {
      setStatus((error as Error).message);
    }
  };
  return (
    <fieldset
      disabled={mode !== 'setup'}
      className="space-y-1 rounded border border-neutral-700 p-2 text-xs disabled:opacity-40"
    >
      <legend>Weights</legend>
      <label className="block">
        Bind bones
        <select
          multiple
          aria-label="Mesh binding bones"
          size={Math.min(5, engine.skeleton.data.bones.length)}
          className="mt-1 block w-full rounded bg-neutral-800 px-1"
          value={boneIds.filter((id) => engine.skeleton.boneIndexMap.has(id))}
          onChange={(event) => setBoneIds(Array.from(event.target.selectedOptions, (option) => option.value))}
        >
          {engine.skeleton.data.bones.map((bone) => (
            <option key={bone.id} value={bone.id}>
              {bone.name}
            </option>
          ))}
        </select>
      </label>
      <button className="rounded bg-neutral-700 px-2 py-1" onClick={bind}>
        Bind setup pose
      </button>
      <p className="text-neutral-400">
        {mesh?.boneBindings
          ? `${mesh.boneBindings.length} bones bound`
          : 'Select bones, bind, then paint weights.'}
      </p>
      <label className="flex items-center gap-2">
        Max influences
        <input
          aria-label="Maximum mesh influences"
          type="number"
          min="1"
          step="1"
          className="min-w-0 w-14 rounded bg-neutral-800 px-1"
          value={limit}
          disabled={!weighted}
          onChange={(event) => setLimit(event.target.value)}
        />
      </label>
      <div className="flex gap-2">
        <button disabled={!weighted} className="rounded bg-neutral-700 px-2 py-1" onClick={() => run(false)}>
          Normalize weights
        </button>
        <button disabled={!weighted} className="rounded bg-neutral-700 px-2 py-1" onClick={() => run(true)}>
          Prune weights
        </button>
      </div>
    </fieldset>
  );
}
