import type { SceneMotionSession } from '../engine/SceneMotionSession';
import { useEffect, useRef, useState } from 'react';
import { Application } from 'pixi.js';
import {
  evaluateScene,
  inverseSceneMatrix,
  sceneLocalMatrix,
  scenePoint,
  transformedSceneSelection,
  type Artboard,
  type SceneMatrix,
  type SceneTransform,
} from '@limber/core';
import { PixiSceneRenderer } from '../rendering/SceneRenderer';
import { ensureUIFonts, type LocalizationPreview } from '../rendering/UITextAdapter';
import type { UIComponent } from '@limber/core';
import { useEditorStore } from '../store/editorStore';

type Tool = 'move' | 'rotate' | 'scale' | 'pivot';
interface Props {
  components?: UIComponent[];
  localization?: LocalizationPreview;
  motion: SceneMotionSession;
  artboard: Artboard;
  revision: number;
  selected: string[];
  onSelect: (id: string, add: boolean) => void;
  onCommit: (values: Record<string, SceneTransform>) => void;
  onClear: () => void;
}
interface Drag {
  clickedId: string | null;
  x: number;
  y: number;
  start: { x: number; y: number };
  pivot: { x: number; y: number };
  ids: string[];
  source: Artboard;
  axis: 'x' | 'y' | null;
  values: Record<string, SceneTransform>;
  pan: boolean;
  camera: { x: number; y: number };
  tool: Tool;
}

export function SceneViewport(props: Props) {
  const host = useRef<HTMLDivElement>(null),
    canvasHost = useRef<HTMLDivElement>(null),
    metrics = useRef<HTMLOutputElement>(null),
    overflow = useRef<HTMLOutputElement>(null);
  const [tool, setTool] = useState<Tool>('move');
  const [snap, setSnap] = useState(false);
  const current = useRef({ ...props, tool, snap });
  current.current = { ...props, tool, snap };
  const controls = useRef<{
    sync: () => void;
    select: () => void;
    frame: (selection: boolean) => void;
  } | null>(null);
  useEffect(() => {
    const element = canvasHost.current!;
    const app = new Application();
    let disposed = false,
      resize: ResizeObserver | undefined;
    let cleanup = () => {};
    void app
      .init({
        background: 0x151821,
        antialias: true,
        preference: 'webgl',
        resolution: devicePixelRatio,
        autoDensity: true,
        autoStart: false,
      })
      .then(async () => {
        await ensureUIFonts();
        if (disposed) {
          app.destroy(true, { children: true });
          return;
        }
        const renderer = new PixiSceneRenderer();
        app.stage.addChild(renderer.world);
        element.appendChild(app.canvas);
        const canvas = app.canvas;
        canvas.style.touchAction = 'none';
        canvas.tabIndex = 0;
        let drag: Drag | null = null;
        let space = false;
        let boardId = '';
        const samples: number[] = [];
        const draw = (started = performance.now()) => {
          renderer.highlight(current.current.selected, current.current.tool);
          app.render();
          const ms = performance.now() - started;
          samples.push(ms);
          if (samples.length > 120) samples.shift();
          const sorted = [...samples].sort((a, b) => a - b),
            p95 = sorted[Math.floor((sorted.length - 1) * 0.95)] ?? 0;
          element.dataset.renderMs = String(ms);
          element.dataset.p95Ms = String(p95);
          element.dataset.rebuilds = String(renderer.rebuilds);
          if (metrics.current)
            metrics.current.textContent = `${ms.toFixed(1)} ms · p95 ${p95.toFixed(1)} ms · ${current.current.artboard.nodes.length} nodes`;
        };
        const frame = (selection: boolean) => {
          const artboard = current.current.artboard;
          const bounds = selection ? renderer.bounds(current.current.selected) : null;
          const rect = bounds ?? {
            x: -artboard.width / 2,
            y: -artboard.height / 2,
            width: artboard.width,
            height: artboard.height,
          };
          const scale = Math.max(
            0.02,
            Math.min(
              16,
              (element.clientWidth - 80) / Math.max(rect.width, 40),
              (element.clientHeight - 80) / Math.max(rect.height, 40),
            ),
          );
          renderer.world.scale.set(scale);
          renderer.world.position.set(
            element.clientWidth / 2 - (rect.x + rect.width / 2) * scale,
            element.clientHeight / 2 - (rect.y + rect.height / 2) * scale,
          );
          draw();
        };
        const sync = () => {
          drag = null;
          renderer.setScene(
            current.current.artboard,
            current.current.components,
            current.current.localization,
          );
          element.dataset.textOverflow = renderer.textOverflow.join(', ');
          if (overflow.current)
            overflow.current.textContent = renderer.textOverflow.length
              ? `Text overflows: ${renderer.textOverflow.join(', ')}`
              : '';
          current.current.motion.refresh();
          const pose = current.current.motion.pose();
          renderer.preview(pose.transforms, pose.opacity);
          const framing = `${current.current.artboard.id}:${current.current.artboard.width}:${current.current.artboard.height}`;
          if (boardId !== framing) {
            boardId = framing;
            frame(false);
          } else draw();
        };
        controls.current = { sync, select: () => draw(), frame };
        const screen = (event: { clientX: number; clientY: number }) => {
          const rect = canvas.getBoundingClientRect();
          return { x: event.clientX - rect.left, y: event.clientY - rect.top };
        };
        const world = (p: { x: number; y: number }) => ({
          x: (p.x - renderer.world.x) / renderer.world.scale.x,
          y: (p.y - renderer.world.y) / renderer.world.scale.y,
        });
        const down = (event: PointerEvent) => {
          if (event.button !== 0 && event.button !== 1) return;
          canvas.focus({ preventScroll: true });
          if (current.current.motion.playing) current.current.motion.pause();
          const p = screen(event),
            start = world(p),
            state = current.current,
            pan = event.button === 1 || space;
          let ids = [...state.selected];
          const hit = renderer.hitTest(start.x, start.y);
          if (!pan && event.shiftKey && hit) {
            state.onSelect(hit, true);
            return;
          }
          const oldPivot = renderer.pivot(ids);
          let axis: Drag['axis'] = null;
          const ringHandle =
            !!oldPivot &&
            state.tool === 'rotate' &&
            Math.abs(Math.hypot(start.x - oldPivot.x, start.y - oldPivot.y) * renderer.world.scale.x - 45) <
              8;
          if (!pan && oldPivot && state.tool === 'move') {
            const dx = (start.x - oldPivot.x) * renderer.world.scale.x,
              dy = (start.y - oldPivot.y) * renderer.world.scale.x;
            if (Math.abs(dy) < 8 && dx > 10 && dx < 60) axis = 'x';
            else if (Math.abs(dx) < 8 && dy > 10 && dy < 60) axis = 'y';
          }
          if (!pan && hit && !ids.includes(hit) && !axis && !ringHandle) {
            ids = [hit];
            state.onSelect(hit, false);
          }
          if (!pan && !hit && !axis && (state.tool === 'move' || !ids.length)) {
            state.onClear();
            return;
          }
          if (!pan && !ids.length) return;
          if (!pan && state.tool === 'pivot' && ids.length !== 1) {
            useEditorStore.getState().setStatus('Select one node to edit its pivot.');
            return;
          }
          const pivot = renderer.pivot(ids) ?? start;
          drag = {
            clickedId: ringHandle || axis ? null : hit,
            x: p.x,
            y: p.y,
            start,
            pivot,
            ids,
            source: state.motion.view(),
            axis,
            values: {},
            pan,
            camera: { x: renderer.world.x, y: renderer.world.y },
            tool: state.tool,
          };
          canvas.setPointerCapture(event.pointerId);
          event.preventDefault();
        };
        const move = (event: PointerEvent) => {
          if (!drag) return;
          const started = performance.now(),
            p = screen(event),
            point = world(p),
            d = drag;
          if (d.pan) {
            renderer.world.position.set(d.camera.x + p.x - d.x, d.camera.y + p.y - d.y);
            draw(started);
            return;
          }
          const snapping = current.current.snap || event.shiftKey;
          try {
            if (d.tool === 'pivot') {
              const entry = evaluateScene(d.source).find((entry) => entry.node.id === d.ids[0])!;
              const local = scenePoint(inverseSceneMatrix(entry.world), point.x, point.y),
                m = sceneLocalMatrix(entry.node.transform);
              const pivotX = snapping ? Math.round(local.x / 10) * 10 : local.x,
                pivotY = snapping ? Math.round(local.y / 10) * 10 : local.y;
              d.values = {
                [entry.node.id]: {
                  ...entry.node.transform,
                  pivotX,
                  pivotY,
                  x: m[4] + m[0] * pivotX + m[2] * pivotY,
                  y: m[5] + m[1] * pivotX + m[3] * pivotY,
                },
              };
            } else {
              let delta: SceneMatrix;
              if (d.tool === 'move') {
                let dx = d.axis === 'y' ? 0 : point.x - d.start.x,
                  dy = d.axis === 'x' ? 0 : point.y - d.start.y;
                if (snapping) {
                  dx = Math.round(dx / 10) * 10;
                  dy = Math.round(dy / 10) * 10;
                }
                delta = [1, 0, 0, 1, dx, dy];
              } else if (d.tool === 'rotate') {
                let angle =
                  Math.atan2(point.y - d.pivot.y, point.x - d.pivot.x) -
                  Math.atan2(d.start.y - d.pivot.y, d.start.x - d.pivot.x);
                if (snapping) angle = Math.round(angle / (Math.PI / 12)) * (Math.PI / 12);
                const c = Math.cos(angle),
                  s = Math.sin(angle);
                delta = [
                  c,
                  s,
                  -s,
                  c,
                  d.pivot.x - c * d.pivot.x + s * d.pivot.y,
                  d.pivot.y - s * d.pivot.x - c * d.pivot.y,
                ];
              } else {
                const dx = d.start.x - d.pivot.x,
                  dy = d.start.y - d.pivot.y;
                let factor =
                  ((point.x - d.pivot.x) * dx + (point.y - d.pivot.y) * dy) / Math.max(1, dx * dx + dy * dy);
                if (snapping) factor = Math.round(factor * 10) / 10;
                if (Math.abs(factor) < 0.01) factor = factor < 0 ? -0.01 : 0.01;
                delta = [factor, 0, 0, factor, d.pivot.x * (1 - factor), d.pivot.y * (1 - factor)];
              }
              d.values = transformedSceneSelection(d.source, d.ids, delta);
            }
            const pose = current.current.motion.pose();
            renderer.preview({ ...pose.transforms, ...d.values }, pose.opacity);
            draw(started);
          } catch (error) {
            useEditorStore.getState().setStatus((error as Error).message);
            drag = null;
            renderer.preview({});
            draw();
          }
        };
        const finish = (event: PointerEvent) => {
          const d = drag;
          drag = null;
          if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
          if (d && !d.pan && Object.keys(d.values).length) current.current.onCommit(d.values);
          else if (d && !d.pan && d.clickedId) current.current.onSelect(d.clickedId, false);
          const pose = current.current.motion.pose();
          renderer.preview(pose.transforms, pose.opacity);
          draw();
        };
        const cancel = () => {
          drag = null;
          const pose = current.current.motion.pose();
          renderer.preview(pose.transforms, pose.opacity);
          draw();
        };
        const wheel = (event: WheelEvent) => {
          event.preventDefault();
          const p = screen(event),
            before = world(p),
            scale = Math.max(0.02, Math.min(32, renderer.world.scale.x * Math.exp(-event.deltaY * 0.001)));
          renderer.world.scale.set(scale);
          renderer.world.position.set(p.x - before.x * scale, p.y - before.y * scale);
          draw();
        };
        const keydown = (event: KeyboardEvent) => {
          if (event.key === 'Escape') {
            cancel();
            return;
          }
          if ((event.target as HTMLElement)?.matches('input,select,textarea')) return;
          if (event.code === 'Space') {
            space = true;
            event.preventDefault();
          }
          if (event.key === 'Escape') cancel();
          if (event.key.toLowerCase() === 'f') {
            frame(true);
            event.preventDefault();
          }
        };
        const keyup = (event: KeyboardEvent) => {
          if (event.code === 'Space') space = false;
        };
        canvas.addEventListener('pointerdown', down);
        canvas.addEventListener('pointermove', move);
        canvas.addEventListener('pointerup', finish);
        canvas.addEventListener('pointercancel', cancel);
        canvas.addEventListener('wheel', wheel, { passive: false });
        window.addEventListener('keydown', keydown);
        window.addEventListener('keyup', keyup);
        window.addEventListener('blur', cancel);
        resize = new ResizeObserver(() => {
          app.renderer.resize(Math.max(1, element.clientWidth), Math.max(1, element.clientHeight));
          frame(false);
        });
        resize.observe(element);
        app.renderer.resize(Math.max(1, element.clientWidth), Math.max(1, element.clientHeight));
        sync();
        const unsubscribeMotion = current.current.motion.onFrame(() => {
          if (drag) return;
          const started = performance.now(),
            pose = current.current.motion.pose();
          renderer.preview(pose.transforms, pose.opacity);
          draw(started);
        });
        let previous = performance.now(),
          raf = 0;
        const tick = (now: number) => {
          current.current.motion.advance(Math.max(0, (now - previous) / 1000));
          previous = now;
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        cleanup = () => {
          cancelAnimationFrame(raf);
          unsubscribeMotion();
          current.current.motion.pause();
          window.removeEventListener('keydown', keydown);
          window.removeEventListener('keyup', keyup);
          window.removeEventListener('blur', cancel);
          renderer.destroy();
          app.destroy(true, { children: true });
        };
      })
      .catch((error: unknown) => {
        if (!disposed) useEditorStore.getState().setStatus(`Scene renderer failed: ${String(error)}`);
      });
    return () => {
      disposed = true;
      controls.current = null;
      resize?.disconnect();
      cleanup();
    };
  }, []);
  useEffect(() => {
    controls.current?.sync();
  }, [props.artboard, props.revision, props.components, props.localization]);
  useEffect(() => {
    controls.current?.select();
  }, [props.selected, tool]);
  return (
    <div ref={host} className="relative h-full min-w-0 flex-1 overflow-hidden" data-testid="scene-viewport">
      <div ref={canvasHost} className="absolute inset-0" data-testid="scene-canvas" />
      <div className="absolute left-2 top-2 flex flex-wrap gap-1 rounded bg-neutral-900/90 p-1">
        {(['move', 'rotate', 'scale', 'pivot'] as const).map((item) => (
          <button
            key={item}
            aria-label={`Scene ${item}`}
            aria-pressed={tool === item}
            className={`rounded px-2 py-1 text-xs ${tool === item ? 'bg-violet-700' : 'hover:bg-neutral-700'}`}
            onClick={() => setTool(item)}
          >
            {item}
          </button>
        ))}
        <label className="px-2 py-1 text-xs">
          <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} /> Snap
        </label>
        <button className="px-2 text-xs" onClick={() => controls.current?.frame(false)}>
          Fit artboard
        </button>
        <button className="px-2 text-xs" onClick={() => controls.current?.frame(true)}>
          Frame selection
        </button>
      </div>
      <output
        ref={metrics}
        className="pointer-events-none absolute bottom-2 left-2 rounded bg-neutral-900/90 px-2 text-xs text-neutral-300"
        aria-label="Scene render timing"
      />
      <output
        ref={overflow}
        aria-label="Text overflow"
        className="pointer-events-none absolute bottom-8 left-2 rounded bg-neutral-900/90 px-2 text-xs text-amber-300"
      />
      <span className="pointer-events-none absolute bottom-2 right-2 text-xs text-neutral-400">
        Wheel: zoom · Middle/Space drag: pan · F: frame · Shift: snap
      </span>
    </div>
  );
}
