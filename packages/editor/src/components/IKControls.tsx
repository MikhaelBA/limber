import type { Command } from '../history/history';
import { useEngine } from '../hooks/useEngine';
import { useEditorStore } from '../store/editorStore';
import {
  AddIKConstraintCommand,
  PinLimbCommand,
  RemoveIKConstraintCommand,
  SetIKPropsCommand,
  MoveIKConstraintCommand,
} from '../commands/ikCommands';

/** Artist controls use the same validated Setup commands as advanced IK editing. */
export function IKControls({ boneId }: { boneId: string }) {
  const engine = useEngine();
  const mode = useEditorStore((s) => s.mode),
    execute = useEditorStore((s) => s.execute);
  const status = useEditorStore((s) => s.setStatus),
    select = useEditorStore((s) => s.select);
  const data = engine.skeleton.data,
    bone = data.bones.find((b) => b.id === boneId)!;
  const byId = new Map(data.bones.map((b) => [b.id, b]));
  const lower = bone.parentId ? byId.get(bone.parentId) : undefined;
  const canPin = Boolean(lower?.parentId);
  const run = (command: Command): boolean => {
    try {
      execute(command);
      return true;
    } catch (error) {
      status((error as Error).message);
      return false;
    }
  };
  const pin = (kind: 'hand' | 'foot') => {
    const command = new PinLimbCommand(engine, boneId, kind);
    if (run(command)) {
      select(command.targetBoneId);
      status(`${command.label} created — drag the target; the body can move independently.`);
    }
  };
  return (
    <fieldset disabled={mode !== 'setup'} className="mt-1 flex flex-col gap-1 disabled:opacity-60">
      <span className="text-xs font-semibold text-neutral-400">Limb pins</span>
      <p className="text-[10px] text-neutral-500">
        Select the hand or foot bone at the end of a two-bone limb.
      </p>
      <div className="flex gap-1">
        <button
          className="rounded bg-neutral-800 px-2 py-1 text-xs text-amber-200 disabled:opacity-35"
          disabled={!canPin}
          onClick={() => pin('hand')}
        >
          Pin Hand
        </button>
        <button
          className="rounded bg-neutral-800 px-2 py-1 text-xs text-amber-200 disabled:opacity-35"
          disabled={!canPin}
          onClick={() => pin('foot')}
        >
          Pin Foot
        </button>
      </div>
      {mode !== 'setup' && (
        <p className="text-[10px] text-neutral-500">Switch to Setup to edit constraints.</p>
      )}
      {data.ikConstraints
        .filter((c) => c.bones.includes(boneId) || c.targetId === boneId)
        .map((c) => {
          const index = data.ikConstraints.indexOf(c);
          const chain = c.bones.map((id) => byId.get(id)?.name ?? '?').join(' → ');
          const outside = (id: string): boolean => {
            for (let b = byId.get(id); b; b = b.parentId ? byId.get(b.parentId) : undefined)
              if (b.id === c.bones[0]) return false;
            return true;
          };
          return (
            <div key={c.id} className="mt-1 rounded bg-neutral-800/40 p-1.5">
              <div className="mb-1 flex items-center gap-1 text-[11px] text-amber-300/90">
                IK {chain} ⇢ {byId.get(c.targetId)?.name}
                <button
                  title="Delete IK constraint (target bone stays)"
                  className="ml-auto rounded px-1 text-xs text-red-300"
                  onClick={() => run(new RemoveIKConstraintCommand(engine, c.id))}
                >
                  🗑
                </button>
              </div>
              <label className="flex items-center gap-2 text-xs text-neutral-400">
                Strength
                <input
                  aria-label="IK strength"
                  key={`${c.id}:${c.mix}`}
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  defaultValue={c.mix}
                  className="w-20 rounded bg-neutral-800 px-1 py-0.5 text-neutral-200"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                  }}
                  onBlur={(e) => {
                    const value = parseFloat(e.currentTarget.value);
                    if (value !== c.mix) run(new SetIKPropsCommand(engine, c.id, { mix: value }));
                    e.currentTarget.value = String(c.mix);
                  }}
                />
              </label>
              <button
                title="Flip the elbow side"
                className="mt-1 rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-200"
                onClick={() =>
                  run(new SetIKPropsCommand(engine, c.id, { bendDirection: c.bendDirection === 1 ? -1 : 1 }))
                }
              >
                Bend side: {c.bendDirection === 1 ? 'clockwise' : 'counterclockwise'}
              </button>
              <details className="mt-1 text-xs text-neutral-400">
                <summary className="cursor-pointer">Advanced IK</summary>
                <label className="mt-1 flex items-center gap-1">
                  Target
                  <select
                    aria-label="IK target"
                    value={c.targetId}
                    className="min-w-0 flex-1 rounded bg-neutral-800 px-1 py-0.5"
                    onChange={(e) => run(new SetIKPropsCommand(engine, c.id, { targetId: e.target.value }))}
                  >
                    {data.bones
                      .filter((b) => outside(b.id))
                      .map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                  </select>
                </label>
                <div className="mt-1 flex items-center gap-2">
                  Order: {c.order}
                  <button
                    title="Move IK earlier"
                    disabled={index === 0}
                    className="rounded bg-neutral-800 px-2 disabled:opacity-35"
                    onClick={() => run(new MoveIKConstraintCommand(engine, c.id, -1))}
                  >
                    ↑
                  </button>
                  <button
                    title="Move IK later"
                    disabled={index === data.ikConstraints.length - 1}
                    className="rounded bg-neutral-800 px-2 disabled:opacity-35"
                    onClick={() => run(new MoveIKConstraintCommand(engine, c.id, 1))}
                  >
                    ↓
                  </button>
                </div>
              </details>
            </div>
          );
        })}
      <details className="mt-1 text-xs text-neutral-400">
        <summary className="cursor-pointer">Advanced creation</summary>
        <p className="my-1 text-[10px]">For other chains, select their last bone and add IK at its tip.</p>
        <button
          className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-amber-200"
          onClick={() => {
            const c = new AddIKConstraintCommand(engine, boneId);
            if (run(c)) {
              select(c.targetBoneId);
              status('IK created — drag its target.');
            }
          }}
        >
          ＋ Add IK
        </button>
      </details>
    </fieldset>
  );
}
