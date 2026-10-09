import { RigHelperPanel } from './RigHelperPanel';
import { MarkerPanel } from './MarkerPanel';
import { useRef, useState } from 'react';
import { wouldCreateCycle } from '../commands/boneCommands';
import { useEngine } from '../hooks/useEngine';
import { useEditorStore } from '../store/editorStore';
import { AddBoneCommand, RemoveBoneCommand, ReparentBoneCommand } from '../commands/boneCommands';
import { AddSlotCommand, RemoveSlotCommand, ReorderSlotCommand } from '../commands/slotCommands';
import { AddIKConstraintCommand } from '../commands/ikCommands';
import { KeyDrawOrderCommand } from '../commands/animationCommands';
import { CompositeCommand, type Command } from '../history/history';

interface Row {
  id: string;
  name: string;
  depth: number;
}

export function HierarchyPanel() {
  const engine = useEngine();
  // Subscribe ONLY to the revision — data itself is read imperatively (§5.4).
  useEditorStore((s) => s.dataRevision);
  const selected = useEditorStore((s) => s.selectedBoneId);
  const mode = useEditorStore((s) => s.mode);
  const selectedSlot = useEditorStore((s) => s.selectedSlotId);
  const select = useEditorStore((s) => s.select);
  const selectSlot = useEditorStore((s) => s.selectSlot);
  const execute = useEditorStore((s) => s.execute);
  const setStatus = useEditorStore((s) => s.setStatus);

  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const draggedIdRef = useRef<string | null>(null);

  const data = engine.skeleton.data;
  const boneName = new Map(data.bones.map((b) => [b.id, b.name]));

  // data.bones is topologically sorted ⇒ parents come first, so a single pass
  // with an id→depth map builds the flat indented tree.
  const depthById = new Map<string, number>();
  const rows: Row[] = data.bones.map((bone) => {
    const depth = bone.parentId === null ? 0 : (depthById.get(bone.parentId) ?? 0) + 1;
    depthById.set(bone.id, depth);
    return { id: bone.id, name: bone.name, depth };
  });

  const addRoot = () => {
    const cmd = new AddBoneCommand(engine, null, { x: 0, y: 0 });
    execute(cmd);
    select(cmd.boneId);
  };

  const addChild = () => {
    if (!selected) return;
    const cmd = new AddBoneCommand(engine, selected, { x: 0, y: 0 });
    execute(cmd);
    select(cmd.boneId);
  };

  const removeSelected = () => {
    if (!selected) return;
    try {
      execute(new RemoveBoneCommand(engine, selected));
    } catch (error) {
      setStatus((error as Error).message);
    }
  };

  const reparent = (boneId: string, newParentId: string | null) => {
    if (newParentId === boneId) return;
    if (newParentId !== null && wouldCreateCycle(data, boneId, newParentId)) {
      setStatus('Cannot reparent a bone under its own descendant.');
      return;
    }
    try {
      execute(new ReparentBoneCommand(engine, boneId, newParentId));
    } catch (error) {
      setStatus((error as Error).message);
    }
  };

  const isDropTarget = (targetId: string) => {
    const dragged = draggedIdRef.current;
    return dragged !== null && dragged !== targetId && !wouldCreateCycle(data, dragged, targetId);
  };

  /**
   * Reorder = setup-data edit; in Animate mode it also keys the NEW default
   * order at the playhead (§5.6 auto-key), as ONE undo step. The explicit
   * identity order is passed because pose.slotOrder still holds the
   * previously applied timeline permutation at that instant.
   */
  const reorderSlot = (slotId: string, delta: -1 | 1) => {
    const cmds: Command[] = [new ReorderSlotCommand(engine, slotId, delta)];
    if (useEditorStore.getState().mode === 'animate' && engine.currentAnimation) {
      cmds.push(
        new KeyDrawOrderCommand(
          engine,
          engine.skeleton.data.slots.map((_, i) => i),
        ),
      );
    }
    execute(new CompositeCommand(`Reorder Slot`, cmds));
  };

  const addSlot = () => {
    // Slot binds to the selected bone, else the root bone (§3.1: a slot MUST
    // have a bone — there is no "unbound" slot).
    const boneId = selected ?? data.bones[0]?.id ?? null;
    if (!boneId) {
      setStatus('Create a bone before adding a slot.');
      return;
    }
    const cmd = new AddSlotCommand(engine, boneId);
    execute(cmd);
    selectSlot(cmd.slotId);
  };

  /** IK chain = the selected bone + its parent; target bone lands at the tip. */
  const addIk = () => {
    if (!selected) {
      setStatus('Select a bone first — IK controls it (plus its parent).');
      return;
    }
    try {
      const cmd = new AddIKConstraintCommand(engine, selected);
      execute(cmd);
      select(cmd.targetBoneId);
      setStatus('IK created — drag the target bone; edit strength/bend in Properties.');
    } catch (error) {
      setStatus((error as Error).message);
    }
  };

  return (
    <div className="flex h-full flex-col bg-neutral-900">
      <div className="flex items-center gap-1 border-b border-neutral-800 px-2 py-1">
        <span className="mr-auto text-xs font-semibold uppercase tracking-wider text-neutral-400">
          Hierarchy
        </span>
        <button
          className="rounded px-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
          title="Add root bone"
          onClick={addRoot}
        >
          ＋⌂
        </button>
        <button
          className="rounded px-1.5 text-sm text-neutral-300 hover:bg-neutral-800 disabled:opacity-35"
          title="Add child of selected"
          disabled={!selected}
          onClick={addChild}
        >
          ＋↳
        </button>
        <button
          className="rounded px-1.5 text-sm text-neutral-300 hover:bg-neutral-800 disabled:opacity-35"
          title="Delete selected (Del)"
          disabled={!selected}
          onClick={removeSelected}
        >
          🗑
        </button>
      </div>

      {/* Dropping on the list background reparents to root. */}
      <div
        className="flex-1 overflow-auto p-1"
        onDragOver={(e) => e.preventDefault()}
        onDrop={() => {
          if (draggedIdRef.current) reparent(draggedIdRef.current, null);
          setDragOverId(null);
        }}
      >
        {rows.length === 0 && (
          <p className="p-2 text-xs text-neutral-500">No bones. Use the ＋ buttons or the Bone tool.</p>
        )}
        {rows.map((row) => {
          const isSelected = row.id === selected;
          const isDragOver = row.id === dragOverId;
          return (
            <div
              key={row.id}
              draggable
              onDragStart={(e) => {
                draggedIdRef.current = row.id;
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', row.id);
              }}
              onDragEnd={() => {
                draggedIdRef.current = null;
                setDragOverId(null);
              }}
              onDragOver={(e) => {
                if (isDropTarget(row.id)) {
                  e.preventDefault();
                  setDragOverId(row.id);
                }
              }}
              onDragLeave={() => setDragOverId((cur) => (cur === row.id ? null : cur))}
              onDrop={(e) => {
                e.stopPropagation();
                const id = draggedIdRef.current ?? e.dataTransfer.getData('text/plain');
                if (id && isDropTarget(row.id)) reparent(id, row.id);
                setDragOverId(null);
              }}
              onClick={() => select(row.id)}
              style={{ paddingLeft: `${row.depth * 14 + 6}px` }}
              className={`cursor-default truncate rounded py-0.5 pr-2 text-sm ${
                isSelected
                  ? 'bg-sky-600/30 text-sky-100 ring-1 ring-sky-500/40'
                  : isDragOver
                    ? 'bg-neutral-700/60 ring-1 ring-sky-500/60'
                    : 'text-neutral-300 hover:bg-neutral-800'
              }`}
            >
              {row.name}
            </div>
          );
        })}

        {/* Slots — array order IS the default draw order (§3.1). */}
        <div className="mt-1 flex items-center gap-1 border-t border-neutral-800 px-2 py-1">
          <span className="mr-auto text-xs font-semibold uppercase tracking-wider text-neutral-400">
            Slots
          </span>
          <button
            className="rounded px-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
            title="Add slot (to selected bone or root)"
            onClick={addSlot}
          >
            ＋
          </button>
        </div>
        {data.slots.length === 0 && (
          <p className="p-2 text-xs text-neutral-500">No slots. Drop an image on the viewport or use ＋.</p>
        )}
        {data.slots.map((slot, i) => {
          const isSlotSel = slot.id === selectedSlot;
          return (
            <div
              key={slot.id}
              onClick={() => selectSlot(slot.id)}
              className={`flex cursor-default items-center gap-1 rounded py-0.5 pl-2 pr-1 text-sm ${
                isSlotSel
                  ? 'bg-sky-600/30 text-sky-100 ring-1 ring-sky-500/40'
                  : 'text-neutral-300 hover:bg-neutral-800'
              }`}
            >
              <span className="w-4 shrink-0 text-right text-[10px] text-neutral-500">{i + 1}</span>
              <span className="truncate">
                {slot.name}
                <span className="ml-1 text-[10px] text-neutral-500">@{boneName.get(slot.boneId) ?? '?'}</span>
              </span>
              <span className="ml-auto flex shrink-0 items-center">
                <button
                  className="rounded px-1 text-xs text-neutral-400 hover:bg-neutral-700 disabled:opacity-30"
                  title="Draw earlier"
                  disabled={i === 0}
                  onClick={(e) => {
                    e.stopPropagation();
                    reorderSlot(slot.id, -1);
                  }}
                >
                  ↑
                </button>
                <button
                  className="rounded px-1 text-xs text-neutral-400 hover:bg-neutral-700 disabled:opacity-30"
                  title="Draw later"
                  disabled={i === data.slots.length - 1}
                  onClick={(e) => {
                    e.stopPropagation();
                    reorderSlot(slot.id, 1);
                  }}
                >
                  ↓
                </button>
                <button
                  className="rounded px-1 text-xs text-neutral-400 hover:bg-neutral-700"
                  title="Delete slot"
                  onClick={(e) => {
                    e.stopPropagation();
                    execute(new RemoveSlotCommand(engine, slot.id));
                  }}
                >
                  🗑
                </button>
              </span>
            </div>
          );
        })}

        {/* IK constraints — chain → target, click selects the chain end. */}
        <div className="mt-1 flex items-center gap-1 border-t border-neutral-800 px-2 py-1">
          <span className="mr-auto text-xs font-semibold uppercase tracking-wider text-neutral-400">IK</span>
          <button
            className="rounded px-1.5 text-sm text-neutral-300 hover:bg-neutral-800 disabled:opacity-35"
            title="Add IK controlling the selected bone (+ its parent)"
            disabled={!selected || mode !== 'setup'}
            onClick={addIk}
          >
            ＋
          </button>
        </div>
        {data.ikConstraints.length === 0 && (
          <p className="p-2 text-xs text-neutral-500">No IK constraints. Select a bone and ＋.</p>
        )}
        {data.ikConstraints.map((c) => {
          const endId = c.bones[c.bones.length - 1]!;
          const chainLabel = c.bones.map((id) => boneName.get(id) ?? '?').join('→');
          return (
            <div
              key={c.id}
              onClick={() => select(endId)}
              className={`flex cursor-default items-center gap-1 rounded py-0.5 pl-2 pr-1 text-sm ${
                selected === endId || selected === c.targetId
                  ? 'bg-sky-600/30 text-sky-100 ring-1 ring-sky-500/40'
                  : 'text-neutral-300 hover:bg-neutral-800'
              }`}
              title={`IK: ${chainLabel} → ${boneName.get(c.targetId) ?? '?'} (mix ${c.mix})`}
            >
              <span className="truncate text-amber-300/90">
                ⚙ {chainLabel} ⇢ {boneName.get(c.targetId) ?? '?'}
              </span>
            </div>
          );
        })}
        {(data.transformConstraints?.length ?? 0) > 0 && (
          <div className="mt-1 border-t border-neutral-800 px-2 py-1 text-xs font-semibold uppercase tracking-wider text-neutral-400">
            Transform follow
          </div>
        )}
        {(data.transformConstraints ?? []).map((c) => (
          <div
            key={c.id}
            onClick={() => select(c.boneId)}
            className={`cursor-default rounded py-0.5 pl-2 pr-1 text-sm ${selected === c.boneId || selected === c.targetId ? 'bg-sky-600/30 text-sky-100' : 'text-amber-300/90'}`}
            title={`Follow: ${boneName.get(c.boneId)} → ${boneName.get(c.targetId)} (order ${c.order})`}
          >
            {boneName.get(c.boneId)} ⇢ {boneName.get(c.targetId)}
          </div>
        ))}
        <RigHelperPanel />
        <MarkerPanel />
      </div>
    </div>
  );
}
