import { useState } from 'react';
import { useEngine } from '../hooks/useEngine';
import { useEditorStore } from '../store/editorStore';
import type { Command } from '../history/history';
import {
  AddPathConstraintCommand,
  EditPathConstraintCommand,
  RemovePathConstraintCommand,
  SetPathPointCommand,
  EditPathShapeCommand,
  RemovePathCommand,
} from '../commands/pathConstraintCommands';
import { MoveConstraintCommand } from '../commands/ikCommands';
import { SetKeyframeCommand } from '../commands/animationCommands';
function Numeric({
  label,
  value,
  commit,
  min,
  max,
}: {
  label: string;
  value: number;
  commit: (v: number) => void;
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
        step={max === 1 ? 0.05 : 1}
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
export function PathConstraintControls({ boneId }: { boneId: string }) {
  const engine = useEngine(),
    mode = useEditorStore((s) => s.mode),
    execute = useEditorStore((s) => s.execute),
    status = useEditorStore((s) => s.setStatus),
    select = useEditorStore((s) => s.select);
  const data = engine.skeleton.data,
    byId = new Map(data.bones.map((b) => [b.id, b]));
  const chainTo = (end: string): string[] => {
    const chain: string[] = [];
    for (let b = byId.get(end); b; b = b.parentId ? byId.get(b.parentId) : undefined) {
      chain.unshift(b.id);
      if (b.id === boneId) return chain;
    }
    return [];
  };
  const [pendingEnd, setEnd] = useState(boneId),
    [pendingPath, setPath] = useState('');
  const end = chainTo(pendingEnd).length ? pendingEnd : boneId;
  const available = (data.paths ?? []).filter((p) => !chainTo(p.boneId).length);
  const path = available.some((p) => p.id === pendingPath) ? pendingPath : '';
  const run = (command: Command) => {
    try {
      execute(command);
      return true;
    } catch (error) {
      status((error as Error).message);
      return false;
    }
  };
  const related = (data.pathConstraints ?? []).filter(
    (c) =>
      c.bones.includes(boneId) ||
      c.driverId === boneId ||
      data.paths?.find((p) => p.id === c.pathId)?.boneId === boneId,
  );
  const owned = (data.paths ?? []).filter(
    (p) => p.boneId === boneId || related.some((c) => c.pathId === p.id),
  );
  return (
    <div className="mt-2 border-t border-neutral-800 pt-2">
      <fieldset disabled={mode !== 'setup'} className="flex flex-col gap-1 disabled:opacity-60">
        <span className="text-xs font-semibold text-neutral-400">Path follow</span>
        <label className="flex items-center gap-1 text-xs text-neutral-400">
          Chain end
          <select
            aria-label="Path chain end"
            value={end}
            className="min-w-0 flex-1 rounded bg-neutral-800"
            onChange={(e) => setEnd(e.target.value)}
          >
            {data.bones
              .filter((b) => chainTo(b.id).length)
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
          </select>
        </label>
        <label className="flex items-center gap-1 text-xs text-neutral-400">
          Path
          <select
            aria-label="Path source"
            value={path}
            className="min-w-0 flex-1 rounded bg-neutral-800"
            onChange={(e) => setPath(e.target.value)}
          >
            <option value="">Create a new curve</option>
            {available.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="rounded bg-neutral-800 px-2 py-1 text-xs text-teal-200"
          onClick={() => {
            if (run(new AddPathConstraintCommand(engine, chainTo(end), path || null)))
              status('Path follow created — edit the curve or key progress.');
          }}
        >
          Follow path
        </button>
      </fieldset>
      {related.map((c) => {
        const index = engine.skeleton.constraintOrder.findIndex((e) => e.data.id === c.id);
        return (
          <div key={c.id} className="mt-2 rounded bg-neutral-800/40 p-1.5">
            <span className="text-xs text-teal-300">
              {data.paths?.find((p) => p.id === c.pathId)?.name} · {c.bones.length} bones
            </span>
            <fieldset disabled={mode !== 'setup'} className="disabled:opacity-60">
              <Numeric
                label="Path progress %"
                value={c.progress * 100}
                commit={(v) => run(new EditPathConstraintCommand(engine, c.id, { progress: v / 100 }))}
              />
              <Numeric
                label="Path spacing"
                value={c.spacing}
                min={0}
                commit={(v) => run(new EditPathConstraintCommand(engine, c.id, { spacing: v }))}
              />
              <Numeric
                label="Path position strength"
                value={c.mixTranslation}
                min={0}
                max={1}
                commit={(v) => run(new EditPathConstraintCommand(engine, c.id, { mixTranslation: v }))}
              />
              <Numeric
                label="Path rotation strength"
                value={c.mixRotation}
                min={0}
                max={1}
                commit={(v) => run(new EditPathConstraintCommand(engine, c.id, { mixRotation: v }))}
              />
              <details className="mt-1 text-xs text-neutral-400">
                <summary className="cursor-pointer">Advanced path</summary>
                <Numeric
                  label="Path rotation offset °"
                  value={(c.rotationOffset * 180) / Math.PI}
                  commit={(v) =>
                    run(new EditPathConstraintCommand(engine, c.id, { rotationOffset: (v * Math.PI) / 180 }))
                  }
                />
                <div className="mt-1 flex gap-2">
                  Order: {c.order}
                  <button
                    title="Move path earlier"
                    disabled={index === 0}
                    onClick={() => run(new MoveConstraintCommand(engine, c.id, -1))}
                  >
                    ↑
                  </button>
                  <button
                    title="Move path later"
                    disabled={index === engine.skeleton.constraintOrder.length - 1}
                    onClick={() => run(new MoveConstraintCommand(engine, c.id, 1))}
                  >
                    ↓
                  </button>
                  <button
                    title="Delete path follow"
                    className="ml-auto text-red-300"
                    onClick={() => run(new RemovePathConstraintCommand(engine, c.id))}
                  >
                    Delete follow
                  </button>
                </div>
              </details>
            </fieldset>
            {c.driverId && (
              <div className="mt-1 flex flex-col gap-1 text-xs text-neutral-400">
                <button
                  className="rounded bg-neutral-800 px-2 py-1 text-teal-200"
                  onClick={() => select(c.driverId)}
                >
                  Select progress control
                </button>
                <label className="flex items-center gap-2">
                  Key progress %
                  <input
                    aria-label="Key path progress %"
                    id={`progress-${c.id}`}
                    type="number"
                    defaultValue={
                      c.progress * 100 +
                      (engine.skeleton.pose.bones[engine.skeleton.boneIndexMap.get(c.driverId)!]?.local.x ??
                        0)
                    }
                    className="ml-auto w-20 rounded bg-neutral-800"
                    disabled={mode !== 'animate' || !engine.currentAnimation}
                  />
                </label>
                <button
                  disabled={mode !== 'animate' || !engine.currentAnimation}
                  className="rounded bg-neutral-800 px-2 py-1 text-amber-200 disabled:opacity-35"
                  onClick={() => {
                    const input = document.getElementById(`progress-${c.id}`) as HTMLInputElement | null;
                    const value = Number(input?.value);
                    if (!input?.value.trim() || !Number.isFinite(Math.fround(value))) {
                      status('Path progress must be finite.');
                      return;
                    }
                    run(
                      new SetKeyframeCommand(
                        engine,
                        c.driverId!,
                        'x',
                        engine.currentTime,
                        value - c.progress * 100,
                      ),
                    );
                  }}
                >
                  Key path progress
                </button>
                <span>The progress control uses X in percentage points.</span>
              </div>
            )}
          </div>
        );
      })}
      {owned.map((p) => (
        <fieldset
          key={p.id}
          disabled={mode !== 'setup'}
          className="mt-2 rounded bg-neutral-800/40 p-1.5 text-xs text-neutral-400 disabled:opacity-60"
        >
          <details>
            <summary className="cursor-pointer">Edit curve: {p.name}</summary>
            <div className="mt-1 flex flex-wrap gap-2">
              <button
                title="Extend path"
                disabled={p.closed || p.segments.length >= 64}
                onClick={() => run(new EditPathShapeCommand(engine, p.id, 'extend'))}
              >
                Extend
              </button>
              <button
                title="Remove last path segment"
                disabled={p.closed || p.segments.length === 1}
                onClick={() => run(new EditPathShapeCommand(engine, p.id, 'removeLast'))}
              >
                Remove last
              </button>
              <button
                title="Toggle closed path"
                disabled={!p.closed && p.segments.length >= 64}
                onClick={() => run(new EditPathShapeCommand(engine, p.id, p.closed ? 'open' : 'close'))}
              >
                {p.closed ? 'Open path' : 'Close path'}
              </button>
              <button
                title="Delete path"
                className="text-red-300"
                onClick={() => run(new RemovePathCommand(engine, p.id))}
              >
                Delete path
              </button>
            </div>
            <span>Coordinates are local to the path owner bone.</span>
            {p.segments.map((s, i) => (
              <details key={i} className="mt-1">
                <summary>Segment {i + 1}</summary>
                {s.map((v, k) => (
                  <Numeric
                    key={k}
                    label={`Path ${i + 1} ${['start X', 'start Y', 'control 1 X', 'control 1 Y', 'control 2 X', 'control 2 Y', 'end X', 'end Y'][k]}`}
                    value={v}
                    commit={(next) => run(new SetPathPointCommand(engine, p.id, i, k, next))}
                  />
                ))}
              </details>
            ))}
          </details>
        </fieldset>
      ))}
    </div>
  );
}
