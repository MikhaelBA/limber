import { useState } from 'react';
import { ApplyAutoMeshCommand, prepareAutoMesh } from '../commands/autoMeshCommands';
import { rigFingerprint } from '../commands/autoWeightCommands';
import { runAutoMeshJob } from '../engine/autoMeshJob';
import { useEngine } from '../hooks/useEngine';
import { useWorkerTask } from '../hooks/useWorkerTask';
import { useEditorStore } from '../store/editorStore';

export function AutoMeshControls({ attachmentId, slotId }: { attachmentId: string; slotId: string }) {
  const engine = useEngine(),
    mode = useEditorStore((state) => state.mode);
  const [cols, setCols] = useState('2'),
    [rows, setRows] = useState('2');
  const job = useWorkerTask('Auto mesh');
  const start = () =>
    job.run(async (signal, progress) => {
      const input = prepareAutoMesh(engine, attachmentId, Number(cols), Number(rows));
      const project = engine.project,
        skeleton = engine.skeleton,
        fingerprint = rigFingerprint(engine);
      const target = engine.skeleton.data.activeSkin ? 'skin' : 'default';
      const result = await runAutoMeshJob(input, { signal, progress });
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      if (engine.project !== project || engine.skeleton !== skeleton)
        throw new Error('Auto mesh discarded because the project changed. Run it again.');
      useEditorStore
        .getState()
        .execute(new ApplyAutoMeshCommand(engine, slotId, attachmentId, result.result, fingerprint, target));
      const status = `Auto mesh applied (${Math.round(result.durationMs)} ms computation). Original region retained.`;
      useEditorStore.getState().setStatus(status);
      return status;
    });
  return (
    <fieldset disabled={mode !== 'setup'} className="space-y-1 rounded border border-neutral-700 p-2 text-xs">
      <legend>Auto mesh · grid</legend>
      <div className="flex gap-2">
        <label>
          Columns
          <input
            aria-label="Auto mesh columns"
            type="number"
            min="1"
            step="1"
            className="block w-16 rounded bg-neutral-800 px-1"
            value={cols}
            onChange={(event) => setCols(event.target.value)}
          />
        </label>
        <label>
          Rows
          <input
            aria-label="Auto mesh rows"
            type="number"
            min="1"
            step="1"
            className="block w-16 rounded bg-neutral-800 px-1"
            value={rows}
            onChange={(event) => setRows(event.target.value)}
          />
        </label>
      </div>
      <button
        disabled={job.fraction !== null}
        className="rounded bg-neutral-700 px-2 py-1"
        onClick={() => {
          void start();
        }}
      >
        Auto mesh
      </button>
      {job.fraction !== null && (
        <>
          <button className="ml-2 rounded bg-neutral-700 px-2 py-1" onClick={job.cancel}>
            Cancel auto mesh
          </button>
          <label className="block">
            Auto mesh {Math.round(job.fraction * 100)}%
            <progress aria-label="Auto mesh progress" className="block w-full" value={job.fraction} max={1} />
          </label>
        </>
      )}
    </fieldset>
  );
}
