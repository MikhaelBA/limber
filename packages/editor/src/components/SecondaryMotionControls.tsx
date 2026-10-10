import { useState } from 'react';
import type { SecondaryConstraintData } from '@limber/core';
import { useEngine } from '../hooks/useEngine';
import { useEditorStore } from '../store/editorStore';
import type { Command } from '../history/history';
import {
  AddSecondaryMotionCommand,
  EditSecondaryMotionCommand,
  RemoveSecondaryMotionCommand,
} from '../commands/secondaryMotionCommands';
import { MoveConstraintCommand } from '../commands/ikCommands';
function Numeric({
  label,
  value,
  min,
  max,
  commit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  commit: (v: number) => void;
}) {
  return (
    <label className="mt-1 flex items-center gap-2 text-xs text-neutral-400">
      {label}
      <input
        aria-label={label}
        key={`${label}:${value}`}
        type="number"
        defaultValue={value}
        min={min}
        max={max}
        step={max <= 2 ? 0.05 : 1}
        className="ml-auto w-20 rounded bg-neutral-800 px-1 py-0.5 text-neutral-200"
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        onBlur={(e) => {
          const v = parseFloat(e.currentTarget.value);
          if (v !== value) commit(v);
          e.currentTarget.value = String(value);
        }}
      />
    </label>
  );
}
export function SecondaryMotionControls({ boneId }: { boneId: string }) {
  const engine = useEngine(),
    mode = useEditorStore((s) => s.mode),
    execute = useEditorStore((s) => s.execute),
    status = useEditorStore((s) => s.setStatus);
  const [pending, setPending] = useState<SecondaryConstraintData['preset']>('soft');
  const c = engine.skeleton.data.secondaryConstraints?.find((c) => c.boneId === boneId),
    preset = c?.preset ?? pending;
  const run = (command: Command) => {
    try {
      execute(command);
      return true;
    } catch (error) {
      status((error as Error).message);
      return false;
    }
  };
  const index = c ? engine.skeleton.constraintOrder.findIndex((e) => e.data.id === c.id) : -1;
  return (
    <fieldset
      disabled={mode !== 'setup'}
      className="mt-2 border-t border-neutral-800 pt-2 disabled:opacity-60"
    >
      <span className="text-xs font-semibold text-neutral-400">Secondary motion</span>
      <label className="mt-1 flex items-center gap-2 text-xs text-neutral-400">
        Motion preset
        <select
          aria-label="Secondary motion preset"
          value={preset}
          className="ml-auto rounded bg-neutral-800 px-1"
          onChange={(e) => {
            const next = e.target.value as SecondaryConstraintData['preset'];
            if (c) run(new EditSecondaryMotionCommand(engine, c.id, { preset: next }));
            else setPending(next);
          }}
        >
          <option value="soft">Soft</option>
          <option value="bouncy">Bouncy</option>
          <option value="firm">Firm</option>
        </select>
      </label>
      {!c ? (
        <button
          className="mt-1 w-full rounded bg-neutral-800 px-2 py-1 text-xs text-violet-200"
          onClick={() => {
            if (run(new AddSecondaryMotionCommand(engine, boneId, pending)))
              status('Secondary motion added — play the animation to preview inertia.');
          }}
        >
          Add secondary motion
        </button>
      ) : (
        <>
          <Numeric
            label="Secondary strength"
            value={c.mix}
            min={0}
            max={1}
            commit={(v) => run(new EditSecondaryMotionCommand(engine, c.id, { mix: v }))}
          />
          <Numeric
            label="Maximum sway °"
            value={(c.maxAngle * 180) / Math.PI}
            min={0}
            max={180}
            commit={(v) =>
              run(new EditSecondaryMotionCommand(engine, c.id, { maxAngle: (v * Math.PI) / 180 }))
            }
          />
          <details className="mt-1 text-xs text-neutral-400">
            <summary className="cursor-pointer">Advanced secondary motion</summary>
            <Numeric
              label="Secondary frequency Hz"
              value={c.frequency}
              min={0.1}
              max={20}
              commit={(v) => run(new EditSecondaryMotionCommand(engine, c.id, { frequency: v }))}
            />
            <Numeric
              label="Secondary damping"
              value={c.damping}
              min={0}
              max={2}
              commit={(v) => run(new EditSecondaryMotionCommand(engine, c.id, { damping: v }))}
            />
            <div className="mt-1 flex gap-2">
              Order: {c.order}
              <button
                title="Move secondary earlier"
                disabled={index <= 0 || engine.skeleton.constraintOrder[index - 1]?.kind !== 'secondary'}
                onClick={() => run(new MoveConstraintCommand(engine, c.id, -1))}
              >
                ↑
              </button>
              <button
                title="Move secondary later"
                disabled={index === engine.skeleton.constraintOrder.length - 1}
                onClick={() => run(new MoveConstraintCommand(engine, c.id, 1))}
              >
                ↓
              </button>
              <button
                title="Delete secondary motion"
                className="ml-auto text-red-300"
                onClick={() => run(new RemoveSecondaryMotionCommand(engine, c.id))}
              >
                Delete
              </button>
            </div>
          </details>
          <p className="mt-1 text-[11px] text-neutral-500">
            Angular inertia during playback. Pause and scrub show the authored pose.
          </p>
        </>
      )}
    </fieldset>
  );
}
