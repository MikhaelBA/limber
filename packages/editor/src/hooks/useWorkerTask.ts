import { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '../store/editorStore';

/** Shared UI lifetime for cancellable authoring jobs; the task owns its publication checks. */
export function useWorkerTask(label: string) {
  const mode = useEditorStore((state) => state.mode);
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
  const run = async (
    task: (signal: AbortSignal, progress: (fraction: number) => void) => Promise<string>,
  ) => {
    if (running.current) return;
    const controller = new AbortController();
    running.current = controller;
    setFraction(0);
    try {
      const status = await task(controller.signal, (value) => {
        if (mounted.current) setFraction(value);
      });
      if (mounted.current && !controller.signal.aborted) useEditorStore.getState().setStatus(status);
    } catch (error) {
      if (mounted.current)
        useEditorStore
          .getState()
          .setStatus(
            (error as Error).name === 'AbortError' ? `${label} cancelled.` : (error as Error).message,
          );
    } finally {
      if (running.current === controller) running.current = null;
      if (mounted.current) setFraction(null);
    }
  };
  return { fraction, run, cancel: () => running.current?.abort() };
}
