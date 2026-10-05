import { AddAnimationCommand } from '../commands/animationCommands';
import { useEngine } from '../hooks/useEngine';
import { useEditorStore, type Tool } from '../store/editorStore';

const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: 'select', label: '▶ Select', hint: 'Select / drag bones (V)' },
  { id: 'create_bone', label: '＋ Bone', hint: 'Click viewport to create a bone (B)' },
];

export function MainToolbar() {
  const engine = useEngine();
  const activeTool = useEditorStore((s) => s.activeTool);
  const setTool = useEditorStore((s) => s.setTool);
  const canUndo = useEditorStore((s) => s.canUndo);
  const canRedo = useEditorStore((s) => s.canRedo);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const mode = useEditorStore((s) => s.mode);
  const setMode = useEditorStore((s) => s.setMode);
  const execute = useEditorStore((s) => s.execute);
  const setStatus = useEditorStore((s) => s.setStatus);
  const setPlaying = useEditorStore((s) => s.setPlaying);

  const switchMode = (next: 'setup' | 'animate') => {
    if (next === 'animate' && engine.document.animations.length === 0) {
      // Friendly bootstrapping: an animation must exist to key into.
      const cmd = new AddAnimationCommand(engine);
      execute(cmd);
      engine.setAnimation(cmd.name);
    }
    engine.pause();
    setPlaying(false);
    engine.mode = next;
    setMode(next);
  };

  return (
    <div className="flex items-center gap-1 border-b border-neutral-800 bg-neutral-900/60 px-2 py-1">
      {TOOLS.map((tool) => (
        <button
          key={tool.id}
          title={tool.hint}
          onClick={() => setTool(tool.id)}
          className={`rounded px-2 py-0.5 text-sm ${
            activeTool === tool.id
              ? 'bg-sky-600/30 text-sky-200 ring-1 ring-sky-500/50'
              : 'text-neutral-300 hover:bg-neutral-800'
          }`}
        >
          {tool.label}
        </button>
      ))}

      <div className="mx-2 h-4 w-px bg-neutral-700" />

      <button
        className="rounded px-2 py-0.5 text-sm text-neutral-300 hover:bg-neutral-800 disabled:opacity-35"
        disabled={!canUndo}
        onClick={undo}
        title="Undo (Ctrl+Z)"
      >
        ↶ Undo
      </button>
      <button
        className="rounded px-2 py-0.5 text-sm text-neutral-300 hover:bg-neutral-800 disabled:opacity-35"
        disabled={!canRedo}
        onClick={redo}
        title="Redo (Ctrl+Shift+Z / Ctrl+Y)"
      >
        ↷ Redo
      </button>

      <div className="mx-2 h-4 w-px bg-neutral-700" />

      <div className="flex overflow-hidden rounded ring-1 ring-neutral-700" title="Workflow mode">
        <button
          onClick={() => switchMode('setup')}
          className={`px-2 py-0.5 text-sm ${mode === 'setup' ? 'bg-neutral-700 text-white' : 'text-neutral-400 hover:bg-neutral-800'}`}
        >
          Setup
        </button>
        <button
          onClick={() => switchMode('animate')}
          className={`px-2 py-0.5 text-sm ${mode === 'animate' ? 'bg-amber-600/70 text-white' : 'text-neutral-400 hover:bg-neutral-800'}`}
          title="Animate: drags & edits write keyframes at the playhead"
        >
          Animate
        </button>
      </div>
      {mode === 'animate' && (
        <span className="ml-1 text-[11px] text-amber-300/80">auto-key at playhead</span>
      )}
    </div>
  );
}
