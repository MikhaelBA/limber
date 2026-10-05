import { useEffect, useRef, useState } from 'react';
import type { Animation, Timeline } from '@limber/core';
import {
  AddAnimationCommand,
  DeleteKeyframeCommand,
  KeyBoneTransformCommand,
  MoveKeyframeCommand,
  RemoveAnimationCommand,
  SetAnimationMetaCommand,
  type BonePropertyName,
} from '../commands/animationCommands';
import { useEngine } from '../hooks/useEngine';
import { useEditorStore } from '../store/editorStore';

const PPS = 100; // Pixels per second.
const ROW_H = 24;
const PROP_ROW_H = 20;
const SNAP_FPS = 30;

const PROPERTIES: { id: BonePropertyName; label: string }[] = [
  { id: 'x', label: 'x' },
  { id: 'y', label: 'y' },
  { id: 'rotation', label: 'rot' },
  { id: 'scaleX', label: 'sx' },
  { id: 'scaleY', label: 'sy' },
  { id: 'shearX', label: 'shx' },
  { id: 'shearY', label: 'shy' },
];

type BoneTimeline = Extract<Timeline, { kind: 'boneProperty' }>;

const isBoneTimelineOf = (tl: Timeline, boneId: string): tl is BoneTimeline =>
  tl.kind === 'boneProperty' && tl.boneId === boneId;

const snap = (t: number): number => Math.round(t * SNAP_FPS) / SNAP_FPS;
const fmtTime = (t: number): string => `${t.toFixed(2)}s`;

export function TimelinePanel() {
  const engine = useEngine();
  useEditorStore((s) => s.dataRevision); // Re-read engine data on undo/redo/commands.
  const selectedBoneId = useEditorStore((s) => s.selectedBoneId);
  const selectedKeyframe = useEditorStore((s) => s.selectedKeyframe);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const mode = useEditorStore((s) => s.mode);
  const execute = useEditorStore((s) => s.execute);
  const select = useEditorStore((s) => s.select);
  const setKeyframeSelection = useEditorStore((s) => s.setKeyframeSelection);
  const setStatus = useEditorStore((s) => s.setStatus);
  const setPlaying = useEditorStore((s) => s.setPlaying);
  const touch = useEditorStore((s) => s.touch);

  const scrollRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const timeLabelRef = useRef<HTMLSpanElement>(null);

  const animations = engine.document.animations;
  const active = engine.currentAnimation;
  const duration = active?.duration ?? 1;
  const contentWidth = duration * PPS + 40;

  // Transient playhead (DESIGN.md §5.4): the clock streams at frame rate
  // straight into DOM mutations — no React re-render per frame.
  useEffect(() => {
    return engine.onTransient('time', (t) => {
      if (playheadRef.current) playheadRef.current.style.transform = `translateX(${t * PPS}px)`;
      if (timeLabelRef.current) timeLabelRef.current.textContent = fmtTime(t);
    });
  }, [engine]);

  const togglePlay = () => {
    if (!active) return;
    if (engine.playing) {
      engine.pause();
      setPlaying(false);
      touch(); // Panels re-read the paused pose.
    } else {
      engine.play();
      setPlaying(true);
    }
  };

  const onStop = () => {
    engine.stop();
    setPlaying(false);
    touch();
  };

  const onNewAnimation = () => {
    const cmd = new AddAnimationCommand(engine);
    execute(cmd);
    engine.setAnimation(cmd.name);
    setStatus(`Animation "${cmd.name}" created`);
  };

  const onDeleteAnimation = () => {
    if (!active) return;
    execute(new RemoveAnimationCommand(engine, active.name));
  };

  const onKeyTransform = () => {
    if (!selectedBoneId || !active) return;
    execute(new KeyBoneTransformCommand(engine, selectedBoneId));
  };

  // ---- Ruler scrubbing ----
  const scrubbingRef = useRef(false);
  const scrubFromEvent = (e: React.PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    engine.scrub(Math.min(Math.max((e.clientX - rect.left) / PPS, 0), duration));
  };

  // ---- Keyframe dragging ----
  const dragKfRef = useRef<{ boneId: string; property: BonePropertyName; fromTime: number; moved: boolean } | null>(null);
  const [dragPreview, setDragPreview] = useState<{ property: BonePropertyName; fromTime: number; dx: number } | null>(null);

  const onKfPointerDown = (e: React.PointerEvent, boneId: string, property: BonePropertyName, time: number) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragKfRef.current = { boneId, property, fromTime: time, moved: false };
    setDragPreview({ property, fromTime: time, dx: 0 });
    setKeyframeSelection({ boneId, property, time });
    select(boneId);
  };

  const onKfPointerMove = (e: React.PointerEvent) => {
    const drag = dragKfRef.current;
    if (!drag) return;
    const dx = e.movementX;
    if (Math.abs(dx) < 0.01) return;
    drag.moved = true;
    setDragPreview((p) => (p ? { ...p, dx: p.dx + dx } : p));
  };

  const onKfPointerUp = () => {
    const drag = dragKfRef.current;
    dragKfRef.current = null;
    setDragPreview(null);
    if (!drag || !drag.moved || !active) return;
    // The preview accumulated screen delta — recover the target time from the
    // final preview offset so the command is exact.
    const toTime = snap(
      Math.min(Math.max(drag.fromTime + dragPreviewFinalRef.current / PPS, 0), active.duration),
    );
    if (Math.abs(toTime - drag.fromTime) > 1e-6) {
      execute(new MoveKeyframeCommand(engine, drag.boneId, drag.property, drag.fromTime, toTime));
      setKeyframeSelection({ boneId: drag.boneId, property: drag.property, time: toTime });
    }
  };
  const dragPreviewFinalRef = useRef(0);
  useEffect(() => {
    dragPreviewFinalRef.current = dragPreview?.dx ?? 0;
  }, [dragPreview]);

  const onRowClick = (boneId: string) => {
    select(boneId);
  };

  // Bone rows mirror the hierarchy (bones are topologically sorted).
  const bones = engine.skeleton.data.bones;
  const depthById = new Map<string, number>();
  for (const bone of bones) {
    depthById.set(bone.id, bone.parentId === null ? 0 : (depthById.get(bone.parentId) ?? 0) + 1);
  }

  const hasAnim = animations.length > 0;

  return (
    <section className="flex h-full flex-col bg-neutral-900">
      {/* Transport + animation management */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-neutral-800 px-2 py-1">
        <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Timeline</span>

        <select
          className="rounded bg-neutral-800 px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-sky-500"
          value={engine.activeAnimationName ?? ''}
          onChange={(e) => {
            engine.setAnimation(e.target.value || null);
            setPlaying(false);
          }}
          disabled={!hasAnim}
        >
          {!hasAnim && <option value="">no animations</option>}
          {animations.map((a) => (
            <option key={a.name} value={a.name}>
              {a.name}
            </option>
          ))}
        </select>
        <button className="rounded px-1.5 text-sm text-neutral-300 hover:bg-neutral-800" title="New animation" onClick={onNewAnimation}>
          ＋
        </button>
        <button
          className="rounded px-1.5 text-sm text-neutral-300 hover:bg-neutral-800 disabled:opacity-35"
          title="Delete current animation"
          disabled={!active}
          onClick={onDeleteAnimation}
        >
          🗑
        </button>

        <div className="mx-1 h-4 w-px bg-neutral-700" />

        <button
          className="rounded px-2 text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-35"
          title="Play/Pause (Space)"
          disabled={!active}
          onClick={togglePlay}
        >
          {isPlaying ? '⏸' : '▶'}
        </button>
        <button
          className="rounded px-2 text-sm text-neutral-300 hover:bg-neutral-800 disabled:opacity-35"
          title="Stop (back to 0)"
          disabled={!active}
          onClick={onStop}
        >
          ⏹
        </button>
        <span ref={timeLabelRef} className="w-14 text-xs tabular-nums text-neutral-400">
          0.00s
        </span>

        <div className="mx-1 h-4 w-px bg-neutral-700" />

        <button
          className="rounded px-2 text-xs text-neutral-200 ring-1 ring-neutral-700 hover:bg-neutral-800 disabled:opacity-35"
          title="Key all transform properties of the selected bone at the playhead"
          disabled={!selectedBoneId || !active || mode !== 'animate'}
          onClick={onKeyTransform}
        >
          ◆ Key
        </button>
        {active && (
          <>
            <label className="ml-1 flex items-center gap-1 text-xs text-neutral-400">
              dur
              <input
                type="number"
                step={0.1}
                min={0.1}
                defaultValue={active.duration}
                key={`dur-${active.name}-${active.duration}`}
                className="w-14 rounded bg-neutral-800 px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-sky-500"
                onBlur={(e) => {
                  const v = parseFloat(e.target.value);
                  if (Number.isFinite(v) && v > 0 && v !== active.duration) {
                    execute(new SetAnimationMetaCommand(engine, active.name, { duration: v }));
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
              />
            </label>
            <label className="flex items-center gap-1 text-xs text-neutral-400">
              <input
                type="checkbox"
                checked={active.loop}
                onChange={(e) => execute(new SetAnimationMetaCommand(engine, active.name, { loop: e.target.checked }))}
              />
              loop
            </label>
          </>
        )}
        {!hasAnim && <span className="text-xs text-neutral-500">Create an animation to start keyframing</span>}
      </div>

      {/* Dopesheet */}
      <div className="flex min-h-0 flex-1">
        {/* Track names */}
        <div className="w-44 shrink-0 overflow-y-auto border-r border-neutral-800">
          <div className="h-6 border-b border-neutral-800" />
          {bones.map((bone) => {
            const depth = depthById.get(bone.id) ?? 0;
            const isSel = bone.id === selectedBoneId;
            const expanded = isSel;
            return (
              <div key={bone.id}>
                <div
                  onClick={() => onRowClick(bone.id)}
                  style={{ paddingLeft: depth * 12 + 6, height: ROW_H }}
                  className={`flex cursor-default items-center gap-1 text-sm ${
                    isSel ? 'bg-sky-600/25 text-sky-100' : 'text-neutral-300 hover:bg-neutral-800'
                  }`}
                >
                  {expanded ? '▾' : '▸'} {bone.name}
                </div>
                {expanded &&
                  PROPERTIES.map((p) => (
                    <div
                      key={p.id}
                      style={{ height: PROP_ROW_H, paddingLeft: depth * 12 + 26 }}
                      className="flex items-center text-[11px] text-neutral-500"
                    >
                      {p.label}
                    </div>
                  ))}
              </div>
            );
          })}
        </div>

        {/* Time area */}
        <div
          ref={scrollRef}
          className="relative flex-1 overflow-auto"
          onPointerDown={(e) => {
            // Clicking empty dopesheet space clears keyframe selection.
            if (e.target === e.currentTarget) setKeyframeSelection(null);
          }}
        >
          <div style={{ width: contentWidth }} className="relative">
            {/* Ruler */}
            <div
              className="sticky top-0 z-10 h-6 cursor-ew-resize border-b border-neutral-800 bg-neutral-900"
              onPointerDown={(e) => {
                scrubbingRef.current = true;
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                engine.pause();
                setPlaying(false);
                scrubFromEvent(e);
              }}
              onPointerMove={(e) => {
                if (scrubbingRef.current) scrubFromEvent(e);
              }}
              onPointerUp={() => {
                if (scrubbingRef.current) {
                  scrubbingRef.current = false;
                  touch(); // Properties panel shows the scrubbed pose.
                }
              }}
            >
              {Array.from({ length: Math.floor(duration * 10) + 1 }, (_, i) => i / 10).map((t) => {
                const major = Math.abs(t * 10 - Math.round(t * 10)) < 1e-9 && Math.round(t * 10) % 5 === 0;
                return (
                  <div
                    key={t}
                    className="absolute bottom-0 border-l border-neutral-700"
                    style={{ left: t * PPS, height: major ? 10 : 5 }}
                  >
                    {major && <span className="absolute -top-0.5 left-1 text-[10px] text-neutral-500">{t}s</span>}
                  </div>
                );
              })}
            </div>

            {/* Rows */}
            {bones.map((bone) => {
              const expanded = bone.id === selectedBoneId;
              const boneTimelines = (active?.timelines ?? []).filter((tl) => isBoneTimelineOf(tl, bone.id));
              return (
                <div key={bone.id}>
                  <div
                    style={{ height: ROW_H }}
                    className="relative border-b border-neutral-800/50"
                    onClick={() => onRowClick(bone.id)}
                  >
                    {boneTimelines.length > 0 &&
                      boneTimelines.some((tl) => tl.keyframes.length > 0) &&
                      // Ghost diamonds: merged keys of all properties.
                      Array.from(new Set(boneTimelines.flatMap((tl) => tl.keyframes.map((k) => k.time)))).map((t) => (
                        <div
                          key={t}
                          className="absolute top-1/2 h-2 w-2 -translate-y-1/2 rotate-45 border border-sky-500/60 bg-neutral-700"
                          style={{ left: t * PPS - 4 }}
                        />
                      ))}
                  </div>
                  {expanded &&
                    PROPERTIES.map((p) => {
                      const tl = boneTimelines.find((x) => x.property === p.id);
                      const kfs = tl?.keyframes ?? [];
                      return (
                        <div
                          key={p.id}
                          style={{ height: PROP_ROW_H }}
                          className="relative border-b border-neutral-800/30 bg-neutral-900/40"
                        >
                          {kfs.map((kf) => {
                            const isSelKf =
                              selectedKeyframe?.boneId === bone.id &&
                              selectedKeyframe.property === p.id &&
                              Math.abs(selectedKeyframe.time - kf.time) < 1e-6;
                            const isDragging =
                              dragPreview?.property === p.id && Math.abs(dragPreview.fromTime - kf.time) < 1e-6;
                            const left = kf.time * PPS - 4 + (isDragging ? dragPreview.dx : 0);
                            return (
                              <div
                                key={kf.time}
                                className={`absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rotate-45 cursor-ew-resize ${
                                  isSelKf ? 'bg-sky-400' : 'bg-sky-600 hover:bg-sky-500'
                                }`}
                                style={{ left }}
                                onPointerDown={(e) => onKfPointerDown(e, bone.id, p.id, kf.time)}
                                onPointerMove={onKfPointerMove}
                                onPointerUp={onKfPointerUp}
                                title={`${p.label} @ ${fmtTime(kf.time)} = ${Math.round(kf.value * 1000) / 1000}`}
                              />
                            );
                          })}
                        </div>
                      );
                    })}
                </div>
              );
            })}

            {/* Playhead — transient, never re-renders React */}
            <div className="pointer-events-none absolute inset-y-0 left-0 z-20 w-full">
              <div ref={playheadRef} className="absolute inset-y-0 w-px bg-sky-400" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
