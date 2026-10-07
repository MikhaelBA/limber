import { sceneSubtreeIds } from '../commands/sceneCommands';
import { SceneCurveEditor } from './SceneCurveEditor';
import { useEffect, useRef, useState } from 'react';
import {
  SCENE_PROPERTIES,
  findKeyframeIndex,
  interpolateNumber,
  uuid,
  type Artboard,
  type BoneByBoneProject,
  type Curve,
  type SceneProperty,
} from '@limber/core';
import type { SceneMotionSession } from '../engine/SceneMotionSession';
import { EditSceneMotionCommand, type SceneMotionEdit } from '../commands/sceneMotionCommands';
import type { Command } from '../history/history';

const button =
  'rounded border border-neutral-600 px-2 py-0.5 text-xs hover:bg-neutral-700 disabled:opacity-40';
const input = 'rounded border border-neutral-600 bg-neutral-900 px-1 text-xs';
interface Props {
  project: BoneByBoneProject;
  artboard: Artboard;
  revision: number;
  session: SceneMotionSession;
  selectedNodes: string[];
  run: (command: Command) => boolean;
  onKey: (property: SceneProperty, value?: number) => void;
}

export function SceneTimeline({ project, artboard, revision, session, selectedNodes, run, onKey }: Props) {
  const [, refresh] = useState(0);
  useEffect(() => session.subscribe(() => refresh((n) => n + 1)), [session]);
  const [property, setProperty] = useState<SceneProperty>('x'),
    [filter, setFilter] = useState(''),
    [keyIds, setKeyIds] = useState<string[]>([]),
    [zoom, setZoom] = useState(180),
    [eventName, setEventName] = useState('event');
  const time = useRef<HTMLInputElement>(null),
    playhead = useRef<HTMLDivElement>(null),
    events = useRef<HTMLOutputElement>(null),
    area = useRef<HTMLDivElement>(null);
  const clip = session.clip;
  const rows = clip
    ? [
        ...clip.tracks
          .filter((track) =>
            `${artboard.nodes.find((n) => n.id === track.nodeId)?.name} ${track.property}`
              .toLowerCase()
              .includes(filter.toLowerCase()),
          )
          .map((track) => ({
            id: track.id,
            label: `${artboard.nodes.find((n) => n.id === track.nodeId)?.name ?? track.nodeId} · ${track.property}`,
            keys: track.keys,
          })),
        { id: 'events', label: 'Events', keys: clip.events },
      ]
    : [];
  const allKeys = clip ? [...clip.tracks.flatMap((track) => track.keys), ...clip.events] : [];
  const overviewNodes = sceneSubtreeIds(
    artboard.nodes,
    selectedNodes.length ? selectedNodes : artboard.nodes.map((node) => node.id),
  );
  const overviewKeys =
    clip?.tracks.filter((track) => overviewNodes.has(track.nodeId)).flatMap((track) => track.keys) ?? [];
  const overviewTimes = [...new Set(overviewKeys.map((key) => key.time))].sort((a, b) => a - b);
  const selected = keyIds.filter((id) => allKeys.some((key) => key.id === id));
  const selectedKey = clip?.tracks.flatMap((track) => track.keys).find((key) => selected.includes(key.id));
  const graphTrack = clip?.tracks.find((track) => track.keys.some((key) => selected.includes(key.id)));
  const curve = selectedKey?.curve;
  const width = Math.max(500, (clip?.duration ?? 1) * zoom + 30);
  const edit = (intent: SceneMotionEdit) => {
    const ok = run(new EditSceneMotionCommand(project, artboard.id, intent));
    if (ok) session.refresh();
    return ok;
  };
  const mutateKeys = (scale: number, offset: number, duplicate = false) => {
    if (!clip || !selected.length) return;
    const origin = Math.min(...allKeys.filter((key) => selected.includes(key.id)).map((key) => key.time));
    const duplicateIds = duplicate ? Object.fromEntries(selected.map((id) => [id, uuid()])) : undefined;
    const ok = edit({
      kind: 'keys',
      clipId: clip.id,
      keyIds: selected,
      origin,
      scale,
      offset,
      ...(duplicateIds ? { duplicateIds } : {}),
    });
    if (ok && duplicateIds) setKeyIds(Object.values(duplicateIds));
  };
  useEffect(() => {
    const update = () => {
      if (time.current) time.current.value = session.time.toFixed(3);
      if (playhead.current) playhead.current.style.left = `${session.time * zoom + 12}px`;
      if (events.current)
        events.current.textContent = session.recentEvents.map((event) => event.name).join(' · ');
    };
    update();
    return session.onFrame(update);
  }, [session, zoom, revision, clip]);
  const drag = useRef<{ start: number; ids: string[]; offset: number; clickedId: string } | null>(null);
  const box = useRef<{ x: number; y: number; add: boolean } | null>(null);
  const [rectangle, setRectangle] = useState<{ x: number; y: number; width: number; height: number } | null>(
    null,
  );
  const point = (event: React.PointerEvent) => {
    const rect = area.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      drag.current = null;
      box.current = null;
      setRectangle(null);
      for (const element of area.current?.querySelectorAll<HTMLElement>('[data-key-id]') ?? [])
        element.style.transform = '';
    };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, []);
  const graph = () => {
    if (!graphTrack || !clip || !graphTrack.keys.length) return null;
    const node = artboard.nodes.find((node) => node.id === graphTrack.nodeId)!;
    const setup = graphTrack.property === 'opacity' ? node.opacity : node.transform[graphTrack.property];
    const values = Array.from({ length: 101 }, (_, i) => {
      const time = (i * clip.duration) / 100,
        index = findKeyframeIndex(graphTrack.keys, time);
      return time < graphTrack.keys[0]!.time
        ? setup
        : interpolateNumber(graphTrack.keys[index]!, graphTrack.keys[index + 1] ?? null, time);
    });
    const lo = Math.min(...values),
      hi = Math.max(...values),
      span = Math.max(1, hi - lo);
    const points = values.map((value, i) => `${i * 2},${85 - ((value - lo) / span) * 65}`).join(' ');
    return (
      <svg viewBox="0 0 200 100" className="h-24 w-full" aria-label="Scene value graph">
        <path d="M0 85 H200 M0 10 V90" stroke="#667085" />
        <polyline points={points} fill="none" stroke="#f7c85b" strokeWidth="2" />
      </svg>
    );
  };
  return (
    <section
      className="flex h-72 shrink-0 flex-col border-t border-neutral-600 bg-neutral-950"
      aria-label="Scene timeline"
    >
      <div className="flex flex-wrap items-center gap-1 border-b border-neutral-700 p-1">
        <select
          aria-label="Scene clip"
          className={input}
          value={clip?.id ?? ''}
          onChange={(e) => {
            setKeyIds([]);
            session.select(e.target.value);
          }}
        >
          <option value="" disabled>
            Select clip
          </option>
          {(artboard.clips ?? []).map((clip) => (
            <option key={clip.id} value={clip.id}>
              {clip.name}
            </option>
          ))}
        </select>
        <button
          className={button}
          onClick={() => {
            const clip = {
              id: uuid(),
              name: `Clip ${(artboard.clips?.length ?? 0) + 1}`,
              duration: 2,
              loop: true,
              fps: 30,
              tracks: [],
              events: [],
            };
            if (edit({ kind: 'add', clip })) session.select(clip.id);
          }}
        >
          New clip
        </button>
        <button
          className={button}
          disabled={!clip}
          onClick={() => {
            if (clip) edit({ kind: 'remove', clipId: clip.id });
          }}
        >
          Delete clip
        </button>
        <button className={button} aria-pressed={!session.enabled} onClick={() => session.setEnabled(false)}>
          Setup
        </button>
        <button
          className={button}
          disabled={!clip}
          aria-pressed={session.enabled}
          onClick={() => session.setEnabled(true)}
        >
          Animate scene
        </button>
        <label className="text-xs">
          <input
            type="checkbox"
            checked={session.autoKey}
            onChange={(e) => session.setAutoKey(e.target.checked)}
          />{' '}
          Auto-key
        </label>
        <button
          className={button}
          disabled={!clip}
          onClick={() => (session.playing ? session.pause() : session.play())}
        >
          {session.playing ? 'Pause scene' : 'Play scene'}
        </button>
        {clip && (
          <input
            aria-label="Scene clip name"
            className={`${input} w-24`}
            key={`${clip.id}-${clip.name}`}
            defaultValue={clip.name}
            onBlur={(e) => {
              if (e.target.value !== clip.name)
                edit({ kind: 'metadata', clipId: clip.id, patch: { name: e.target.value } });
            }}
          />
        )}
        <button className={button} disabled={!clip} onClick={() => session.stop()}>
          Stop scene
        </button>
        <input
          ref={time}
          aria-label="Scene time"
          className={`${input} w-16`}
          type="number"
          min="0"
          max={clip?.duration ?? 0}
          step={1 / (clip?.fps ?? 30)}
          defaultValue={session.time}
          onChange={(e) => {
            if (Number.isFinite(e.target.valueAsNumber)) session.scrub(e.target.valueAsNumber);
          }}
        />
        {clip && (
          <>
            <label className="text-xs">
              Duration{' '}
              <input
                aria-label="Scene duration"
                className={`${input} w-12`}
                type="number"
                min="0.1"
                step="0.1"
                key={`${clip.id}-${clip.duration}`}
                defaultValue={clip.duration}
                onBlur={(e) => {
                  if (e.target.valueAsNumber !== clip.duration)
                    edit({ kind: 'metadata', clipId: clip.id, patch: { duration: e.target.valueAsNumber } });
                }}
              />
            </label>
            <label className="text-xs">
              <input
                type="checkbox"
                checked={clip.loop}
                onChange={(e) =>
                  edit({ kind: 'metadata', clipId: clip.id, patch: { loop: e.target.checked } })
                }
              />{' '}
              Loop
            </label>
          </>
        )}
        <select
          aria-label="Scene key property"
          className={input}
          value={property}
          onChange={(e) => setProperty(e.target.value as SceneProperty)}
        >
          {SCENE_PROPERTIES.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <button
          className={button}
          disabled={!clip || !session.enabled || !selectedNodes.length}
          onClick={() => onKey(property)}
        >
          Key property
        </button>
        <input
          aria-label="Track filter"
          placeholder="Filter tracks"
          className={`${input} w-24`}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button
          className={button}
          aria-label="Timeline zoom out"
          onClick={() => setZoom(Math.max(30, zoom / 1.5))}
        >
          −
        </button>
        <button
          className={button}
          aria-label="Timeline zoom in"
          onClick={() => setZoom(Math.min(1200, zoom * 1.5))}
        >
          +
        </button>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-auto">
          <div className="flex" style={{ width: width + 180 }}>
            <div className="sticky left-0 z-10 w-44 shrink-0 bg-neutral-950">
              <div className="h-6 px-2 text-xs">Tracks / keys</div>
              <div className="h-6 px-2 text-xs text-violet-300">
                {selectedNodes.length ? 'Selection + descendants' : 'Clip overview'}
              </div>
              {rows.map((row) => (
                <div
                  key={row.id}
                  className="h-7 truncate border-t border-neutral-800 px-2 text-xs leading-7"
                  title={row.label}
                >
                  {row.label}
                </div>
              ))}
            </div>
            <div>
              <div
                className="relative h-6 cursor-pointer border-b border-neutral-700"
                style={{ width }}
                onPointerDown={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  session.scrub((e.clientX - rect.left - 12) / zoom);
                }}
              >
                {Array.from({ length: Math.ceil(clip?.duration ?? 1) + 1 }, (_, i) => (
                  <span key={i} className="absolute text-xs text-neutral-400" style={{ left: i * zoom + 12 }}>
                    {i}s
                  </span>
                ))}
              </div>
              <div
                className="relative h-6 border-b border-neutral-700"
                style={{ width }}
                aria-label="Scene key overview"
              >
                {overviewTimes.map((value) => (
                  <button
                    key={value}
                    aria-label={`Overview keys at ${value}`}
                    className="absolute text-sm text-violet-300"
                    style={{ left: value * zoom + 6 }}
                    onClick={() =>
                      setKeyIds(overviewKeys.filter((key) => key.time === value).map((key) => key.id))
                    }
                  >
                    ◆
                  </button>
                ))}
              </div>
              <div
                ref={area}
                data-testid="scene-keys"
                className="relative select-none"
                style={{
                  width,
                  height: Math.max(28, rows.length * 28),
                  backgroundImage:
                    'repeating-linear-gradient(to right,transparent 0,transparent 29px,#282b32 30px)',
                  backgroundSize: `${zoom / 6}px 100%`,
                }}
                onPointerDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  e.preventDefault();
                  const p = point(e);
                  box.current = { ...p, add: e.shiftKey };
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setRectangle({ ...p, width: 0, height: 0 });
                }}
                onPointerMove={(e) => {
                  const p = point(e);
                  if (drag.current && clip) {
                    drag.current.offset =
                      Math.round(((p.x - drag.current.start) / zoom) * clip.fps) / clip.fps;
                    for (const id of drag.current.ids) {
                      const el = area.current?.querySelector<HTMLElement>(
                        `[data-key-id="${CSS.escape(id)}"]`,
                      );
                      if (el) el.style.transform = `translateX(${drag.current.offset * zoom}px)`;
                    }
                  } else if (box.current) {
                    const b = box.current;
                    setRectangle({
                      x: Math.min(b.x, p.x),
                      y: Math.min(b.y, p.y),
                      width: Math.abs(p.x - b.x),
                      height: Math.abs(p.y - b.y),
                    });
                  }
                }}
                onPointerUp={(e) => {
                  if (drag.current && clip) {
                    const d = drag.current;
                    drag.current = null;
                    for (const el of area.current!.querySelectorAll<HTMLElement>('[data-key-id]'))
                      el.style.transform = '';
                    if (d.offset)
                      edit({
                        kind: 'keys',
                        clipId: clip.id,
                        keyIds: d.ids,
                        origin: 0,
                        scale: 1,
                        offset: d.offset,
                      });
                    else {
                      setKeyIds([d.clickedId]);
                      const key = allKeys.find((key) => key.id === d.clickedId);
                      if (key) session.scrub(key.time);
                    }
                  } else if (box.current) {
                    const p = point(e),
                      b = box.current;
                    const found = rows.flatMap((row, i) =>
                      row.keys
                        .filter(
                          (key) =>
                            key.time * zoom + 12 >= Math.min(b.x, p.x) &&
                            key.time * zoom + 12 <= Math.max(b.x, p.x) &&
                            i * 28 + 14 >= Math.min(b.y, p.y) &&
                            i * 28 + 14 <= Math.max(b.y, p.y),
                        )
                        .map((key) => key.id),
                    );
                    setKeyIds(b.add ? [...new Set([...selected, ...found])] : found);
                    box.current = null;
                    setRectangle(null);
                  }
                  if (e.currentTarget.hasPointerCapture(e.pointerId))
                    e.currentTarget.releasePointerCapture(e.pointerId);
                }}
                onPointerCancel={() => {
                  drag.current = null;
                  box.current = null;
                  setRectangle(null);
                  for (const el of area.current!.querySelectorAll<HTMLElement>('[data-key-id]'))
                    el.style.transform = '';
                }}
              >
                {rows.map((row, i) => (
                  <div
                    key={row.id}
                    className="pointer-events-none absolute w-full border-t border-neutral-800"
                    style={{ top: i * 28, height: 28 }}
                  >
                    {row.keys.map((key) => (
                      <button
                        key={key.id}
                        data-key-id={key.id}
                        aria-label={`${row.label} key ${key.time.toFixed(3)}`}
                        aria-pressed={selected.includes(key.id)}
                        className={`pointer-events-auto absolute top-1 h-5 w-5 -translate-x-1/2 text-sm ${selected.includes(key.id) ? 'text-violet-300' : 'text-amber-300'}`}
                        style={{ left: key.time * zoom + 12 }}
                        onPointerDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (e.shiftKey) {
                            setKeyIds(
                              selected.includes(key.id)
                                ? selected.filter((id) => id !== key.id)
                                : [...selected, key.id],
                            );
                            return;
                          }
                          const ids = selected.includes(key.id) ? selected : [key.id];
                          setKeyIds(ids);
                          drag.current = { start: point(e).x, ids, offset: 0, clickedId: key.id };
                          area.current!.setPointerCapture(e.pointerId);
                        }}
                      >
                        ◆
                      </button>
                    ))}
                  </div>
                ))}
                <div
                  ref={playhead}
                  className="pointer-events-none absolute inset-y-0 w-px bg-red-400"
                  style={{ left: session.time * zoom + 12 }}
                />
                {rectangle && (
                  <div
                    className="pointer-events-none absolute border border-violet-400 bg-violet-500/20"
                    style={{
                      left: rectangle.x,
                      top: rectangle.y,
                      width: rectangle.width,
                      height: rectangle.height,
                    }}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
        <aside className="w-60 shrink-0 overflow-auto border-l border-neutral-700 p-2">
          <h3 className="text-xs">{selected.length} selected keys</h3>
          <div className="my-1 flex flex-wrap gap-1">
            <button
              className={button}
              disabled={!selected.length}
              onClick={() => mutateKeys(1, 1 / (clip?.fps ?? 30), true)}
            >
              Duplicate keys
            </button>
            <button
              className={button}
              disabled={!selected.length}
              onClick={() => {
                if (clip) edit({ kind: 'deleteKeys', clipId: clip.id, keyIds: selected });
              }}
            >
              Delete keys
            </button>
            <button className={button} disabled={!selected.length} onClick={() => mutateKeys(0.5, 0)}>
              Time ×0.5
            </button>
            <button className={button} disabled={!selected.length} onClick={() => mutateKeys(2, 0)}>
              Time ×2
            </button>
          </div>
          {curve && clip && (
            <>
              <label className="text-xs">
                Curve{' '}
                <select
                  aria-label="Scene key curve"
                  className={input}
                  value={curve.type}
                  onChange={(e) =>
                    edit({
                      kind: 'curve',
                      clipId: clip.id,
                      keyIds: selected,
                      curve:
                        e.target.value === 'bezier'
                          ? { type: 'bezier', c1: 0.42, c2: 0, c3: 0.58, c4: 1 }
                          : { type: e.target.value as 'linear' | 'stepped' },
                    })
                  }
                >
                  <option>linear</option>
                  <option>stepped</option>
                  <option>bezier</option>
                </select>
              </label>
              {curve.type === 'bezier' && (
                <SceneCurveEditor
                  key={selectedKey!.id}
                  curve={curve}
                  onCommit={(curve) => edit({ kind: 'curve', clipId: clip.id, keyIds: selected, curve })}
                />
              )}
              {curve.type === 'bezier' && (
                <div className="mt-1 grid grid-cols-2 gap-1">
                  {(['c1', 'c2', 'c3', 'c4'] as const).map((handle) => (
                    <label className="text-xs" key={handle}>
                      {handle}
                      <input
                        aria-label={`Bezier ${handle}`}
                        className={`${input} w-16`}
                        key={`${selectedKey!.id}-${curve[handle]}`}
                        type="number"
                        step="0.05"
                        defaultValue={curve[handle]}
                        onBlur={(e) =>
                          edit({
                            kind: 'curve',
                            clipId: clip.id,
                            keyIds: selected,
                            curve: { ...curve, [handle]: e.target.valueAsNumber } as Curve,
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
              )}
              {graph()}
            </>
          )}
          <div className="mt-2 flex gap-1">
            <input
              aria-label="Scene event name"
              className={`${input} w-24`}
              value={eventName}
              onChange={(e) => setEventName(e.target.value)}
            />
            <button
              className={button}
              disabled={!clip || !eventName.trim()}
              onClick={() => {
                if (clip)
                  edit({
                    kind: 'event',
                    clipId: clip.id,
                    event: { id: uuid(), name: eventName, time: session.time },
                  });
              }}
            >
              Key event
            </button>
          </div>
          <output ref={events} aria-label="Scene events" className="block text-xs text-amber-300" />
        </aside>
      </div>
    </section>
  );
}
