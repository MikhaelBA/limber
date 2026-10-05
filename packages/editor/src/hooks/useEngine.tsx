import { createContext, useContext, useRef, type ReactNode } from 'react';
import { EditorEngine } from '../engine/EditorEngine';

const EngineContext = createContext<EditorEngine | null>(null);

/**
 * One engine per app instance via context (DESIGN.md §5.1 — not a bare
 * getInstance() singleton, so multiple viewports/tests stay possible).
 */
export function EngineProvider({ children }: { children: ReactNode }) {
  const ref = useRef<EditorEngine | null>(null);
  if (!ref.current) ref.current = new EditorEngine();
  return <EngineContext.Provider value={ref.current}>{children}</EngineContext.Provider>;
}

export function useEngine(): EditorEngine {
  const engine = useContext(EngineContext);
  if (!engine) throw new Error('useEngine must be used inside <EngineProvider>.');
  return engine;
}
