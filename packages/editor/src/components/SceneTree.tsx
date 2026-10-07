import { useMemo, useState } from 'react';
import { evaluateScene, type Artboard } from '@limber/core';

/** Windowed rows keep hierarchy DOM size bounded even for imported 10000-node scenes. */
export function SceneTree({
  artboard,
  revision,
  selected,
  onSelect,
}: {
  artboard: Artboard;
  revision: number;
  selected: string[];
  onSelect: (id: string, add: boolean) => void;
}) {
  const rows = useMemo(() => evaluateScene(artboard), [artboard, revision]);
  const [scroll, setScroll] = useState(0);
  const start = Math.min(Math.max(0, rows.length - 1), Math.max(0, Math.floor(scroll / 28) - 5));
  const count = 60;
  return (
    <div
      className="min-h-0 flex-1 overflow-auto"
      aria-label="Scene tree"
      onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
    >
      <div style={{ height: rows.length * 28, position: 'relative' }}>
        {rows.slice(start, start + count).map(({ node, depth }, index) => (
          <button
            key={node.id}
            aria-pressed={selected.includes(node.id)}
            className={`absolute block w-full truncate rounded text-left text-sm ${selected.includes(node.id) ? 'bg-violet-800' : 'hover:bg-neutral-800'}`}
            style={{ height: 28, top: (start + index) * 28, paddingLeft: 8 + Math.min(depth, 12) * 12 }}
            onClick={(e) => onSelect(node.id, e.shiftKey)}
          >
            {node.visible ? '' : '◌ '}
            {node.name} <span className="text-xs text-neutral-400">{node.type}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
