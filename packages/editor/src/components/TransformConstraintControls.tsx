import { useState } from 'react';
import type { Command } from '../history/history';
import { useEngine } from '../hooks/useEngine';
import { useEditorStore } from '../store/editorStore';
import {
  AddTransformConstraintCommand,
  EditTransformConstraintCommand,
  RemoveTransformConstraintCommand,
} from '../commands/transformConstraintCommands';
import { MoveConstraintCommand } from '../commands/ikCommands';
import type { Transform } from '@limber/core';
function Numeric({
  label,
  value,
  commit,
  min,
  max,
}: {
  label: string;
  value: number;
  commit: (value: number) => void;
  min?: number;
  max?: number;
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
        step="0.05"
        className="ml-auto w-20 rounded bg-neutral-800 px-1 py-0.5 text-neutral-200"
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        onBlur={(e) => {
          const next = parseFloat(e.currentTarget.value);
          if (next !== value) commit(next);
          e.currentTarget.value = String(value);
        }}
      />
    </label>
  );
}
export function TransformConstraintControls({ boneId }: { boneId: string }) {
  const engine = useEngine(),
    mode = useEditorStore((s) => s.mode),
    execute = useEditorStore((s) => s.execute),
    status = useEditorStore((s) => s.setStatus);
  const data = engine.skeleton.data,
    byId = new Map(data.bones.map((b) => [b.id, b]));
  const outside = (controlled: string, id: string): boolean => {
    for (let b = byId.get(id); b; b = b.parentId ? byId.get(b.parentId) : undefined)
      if (b.id === controlled) return false;
    return true;
  };
  const options = data.bones.filter((b) => outside(boneId, b.id));
  const ancestors = new Set<string>();
  for (let b = byId.get(boneId); b?.parentId; b = byId.get(b.parentId)) ancestors.add(b.parentId);
  const [pendingTarget, setPendingTarget] = useState(''),
    [maintain, setMaintain] = useState(true);
  const target = options.some((b) => b.id === pendingTarget)
    ? pendingTarget
    : (options.find((b) => !ancestors.has(b.id))?.id ?? options[0]?.id ?? '');
  const run = (command: Command) => {
    try {
      execute(command);
      return true;
    } catch (error) {
      status((error as Error).message);
      return false;
    }
  };
  return (
    <fieldset
      disabled={mode !== 'setup'}
      className="mt-2 flex flex-col gap-1 border-t border-neutral-800 pt-2 disabled:opacity-60"
    >
      <span className="text-xs font-semibold text-neutral-400">Transform follow</span>
      <label className="flex items-center gap-1 text-xs text-neutral-400">
        Follow target
        <select
          aria-label="Follow target"
          value={target}
          className="min-w-0 flex-1 rounded bg-neutral-800 px-1 py-0.5"
          onChange={(e) => setPendingTarget(e.target.value)}
        >
          {!options.length && <option value="">Add an independent target bone</option>}
          {options.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1 text-xs text-neutral-400">
        <input
          type="checkbox"
          aria-label="Keep follow offset"
          checked={maintain}
          onChange={(e) => setMaintain(e.target.checked)}
        />
        Keep current pose
      </label>
      <button
        disabled={!target}
        className="rounded bg-neutral-800 px-2 py-1 text-xs text-amber-200 disabled:opacity-35"
        onClick={() => {
          if (run(new AddTransformConstraintCommand(engine, boneId, target, maintain)))
            status('Transform follow created — move its target.');
        }}
      >
        Follow transform
      </button>
      {(data.transformConstraints ?? [])
        .filter((c) => c.boneId === boneId || c.targetId === boneId)
        .map((c) => {
          const index = engine.skeleton.constraintOrder.findIndex((entry) => entry.data.id === c.id);

          return (
            <div key={c.id} className="mt-1 rounded bg-neutral-800/40 p-1.5">
              <div className="flex items-center gap-1 text-[11px] text-amber-300/90">
                Follow {byId.get(c.boneId)?.name} ⇢ {byId.get(c.targetId)?.name}
                <button
                  title="Delete transform follow"
                  className="ml-auto text-red-300"
                  onClick={() => run(new RemoveTransformConstraintCommand(engine, c.id))}
                >
                  🗑
                </button>
              </div>
              {(
                [
                  ['Follow position', 'mixTranslation'],
                  ['Follow rotation', 'mixRotation'],
                  ['Follow scale', 'mixScale'],
                  ['Follow shear', 'mixShear'],
                ] as const
              ).map(([label, key]) => (
                <Numeric
                  key={key}
                  label={label}
                  value={c[key]}
                  min={0}
                  max={1}
                  commit={(v) => run(new EditTransformConstraintCommand(engine, c.id, { [key]: v }))}
                />
              ))}
              <details className="mt-1 text-xs text-neutral-400">
                <summary className="cursor-pointer">Advanced follow</summary>
                <label className="mt-1 flex items-center gap-1">
                  Target
                  <select
                    aria-label="Transform follow target"
                    value={c.targetId}
                    className="min-w-0 flex-1 rounded bg-neutral-800"
                    onChange={(e) =>
                      run(new EditTransformConstraintCommand(engine, c.id, { targetId: e.target.value }))
                    }
                  >
                    {data.bones
                      .filter((b) => outside(c.boneId, b.id))
                      .map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="mt-1 flex items-center gap-1">
                  Space
                  <select
                    aria-label="Follow space"
                    value={c.space}
                    className="rounded bg-neutral-800"
                    onChange={(e) =>
                      run(
                        new EditTransformConstraintCommand(engine, c.id, {
                          space: e.target.value as 'world' | 'local',
                        }),
                      )
                    }
                  >
                    <option value="world">World</option>
                    <option value="local">Local</option>
                  </select>
                </label>
                {(['x', 'y', 'rotation', 'scaleX', 'scaleY', 'shearX', 'shearY'] as (keyof Transform)[]).map(
                  (key) => {
                    const angle = key === 'rotation' || key === 'shearX' || key === 'shearY';
                    return (
                      <Numeric
                        key={key}
                        label={`Follow offset ${key}${angle ? ' °' : ''}`}
                        value={c.offset[key] * (angle ? 180 / Math.PI : 1)}
                        commit={(v) =>
                          run(
                            new EditTransformConstraintCommand(engine, c.id, {
                              offset: { [key]: v * (angle ? Math.PI / 180 : 1) },
                            }),
                          )
                        }
                      />
                    );
                  },
                )}
                <div className="mt-1 flex items-center gap-2">
                  Order: {c.order}
                  <button
                    title="Move follow earlier"
                    disabled={index === 0}
                    className="rounded bg-neutral-800 px-2 disabled:opacity-35"
                    onClick={() => run(new MoveConstraintCommand(engine, c.id, -1))}
                  >
                    ↑
                  </button>
                  <button
                    title="Move follow later"
                    disabled={index === engine.skeleton.constraintOrder.length - 1}
                    className="rounded bg-neutral-800 px-2 disabled:opacity-35"
                    onClick={() => run(new MoveConstraintCommand(engine, c.id, 1))}
                  >
                    ↓
                  </button>
                </div>
              </details>
            </div>
          );
        })}
    </fieldset>
  );
}
