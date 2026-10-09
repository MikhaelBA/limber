import { useEffect, useRef, useState } from 'react';
import { ApplyAutoWeightsCommand, prepareAutoWeights, rigFingerprint } from '../commands/autoWeightCommands';
import { runAutoWeightJob } from '../engine/autoWeightJob';
import { useEngine } from '../hooks/useEngine';
import { useEditorStore } from '../store/editorStore';

export function AutoWeightsControls({
  attachmentId,
  slotId,
  maxInfluences,
}: {
  attachmentId: string;
  slotId: string | null;
  maxInfluences: number;
}) {
  const engine = useEngine(),
    mode = useEditorStore((state) => state.mode);
  const [fraction, setFraction] = useState<number | null>(null);
  const running = useRef<AbortController | null>(null),
    mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      running.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (mode !== 'setup') running.current?.abort();
  }, [mode]);
  const start = async () => {
    if (running.current || !slotId) return;
    const controller = new AbortController();
    running.current = controller;
    try {
      const input = prepareAutoWeights(engine, attachmentId, slotId, maxInfluences);
      const project = engine.project,
        skeleton = engine.skeleton,
        fingerprint = rigFingerprint(engine);
      setFraction(0);
      const result = await runAutoWeightJob(input, {
        signal: controller.signal,
        progress: (value) => {
          if (mounted.current) setFraction(value);
        },
      });
      if (controller.signal.aborted) return;
      if (engine.project !== project || engine.skeleton !== skeleton)
        throw new Error('Auto weights discarded because the project changed. Run it again.');
      useEditorStore
        .getState()
        .execute(new ApplyAutoWeightsCommand(engine, attachmentId, result.weights, fingerprint));
      useEditorStore
        .getState()
        .setStatus(`Auto weights applied (${Math.round(result.durationMs)} ms computation).`);
    } catch (error) {
      if (mounted.current)
        useEditorStore
          .getState()
          .setStatus(
            (error as Error).name === 'AbortError' ? 'Auto weights cancelled.' : (error as Error).message,
          );
    } finally {
      if (running.current === controller) running.current = null;
      if (mounted.current) setFraction(null);
    }
  };
  const bound = !!engine.skeleton.attachmentById.get(attachmentId)?.boneBindings?.length;
  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <button
          disabled={!bound || fraction !== null}
          className="rounded bg-neutral-700 px-2 py-1"
          onClick={() => {
            void start();
          }}
        >
          Auto weights
        </button>
        {fraction !== null && (
          <button className="rounded bg-neutral-700 px-2 py-1" onClick={() => running.current?.abort()}>
            Cancel auto weights
          </button>
        )}
      </div>
      {fraction !== null && (
        <label className="block">
          Auto weights {Math.round(fraction * 100)}%
          <progress aria-label="Auto weights progress" className="block w-full" value={fraction} max={1} />
        </label>
      )}
    </div>
  );
}
