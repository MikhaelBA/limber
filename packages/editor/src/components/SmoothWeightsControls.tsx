import { useState } from 'react';
import { ApplyAutoWeightsCommand, rigFingerprint } from '../commands/autoWeightCommands';
import { prepareSmoothWeights } from '../commands/smoothWeightCommands';
import { runSmoothWeightJob } from '../engine/smoothWeightJob';
import { useEngine } from '../hooks/useEngine';
import { useWorkerTask } from '../hooks/useWorkerTask';
import { useEditorStore } from '../store/editorStore';

export function SmoothWeightsControls({
  attachmentId,
  slotId,
  maxInfluences,
}: {
  attachmentId: string;
  slotId: string | null;
  maxInfluences: number;
}) {
  const engine = useEngine(),
    [strength, setStrength] = useState('0.5'),
    [iterations, setIterations] = useState('1');
  const job = useWorkerTask('Smooth weights');
  const start = () =>
    job.run(async (signal, progress) => {
      if (!slotId) throw new Error('Select a mesh slot before smoothing.');
      const input = prepareSmoothWeights(
        engine,
        attachmentId,
        slotId,
        Number(strength),
        Number(iterations),
        maxInfluences,
      );
      const project = engine.project,
        skeleton = engine.skeleton,
        fingerprint = rigFingerprint(engine);
      const result = await runSmoothWeightJob(input, { signal, progress });
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      if (engine.project !== project || engine.skeleton !== skeleton)
        throw new Error('Smooth weights discarded because the project changed. Run it again.');
      useEditorStore
        .getState()
        .execute(
          new ApplyAutoWeightsCommand(engine, attachmentId, result.result, fingerprint, 'Smooth weights'),
        );
      return `Weights smoothed (${Math.round(result.durationMs)} ms computation).`;
    });
  const mesh = engine.skeleton.attachmentById.get(attachmentId),
    enabled = !!mesh?.weights && !!mesh.boneBindings;
  return (
    <div className="space-y-1 border-t border-neutral-700 pt-1">
      <div className="flex gap-2">
        <label>
          Strength
          <input
            aria-label="Weight smoothing strength"
            type="number"
            min="0"
            max="1"
            step="0.1"
            className="block w-16 rounded bg-neutral-800 px-1"
            value={strength}
            onChange={(event) => setStrength(event.target.value)}
          />
        </label>
        <label>
          Passes
          <input
            aria-label="Weight smoothing passes"
            type="number"
            min="1"
            max="100"
            step="1"
            className="block w-16 rounded bg-neutral-800 px-1"
            value={iterations}
            onChange={(event) => setIterations(event.target.value)}
          />
        </label>
      </div>
      <button
        disabled={!enabled || job.fraction !== null}
        className="rounded bg-neutral-700 px-2 py-1"
        onClick={() => {
          void start();
        }}
      >
        Smooth weights
      </button>
      {job.fraction !== null && (
        <>
          <button className="ml-2 rounded bg-neutral-700 px-2 py-1" onClick={job.cancel}>
            Cancel smooth weights
          </button>
          <label className="block">
            Smoothing {Math.round(job.fraction * 100)}%
            <progress
              aria-label="Smooth weights progress"
              className="block w-full"
              value={job.fraction}
              max={1}
            />
          </label>
        </>
      )}
    </div>
  );
}
