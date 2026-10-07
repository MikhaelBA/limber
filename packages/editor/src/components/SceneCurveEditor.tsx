import { useEffect, useRef, useState } from 'react';
import type { Curve } from '@limber/core';

/** Handles edit the selected key's outgoing curve; no second curve model is stored. */
export function SceneCurveEditor({ curve, onCommit }: { curve: Curve; onCommit: (curve: Curve) => void }) {
  const [draft, setDraft] = useState<Curve | null>(null),
    drag = useRef<1 | 2 | null>(null);
  const value = draft ?? curve;
  const clear = () => {
    drag.current = null;
    setDraft(null);
  };
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        drag.current = null;
        setDraft(null);
      }
    };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, []);
  const x1 = 20 + 160 * (value.c1 ?? 0.42),
    y1 = 80 - 60 * (value.c2 ?? 0),
    x2 = 20 + 160 * (value.c3 ?? 0.58),
    y2 = 80 - 60 * (value.c4 ?? 1);
  return (
    <svg
      viewBox="0 0 200 100"
      preserveAspectRatio="none"
      className="h-24 w-full touch-none"
      aria-label="Bezier curve handles"
      onPointerMove={(event) => {
        if (!drag.current) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (((event.clientX - rect.left) / rect.width) * 200 - 20) / 160)),
          y = (80 - ((event.clientY - rect.top) / rect.height) * 100) / 60;
        setDraft({ ...curve, ...(drag.current === 1 ? { c1: x, c2: y } : { c3: x, c4: y }) });
      }}
      onPointerUp={(event) => {
        if (drag.current && draft) onCommit(draft);
        clear();
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={clear}
    >
      <path d="M20 80 H180 M20 80 V20" stroke="#667085" fill="none" />
      <path d={`M20 80 L${x1} ${y1} M180 20 L${x2} ${y2}`} stroke="#667085" fill="none" />
      <path d={`M20 80 C${x1} ${y1} ${x2} ${y2} 180 20`} stroke="#f7c85b" strokeWidth="2" fill="none" />
      {([1, 2] as const).map((id) => (
        <circle
          key={id}
          cx={id === 1 ? x1 : x2}
          cy={id === 1 ? y1 : y2}
          r="6"
          fill="#8b7cff"
          aria-label={`Bezier handle ${id}`}
          onPointerDown={(event) => {
            drag.current = id;
            setDraft(curve);
            event.currentTarget.ownerSVGElement!.setPointerCapture(event.pointerId);
            event.preventDefault();
          }}
        />
      ))}
    </svg>
  );
}
