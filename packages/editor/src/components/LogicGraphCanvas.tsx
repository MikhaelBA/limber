import { useState, useRef, type PointerEvent } from 'react';
import type { LogicGraph, LogicSnapshot } from '@limber/core';
import type { LogicEdit } from '../commands/logicCommands';
interface Props {
  graph: LogicGraph;
  snapshot: LogicSnapshot | null;
  selected: string | null;
  onSelect: (id: string) => void;
  onEdit: (edit: LogicEdit) => boolean;
}
const width = 180,
  height = 66;
export function LogicGraphCanvas({ graph, snapshot, selected, onSelect, onEdit }: Props) {
  const [draft, setDraft] = useState<{ id: string; x: number; y: number } | null>(null);
  const latestDraft = useRef<typeof draft>(null);
  const drag = useRef<{
    id: string;
    startX: number;
    startY: number;
    x: number;
    y: number;
    pointer: number;
  } | null>(null);
  const position = (id: string) => {
    if (draft?.id === id) return draft;
    const i = graph.states.findIndex((s) => s.id === id);
    return graph.states[i]?.position ?? { x: 30 + (i % 4) * 230, y: 100 + Math.floor(i / 4) * 120 };
  };
  const stored = graph.states.map(
    (state, i) => state.position ?? { x: 30 + (i % 4) * 230, y: 100 + Math.floor(i / 4) * 120 },
  );
  const origin = {
    x: Math.min(0, ...stored.map((p) => p.x)) - 30,
    y: Math.min(0, ...stored.map((p) => p.y)) - 100,
  };
  const displayPosition = (id: string) => {
    const p = position(id);
    return { x: p.x - origin.x, y: p.y - origin.y };
  };
  const cancel = () => {
    drag.current = null;
    latestDraft.current = null;
    setDraft(null);
  };
  const down = (event: PointerEvent<HTMLButtonElement>, id: string) => {
    if (event.button !== 0) return;
    const p = position(id);
    onSelect(id);
    drag.current = {
      id,
      startX: event.clientX,
      startY: event.clientY,
      x: p.x,
      y: p.y,
      pointer: event.pointerId,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (d && d.pointer === event.pointerId) {
      latestDraft.current = {
        id: d.id,
        x: d.x + event.clientX - d.startX,
        y: d.y + event.clientY - d.startY,
      };
      setDraft(latestDraft.current);
    }
  };
  const up = () => {
    const d = drag.current;
    const final = latestDraft.current;
    if (d && final && (final.x !== d.x || final.y !== d.y))
      onEdit({ kind: 'state', id: d.id, patch: { position: { x: final.x, y: final.y } } });
    cancel();
  };
  const positions = graph.states.map((s) => displayPosition(s.id));
  return (
    <div
      className="min-h-0 flex-1 overflow-auto bg-neutral-950"
      aria-label="State graph"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          cancel();
        }
      }}
    >
      <div
        className="relative"
        style={{
          width: Math.max(1000, ...positions.map((p) => p.x + 240)),
          height: Math.max(400, ...positions.map((p) => p.y + 160)),
        }}
      >
        <div className="absolute left-8 top-4 rounded border border-amber-600 px-4 py-2 text-xs">
          Any State
        </div>
        <svg className="absolute inset-0 h-full w-full" aria-label="Transitions">
          <defs>
            <marker id="logic-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8" fill="#94a3b8" />
            </marker>
          </defs>
          {graph.transitions.map((edge, i) => {
            const from = edge.from === null ? { x: 30, y: 0 } : displayPosition(edge.from),
              to = displayPosition(edge.to),
              x1 = from.x + width / 2,
              y1 = edge.from === null ? 55 : from.y + height,
              x2 = to.x + width / 2,
              y2 = to.y;
            return (
              <g
                key={edge.id}
                role="button"
                tabIndex={0}
                aria-label={`Transition ${edge.id}: ${edge.from === null ? 'Any State' : graph.states.find((s) => s.id === edge.from)!.name} to ${graph.states.find((s) => s.id === edge.to)!.name}`}
                onClick={() => onSelect(edge.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    event.stopPropagation();
                    onSelect(edge.id);
                  }
                }}
              >
                <path
                  d={`M${x1},${y1} C${x1},${y1 + 35 + i * 8} ${x2},${y2 - 35 - i * 8} ${x2},${y2}`}
                  fill="none"
                  stroke={
                    selected === edge.id || snapshot?.transition?.id === edge.id ? '#38bdf8' : '#94a3b8'
                  }
                  strokeWidth="2"
                  markerEnd="url(#logic-arrow)"
                />
                <text x={(x1 + x2) / 2 + 8} y={(y1 + y2) / 2 + i * 8} fill="#cbd5e1" fontSize="12">
                  {edge.priority} · {edge.blendDuration}s
                </text>
              </g>
            );
          })}
        </svg>
        {graph.states.map((state) => {
          const p = displayPosition(state.id);
          return (
            <button
              key={state.id}
              aria-label={`State ${state.name}`}
              aria-pressed={selected === state.id}
              className={`absolute rounded-lg border px-3 py-2 text-left text-xs focus:outline-2 focus:outline-sky-400 ${snapshot?.stateId === state.id ? 'border-emerald-400 bg-emerald-950' : selected === state.id ? 'border-sky-400 bg-sky-950' : 'border-neutral-600 bg-neutral-800'}`}
              style={{ left: p.x, top: p.y, width, height, touchAction: 'none' }}
              onPointerDown={(event) => down(event, state.id)}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={cancel}
              onClick={() => onSelect(state.id)}
            >
              <strong>
                {state.id === graph.entryStateId ? '▶ ' : ''}
                {state.name}
              </strong>
              <div className="mt-1 text-neutral-300">
                {state.clip ?? 'Setup'} · {state.loop ? 'Loop' : 'Once'}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
