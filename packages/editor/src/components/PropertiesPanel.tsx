import { useEffect, useRef, useState } from 'react';
import { SetKeyframeCommand, type BonePropertyName } from '../commands/animationCommands';
import {
  SetBonePropsCommand,
  wouldCreateCycle,
  ReparentBoneCommand,
  type BonePropsSnapshot,
} from '../commands/boneCommands';
import { useEngine } from '../hooks/useEngine';
import { useEditorStore } from '../store/editorStore';

const DEG = 180 / Math.PI;

function fmt(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

/**
 * Numeric field that commits ON BLUR/ENTER — typing "120" is one undo step, not
 * three (DESIGN.md §5.3 text-input coalescing). External value changes while
 * not focused (undo/redo) resync the text.
 */
function NumberField({
  label,
  value,
  onCommit,
  step = 1,
}: {
  label: string;
  value: number;
  onCommit: (next: number) => void;
  step?: number;
}) {
  const [text, setText] = useState(() => fmt(value));
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) setText(fmt(value));
  }, [value]);

  const commit = () => {
    const n = parseFloat(text);
    if (Number.isFinite(n) && n !== value) onCommit(n);
    else setText(fmt(value));
  };

  return (
    <label className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-xs text-neutral-400">{label}</span>
      <input
        type="number"
        step={step}
        value={text}
        onFocus={() => (focusedRef.current = true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          focusedRef.current = false;
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        className="w-full rounded bg-neutral-800 px-1.5 py-0.5 text-sm ring-neutral-700 focus:outline-none focus:ring-1 focus:ring-sky-500"
      />
    </label>
  );
}

function TextField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (next: string) => void;
}) {
  const [text, setText] = useState(value);
  const focusedRef = useRef(false);
  useEffect(() => {
    if (!focusedRef.current) setText(value);
  }, [value]);
  const commit = () => {
    if (text !== value && text.trim() !== '') onCommit(text.trim());
    else setText(value);
  };
  return (
    <label className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-xs text-neutral-400">{label}</span>
      <input
        type="text"
        value={text}
        onFocus={() => (focusedRef.current = true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          focusedRef.current = false;
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        className="w-full rounded bg-neutral-800 px-1.5 py-0.5 text-sm ring-neutral-700 focus:outline-none focus:ring-1 focus:ring-sky-500"
      />
    </label>
  );
}

/** Captures the bone's current editable state as a command snapshot. */
function snapshot(name: string, length: number, setup: BonePropsSnapshot['setup']): BonePropsSnapshot {
  return { name, length, setup: { ...setup } };
}

export function PropertiesPanel() {
  const engine = useEngine();
  useEditorStore((s) => s.dataRevision); // Re-read engine data on undo/redo/commands.
  const selected = useEditorStore((s) => s.selectedBoneId);
  const mode = useEditorStore((s) => s.mode);
  const execute = useEditorStore((s) => s.execute);
  const setStatus = useEditorStore((s) => s.setStatus);

  const bone = selected ? engine.skeleton.data.bones.find((b) => b.id === selected) : undefined;
  if (!bone) {
    return (
      <aside className="flex h-full flex-col bg-neutral-900">
        <div className="border-b border-neutral-800 px-2 py-1 text-xs font-semibold uppercase tracking-wider text-neutral-400">
          Properties
        </div>
        <p className="p-3 text-xs text-neutral-500">Select a bone to edit its setup pose.</p>
      </aside>
    );
  }

  const setup = bone.setupPose;
  // §5.6: in Animate mode the panel shows the CURRENT animated pose values and
  // edits write keyframes at the playhead; in Setup mode it edits the rig.
  const animating = mode === 'animate' && !!engine.currentAnimation;
  const poseLocal = animating
    ? engine.skeleton.pose.bones[engine.skeleton.boneIndexMap.get(bone.id)!]?.local
    : undefined;

  /** Builds before/after snapshots and executes a SETUP-pose edit. */
  const edit = (apply: (snap: BonePropsSnapshot) => void) => {
    const before = snapshot(bone.name, bone.length, setup);
    const after = snapshot(bone.name, bone.length, setup);
    apply(after);
    execute(new SetBonePropsCommand(engine, bone.id, before, after));
  };

  /** Animate-mode transform edit: one keyframe command at the playhead. */
  const keyProp = (prop: BonePropertyName, value: number) => {
    execute(new SetKeyframeCommand(engine, bone.id, prop, engine.currentTime, value));
  };

  const src = (prop: BonePropertyName): number =>
    animating && poseLocal ? poseLocal[prop] : setup[prop];
  const commitTransform = (prop: BonePropertyName, value: number) => {
    if (animating) keyProp(prop, value);
    else edit((s) => (s.setup[prop] = value));
  };

  const parentOptions = engine.skeleton.data.bones.filter(
    (b) => b.id !== bone.id && !wouldCreateCycle(engine.skeleton.data, bone.id, b.id),
  );

  return (
    <aside className="flex h-full flex-col overflow-auto bg-neutral-900">
      <div className="border-b border-neutral-800 px-2 py-1 text-xs font-semibold uppercase tracking-wider text-neutral-400">
        Properties — Bone
      </div>
      <div className="flex flex-col gap-1.5 p-2">
        <TextField label="Name" value={bone.name} onCommit={(name) => edit((s) => (s.name = name))} />
        <div className="my-1 h-px bg-neutral-800" />
        <NumberField label="X" value={src('x')} onCommit={(x) => commitTransform('x', x)} />
        <NumberField label="Y" value={src('y')} onCommit={(y) => commitTransform('y', y)} />
        {/* Radians in the data model, degrees at the UI boundary (§8.1). */}
        <NumberField
          label="Rot °"
          step={5}
          value={src('rotation') * DEG}
          onCommit={(deg) => commitTransform('rotation', deg / DEG)}
        />
        <NumberField label="Scale X" step={0.1} value={src('scaleX')} onCommit={(v) => commitTransform('scaleX', v)} />
        <NumberField label="Scale Y" step={0.1} value={src('scaleY')} onCommit={(v) => commitTransform('scaleY', v)} />
        <NumberField
          label="Shear X °"
          step={5}
          value={src('shearX') * DEG}
          onCommit={(deg) => commitTransform('shearX', deg / DEG)}
        />
        <NumberField
          label="Shear Y °"
          step={5}
          value={src('shearY') * DEG}
          onCommit={(deg) => commitTransform('shearY', deg / DEG)}
        />
        <NumberField label="Length" value={bone.length} onCommit={(v) => edit((s) => (s.length = v))} />
        <div className="my-1 h-px bg-neutral-800" />
        <label className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-xs text-neutral-400">Parent</span>
          <select
            value={bone.parentId ?? ''}
            onChange={(e) => {
              const next = e.target.value || null;
              if (next === bone.id || (next && wouldCreateCycle(engine.skeleton.data, bone.id, next))) {
                setStatus('Cannot parent a bone under its own descendant.');
                return;
              }
              execute(new ReparentBoneCommand(engine, bone.id, next));
            }}
            className="w-full rounded bg-neutral-800 px-1.5 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-sky-500"
          >
            <option value="">(root)</option>
            {parentOptions.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
      </div>
    </aside>
  );
}
