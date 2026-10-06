import { Component, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// Dev error capture: surfaces otherwise-invisible uncaught errors to probes.
declare global {
  interface Window {
    __errors: string[];
    __reactError: string | null;
  }
}
window.__errors = [];
window.__reactError = null;
window.addEventListener('error', (e) => window.__errors.push(String(e.error ?? e.message)));
window.addEventListener('unhandledrejection', (e) =>
  window.__errors.push(`rejection: ${String(e.reason)}`),
);
// Dev probe: mirror health into the tab title (readable even if the renderer dies).
if (import.meta.env.DEV) {
  setInterval(() => {
    const w = window as unknown as Record<string, unknown>;
    document.title = `BoneByBone E${(w.__errors as string[]).length} T${String(w.__ticks ?? '-')} ${
      w.__reactError ? 'REACTERR' : ''
    }`;
  }, 500);
}

class ProbeErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override componentDidCatch(error: Error) {
    window.__reactError = `${error.name}: ${error.message}`;
    window.__errors.push(`react: ${error.name}: ${error.message}\n${error.stack ?? ''}`);
  }
  override render() {
    if (this.state.error) {
      return (
        <div style={{ color: '#f66', padding: 12, fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
          {String(this.state.error)}
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ProbeErrorBoundary>
      <App />
    </ProbeErrorBoundary>
  </StrictMode>,
);
