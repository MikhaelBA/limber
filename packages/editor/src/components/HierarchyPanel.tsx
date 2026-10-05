import { useRef, useState } from 'react';
import { wouldCreateCycle } from '../commands/boneCommands';
import { useEngine } from '../hooks/useEngine';
import { useEditorStore } from '../store/editorStore';
import {
  AddBoneCommand,
  RemoveBoneCommand,
  ReparentBoneCommand,
} from '../commands/boneCommands';

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
  const select = useEditorStore((s) => s.select);
  const execute = useEditorStore((s) => s.execute);
  const setStatus = useEditorStore((s) => s.setStatus);

  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const draggedIdRef = useRef<string | null>(null);

  const data = engine.skeleton.data;

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
    execute(new RemoveBoneCommand(engine, selected));
  };

  const reparent = (boneId: string, newParentId: string | null) => {
    if (newParentId === boneId) return;
    if (newParentId !== null && wouldCreateCycle(data, boneId, newParentId)) {
      setStatus('Cannot reparent a bone under its own descendant.');
      return;
    }
    execute(new ReparentBoneCommand(engine, boneId, newParentId));
  };

  const isDropTarget = (targetId: string) => {
    const dragged = draggedIdRef.current;
    return dragged !== null && dragged !== targetId && !wouldCreateCycle(data, dragged, targetId);
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
      </div>
    </div>
  );
}
