import { useState } from 'react';
import { NormalizeMeshWeightsCommand } from '../commands/weightCommands';
import { useEngine } from '../hooks/useEngine';
import { useEditorStore } from '../store/editorStore';

export function MeshWeightsPanel({ attachmentId }: { attachmentId: string }) {
  const engine = useEngine();
  const mode = useEditorStore((s) => s.mode);
  useEditorStore((s) => s.dataRevision);
  const execute = useEditorStore((s) => s.execute);
  const setStatus = useEditorStore((s) => s.setStatus);
  const [limit, setLimit] = useState('4');
  const weighted = !!engine.skeleton.attachmentById.get(attachmentId)?.weights;
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
      disabled={mode !== 'setup' || !weighted}
      className="space-y-1 rounded border border-neutral-700 p-2 text-xs disabled:opacity-40"
    >
      <legend>Weights</legend>
      <label className="flex items-center gap-2">
        Max influences
        <input
          aria-label="Maximum mesh influences"
          type="number"
          min="1"
          step="1"
          className="min-w-0 w-14 rounded bg-neutral-800 px-1"
          value={limit}
          onChange={(event) => setLimit(event.target.value)}
        />
      </label>
      <div className="flex gap-2">
        <button className="rounded bg-neutral-700 px-2 py-1" onClick={() => run(false)}>
          Normalize weights
        </button>
        <button className="rounded bg-neutral-700 px-2 py-1" onClick={() => run(true)}>
          Prune weights
        </button>
      </div>
    </fieldset>
  );
}
