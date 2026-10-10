import { AddAnimationCommand } from '../commands/animationCommands';
import type { BrushMode } from '../commands/meshCommands';
import { useEngine } from '../hooks/useEngine';
import { useEditorStore, type Tool } from '../store/editorStore';

const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: 'translate', label: '✥ Translate', hint: 'Translate: drag a bone (or empty space with one selected) — setup edits, animate keys (V)' },
  { id: 'rotate', label: '↻ Rotate', hint: 'Rotate: drag around the bone origin; Shift snaps to 15° (C)' },
  { id: 'scale', label: '⤢ Scale', hint: 'Scale: drag from the bone origin (uniform) (X)' },
  { id: 'shear', label: '⇱ Shear', hint: 'Shear: drag to skew the bone along its x-axis (Z)' },
  { id: 'create_bone', label: '＋ Bone', hint: 'Create: click for a default bone, drag to set length and rotation (B)' },
  { id: 'mesh', label: '◈ Mesh', hint: 'Mesh tool (M): region shown → draw a hull; mesh shown → drag vertices, dbl-click adds, Alt+click deletes' },
  { id: 'weights', label: '⚖ Weights', hint: 'Paint vertex weights toward the selected bone (W)' },
];

export function MainToolbar() {
  const engine = useEngine();
  const activeTool = useEditorStore((s) => s.activeTool);
  useEditorStore((s) => s.dataRevision);
  const weightBoneId = useEditorStore((s) => s.weightBoneId);
  const setWeightBone = useEditorStore((s) => s.setWeightBone);
  const setTool = useEditorStore((s) => s.setTool);
  const canUndo = useEditorStore((s) => s.canUndo);
  const canRedo = useEditorStore((s) => s.canRedo);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const mode = useEditorStore((s) => s.mode);
  const setMode = useEditorStore((s) => s.setMode);
  const execute = useEditorStore((s) => s.execute);
  const setPlaying = useEditorStore((s) => s.setPlaying);
  const brushRadius = useEditorStore((s) => s.brushRadius);
  const brushStrength = useEditorStore((s) => s.brushStrength);
  const brushMode = useEditorStore((s) => s.brushMode);
  const setBrush = useEditorStore((s) => s.setBrush);
  const ghostingEnabled = useEditorStore((s) => s.ghostingEnabled);
  const toggleGhosting = useEditorStore((s) => s.toggleGhosting);

  const switchMode = (next: 'setup' | 'animate') => {
    if (next === 'animate' && engine.document.animations.length === 0) {
      // Friendly bootstrapping: an animation must exist to key into.
      const cmd = new AddAnimationCommand(engine);
      execute(cmd);
      engine.setAnimation(cmd.name);
    }
    if (next === 'animate' && !engine.currentAnimation) {
      engine.setAnimation(engine.document.animations[0]?.name ?? null);
    }
    engine.pause();
    setPlaying(false);
    engine.mode = next;
    setMode(next);
  };

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-neutral-800 bg-neutral-900/60 px-2 py-1">
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

      <button
        className={`rounded px-2 py-0.5 text-sm ${
          ghostingEnabled ? 'bg-violet-600/30 text-violet-200 ring-1 ring-violet-500/50' : 'text-neutral-300 hover:bg-neutral-800'
        }`}
        title="Ghosting: onion-skin outlines before/after the playhead (G) — Animate mode"
        onClick={toggleGhosting}
      >
        👁 Ghost
      </button>

      <div className="mx-2 h-4 w-px bg-neutral-700" />

      {activeTool === 'weights' && (
        <>
          <label className="flex items-center gap-1 text-xs text-neutral-300">
            Paint bone
            <select
              aria-label="Weight paint bone"
              className="max-w-40 rounded bg-neutral-800 px-1 py-0.5 text-xs"
              value={weightBoneId && engine.skeleton.boneIndexMap.has(weightBoneId) ? weightBoneId : ''}
              onChange={(e) => setWeightBone(e.target.value || null)}
            >
              <option value="">Choose bone…</option>
              {engine.skeleton.data.bones.map((bone) => (
                <option key={bone.id} value={bone.id}>{bone.name}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1 text-xs text-neutral-400" title="Brush radius (world units)">
            R
            <input
              type="number"
              aria-label="Weight brush radius"
              min={2}
              step={5}
              value={brushRadius}
              onChange={(e) => setBrush({ radius: parseFloat(e.target.value) || 2 })}
              className="w-14 rounded bg-neutral-800 px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-neutral-400" title="Brush strength (per dab)">
            S
            <input
              type="number"
              aria-label="Weight brush strength"
              min={0.02}
              max={1}
              step={0.05}
              value={brushStrength}
              onChange={(e) => setBrush({ strength: parseFloat(e.target.value) || 0.02 })}
              className="w-12 rounded bg-neutral-800 px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
          </label>
          <select
            aria-label="Weight brush behavior"
            value={brushMode}
            onChange={(e) => setBrush({ mode: e.target.value as BrushMode })}
            title="Brush behavior"
            className="rounded bg-neutral-800 px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-sky-500"
          >
            <option value="add">add</option>
            <option value="set">set</option>
            <option value="smooth">smooth</option>
          </select>
          <span className="text-xs text-neutral-400">
            {mode === 'setup' ? 'Select a mesh slot, choose a paint bone, then drag over vertices.' : 'Switch to Setup to paint weights.'}
          </span>
          <div className="mx-1 h-4 w-px bg-neutral-700" />
        </>
      )}

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
