import { RigHelperPanel } from './RigHelperPanel';
import { MarkerPanel } from './MarkerPanel';
import { useEffect, useRef, useState } from 'react';
import { BoneIcon, type BoneIconKind } from './BoneIcon';
import { wouldCreateCycle } from '../commands/boneCommands';
import { useEngine } from '../hooks/useEngine';
import { useEditorStore } from '../store/editorStore';
import { AddBoneCommand, RemoveBoneCommand, ReparentBoneCommand } from '../commands/boneCommands';
import { AddSlotCommand, RemoveSlotCommand, ReorderSlotCommand } from '../commands/slotCommands';
import { AddIKConstraintCommand } from '../commands/ikCommands';
import { KeyDrawOrderCommand } from '../commands/animationCommands';

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
  const draggedSlotRef = useRef<string | null>(null);
  const [slotDrop, setSlotDrop] = useState<{ id: string; after: boolean } | null>(null);
  const [, refreshOrder] = useState(0);
  // Only stepped order changes re-render React; ordinary playback ticks do not.
  useEffect(() => {
    let last = '';
    return engine.onTransient('time', () => {
      const sk = engine.skeleton;
      const signature = JSON.stringify(
        useEditorStore.getState().mode === 'animate'
          ? Array.from(sk.pose.slotOrder, (i) => sk.data.slots[i]!.id)
          : sk.data.slots.map((s) => s.id),
      );
      if (signature !== last) {
        last = signature;
        refreshOrder((v) => v + 1);
      }
    });
  }, [engine]);

  const data = engine.skeleton.data;
  const bonesById = new Map(data.bones.map((b) => [b.id, b]));
  const boneName = new Map(data.bones.map((b) => [b.id, b.name]));
  const targets = new Set([
    ...data.ikConstraints.flatMap((c) => [c.targetId, ...(c.poleVectorId ? [c.poleVectorId] : [])]),
    ...(data.transformConstraints ?? []).map((c) => c.targetId),
  ]);
  const slots =
    mode === 'animate' ? Array.from(engine.skeleton.pose.slotOrder, (i) => data.slots[i]!) : data.slots;

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
    const parent = data.bones.find((bone) => bone.id === selected);
    if (!parent) return;
    const cmd = new AddBoneCommand(engine, selected, { x: parent.length, y: 0 });
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

  const reorderSlot = (slotId: string, to: number) => {
    engine.pause();
    useEditorStore.getState().setPlaying(false);
    engine.tick(0);
    const current =
      mode === 'animate'
        ? Array.from(engine.skeleton.pose.slotOrder, (i) => data.slots[i]!.id)
        : data.slots.map((s) => s.id);
    const at = current.indexOf(slotId);
    if (at < 0 || at === to || to < 0 || to >= current.length) return;
    if (mode === 'animate' && !engine.currentAnimation) {
      setStatus('Select an animation to key draw order, or use Setup for the default order.');
      return;
    }
    try {
      if (mode === 'animate') {
        current.splice(to, 0, current.splice(at, 1)[0]!);
        execute(
          new KeyDrawOrderCommand(
            engine,
            current.map((id) => engine.skeleton.slotIndexMap.get(id)!),
          ),
        );
      } else execute(new ReorderSlotCommand(engine, slotId, to - at));
      selectSlot(slotId);
      setStatus(mode === 'animate' ? 'Draw order keyed at playhead.' : 'Default draw order updated.');
    } catch (error) {
      setStatus((error as Error).message);
    }
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
        {mode === 'setup' && (
          <>
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
          </>
        )}
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
          const bone = bonesById.get(row.id)!;
          const icon: BoneIconKind = targets.has(row.id)
            ? 'target'
            : bone.length === 0
              ? 'point'
              : bone.parentId === null
                ? 'root'
                : 'bone';
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
              className={`flex cursor-default items-center gap-1.5 rounded py-0.5 pr-2 text-sm ${
                isSelected
                  ? 'bg-sky-600/30 text-sky-100 ring-1 ring-sky-500/40'
                  : isDragOver
                    ? 'bg-neutral-700/60 ring-1 ring-sky-500/60'
                    : 'text-neutral-300 hover:bg-neutral-800'
              }`}
            >
              <BoneIcon kind={icon} color={bone.color ?? 0x64db85} />
              <span className="truncate">{row.name}</span>
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
        {slots.length > 0 && (
          <p className="px-2 pb-1 text-[10px] text-neutral-400">
            Back → front · drag slots to reorder{mode === 'animate' && ' · auto-key'}
          </p>
        )}
        {slots.length > 0 &&
          (() => {
            const at = slots.findIndex((s) => s.id === selectedSlot);
            return (
              <div className="mb-1 flex flex-wrap gap-1 px-2" role="group" aria-label="Slot draw order">
                {(
                  [
                    ['Send to back', 0],
                    ['Move backward', at - 1],
                    ['Move forward', at + 1],
                    ['Bring to front', slots.length - 1],
                  ] as const
                ).map(([label, to]) => (
                  <button
                    key={label}
                    className="rounded bg-neutral-800 px-1.5 py-1 text-[10px] hover:bg-neutral-700 disabled:opacity-30"
                    disabled={at < 0 || at === to || to < 0 || to >= slots.length}
                    onClick={() => {
                      if (selectedSlot) reorderSlot(selectedSlot, to);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            );
          })()}
        {slots.map((slot, i) => {
          const isSlotSel = slot.id === selectedSlot;
          return (
            <div
              key={slot.id}
              data-testid="slot-row"
              data-slot-id={slot.id}
              draggable
              onDragStart={(e) => {
                e.stopPropagation();
                engine.pause();
                useEditorStore.getState().setPlaying(false);
                draggedSlotRef.current = slot.id;
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('application/x-bbb-slot', slot.id);
                selectSlot(slot.id);
              }}
              onDragEnd={() => {
                draggedSlotRef.current = null;
                setSlotDrop(null);
              }}
              onDragOver={(e) => {
                e.stopPropagation();
                if (draggedSlotRef.current && draggedSlotRef.current !== slot.id) {
                  e.preventDefault();
                  setSlotDrop({
                    id: slot.id,
                    after:
                      e.clientY >=
                      e.currentTarget.getBoundingClientRect().top + e.currentTarget.clientHeight / 2,
                  });
                }
              }}
              onDragLeave={() => setSlotDrop((cur) => (cur?.id === slot.id ? null : cur))}
              onDrop={(e) => {
                e.stopPropagation();
                e.preventDefault();
                const id = draggedSlotRef.current;
                if (id && id !== slot.id) {
                  const remaining = slots.filter((s) => s.id !== id);
                  const after =
                    e.clientY >=
                    e.currentTarget.getBoundingClientRect().top + e.currentTarget.clientHeight / 2;
                  reorderSlot(id, remaining.findIndex((s) => s.id === slot.id) + (after ? 1 : 0));
                }
                draggedSlotRef.current = null;
                setSlotDrop(null);
              }}
              style={
                slotDrop?.id === slot.id
                  ? { boxShadow: `inset 0 ${slotDrop.after ? '-2' : '2'}px #ffbe45` }
                  : undefined
              }
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
                    reorderSlot(slot.id, i - 1);
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
                    reorderSlot(slot.id, i + 1);
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
        {(data.pathConstraints ?? []).map((c) => (
          <div
            key={c.id}
            onClick={() => select(c.bones[0]!)}
            className="cursor-default rounded py-0.5 pl-2 pr-1 text-sm text-teal-300"
            title={`Path follow (order ${c.order})`}
          >
            {boneName.get(c.bones[0]!)} ⇢ {data.paths?.find((p) => p.id === c.pathId)?.name}
          </div>
        ))}
        {(data.secondaryConstraints ?? []).map((c) => (
          <div
            key={c.id}
            onClick={() => select(c.boneId)}
            className="cursor-default rounded py-0.5 pl-2 pr-1 text-sm text-violet-300"
            title={`Secondary motion (order ${c.order})`}
          >
            {boneName.get(c.boneId)} · {c.preset} motion
          </div>
        ))}
        <RigHelperPanel />
        <MarkerPanel />
      </div>
    </div>
  );
}
