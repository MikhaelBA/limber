import { useEffect, useRef } from 'react';
import { Application } from 'pixi.js';
import type { UIComponent, LogicRouteEvent } from '@limber/core';
import type { LogicPreviewSession } from '../engine/LogicPreviewSession';
import { PixiSceneRenderer } from '../rendering/SceneRenderer';
import { ensureUIFonts } from '../rendering/UITextAdapter';
interface Props {
  session: LogicPreviewSession;
  components?: UIComponent[];
  onFrame: () => void;
  onError: (message: string) => void;
}
type LogicFrame = { timestamp: number; coreMs: number; cpuMs: number; acceptedTicks: number };
export function LogicViewport(props: Props) {
  const host = useRef<HTMLDivElement>(null),
    current = useRef(props);
  current.current = props;
  const publish = useRef<(() => void) | null>(null);
  useEffect(() => {
    const element = host.current!,
      app = new Application();
    let disposed = false,
      cleanup = () => {};
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
        const evidence = window as unknown as {
          __logicCapture?: () => unknown;
          __logicFrameMetrics?: { limit: number; frames: LogicFrame[] };
        };
        const capture = () => ({
          snapshot: current.current.session.player?.snapshot() ?? null,
          rigs: renderer.inspectRigs(),
          view: renderer.inspectView(),
          rebuilds: renderer.rebuilds,
          textRasters: renderer.textRasters,
        });
        evidence.__logicCapture = capture;
        app.stage.addChild(renderer.world);
        element.appendChild(app.canvas);
        const canvas = app.canvas;
        canvas.tabIndex = 0;
        canvas.setAttribute('aria-label', 'Logic interaction preview');
        canvas.style.touchAction = 'none';
        let hovered: string | null = null,
          pressed: string | null = null,
          frameId = 0,
          previous = performance.now(),
          debugAt = 0;
        const draw = () => {
          const session = current.current.session;
          renderer.previewView(session.view, session.skeletons);
          app.render();
          element.dataset.rebuilds = String(renderer.rebuilds);
          element.dataset.textRasters = String(renderer.textRasters);
          element.dataset.tick = String(session.player?.currentTick ?? 0);
        };
        const resize = new ResizeObserver(() => {
          app.renderer.resize(Math.max(1, element.clientWidth), Math.max(1, element.clientHeight));
          frame();
        });
        const frame = () => {
          const board = current.current.session.board,
            scale = Math.max(
              0.02,
              Math.min((element.clientWidth - 40) / board.width, (element.clientHeight - 40) / board.height),
            );
          renderer.world.scale.set(scale);
          renderer.world.position.set(element.clientWidth / 2, element.clientHeight / 2);
          draw();
        };
        const sync = () => {
          hovered = pressed = null;
          const p = current.current;
          renderer.setScene(p.session.board, p.components, 'expected', p.session.skeletons);
          frame();
          p.onFrame();
          previous = performance.now();
        };
        publish.current = sync;
        resize.observe(element);
        sync();
        const send = (event: LogicRouteEvent, target: string | null = null) => {
          if (current.current.session.owner.rigId !== null && target !== null) return;
          try {
            current.current.session.dispatch(event, target);
            current.current.onFrame();
          } catch (error) {
            current.current.onError((error as Error).message);
          }
        };
        const hit = (event: PointerEvent | MouseEvent) => {
          const rect = canvas.getBoundingClientRect();
          return renderer.hitTest(
            (event.clientX - rect.left - renderer.world.x) / renderer.world.scale.x,
            (event.clientY - rect.top - renderer.world.y) / renderer.world.scale.y,
          );
        };
        const hover = (target: string | null) => {
          if (target === hovered) return;
          if (hovered !== null) send('pointerLeave', hovered);
          hovered = target;
          if (hovered !== null) send('pointerEnter', hovered);
        };
        const move = (event: PointerEvent) => hover(hit(event));
        const down = (event: PointerEvent) => {
          if (event.button !== 0) return;
          canvas.focus();
          pressed = hit(event);
          hover(pressed);
          send('pointerDown');
          if (pressed !== null) send('pointerDown', pressed);
          canvas.setPointerCapture(event.pointerId);
        };
        const up = (event: PointerEvent) => {
          if (event.button !== 0) return;
          send('pointerUp');
          if (pressed !== null) send('pointerUp', pressed);
          pressed = null;
        };
        const click = (event: MouseEvent) => {
          send('click');
          const target = hit(event);
          if (target !== null) send('click', target);
        };
        const enter = () => send('pointerEnter');
        const leave = () => {
          hover(null);
          send('pointerLeave');
        };
        const focus = () => send('focus'),
          blur = () => send('blur');
        const cancel = () => {
          if (pressed !== null) send('pointerUp', pressed);
          pressed = null;
          hover(null);
        };
        const key = (event: KeyboardEvent) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            send('click');
          }
        };
        canvas.addEventListener('pointermove', move);
        canvas.addEventListener('pointerdown', down);
        canvas.addEventListener('pointerup', up);
        canvas.addEventListener('pointercancel', cancel);
        canvas.addEventListener('click', click);
        canvas.addEventListener('pointerenter', enter);
        canvas.addEventListener('pointerleave', leave);
        canvas.addEventListener('focus', focus);
        canvas.addEventListener('blur', blur);
        canvas.addEventListener('keydown', key);
        const tick = (now: number) => {
          if (disposed) return;
          try {
            const metrics = evidence.__logicFrameMetrics,
              measure = metrics && metrics.frames.length < Math.min(600, metrics.limit),
              started = measure ? performance.now() : 0,
              beforeTick = measure ? (current.current.session.player?.currentTick ?? 0) : 0;
            current.current.session.advance((now - previous) / 1000);
            const coreMs = measure ? performance.now() - started : 0;
            draw();
            if (now - debugAt > 100) {
              current.current.onFrame();
              debugAt = now;
            }
            if (measure)
              metrics.frames.push({
                timestamp: now,
                coreMs,
                cpuMs: performance.now() - started,
                acceptedTicks: (current.current.session.player?.currentTick ?? 0) - beforeTick,
              });
          } catch (error) {
            current.current.session.pause();
            current.current.onError((error as Error).message);
          }
          previous = now;
          frameId = requestAnimationFrame(tick);
        };
        frameId = requestAnimationFrame(tick);
        cleanup = () => {
          cancelAnimationFrame(frameId);
          resize.disconnect();
          canvas.removeEventListener('pointermove', move);
          canvas.removeEventListener('pointerdown', down);
          canvas.removeEventListener('pointerup', up);
          canvas.removeEventListener('pointercancel', cancel);
          canvas.removeEventListener('click', click);
          canvas.removeEventListener('pointerenter', enter);
          canvas.removeEventListener('pointerleave', leave);
          canvas.removeEventListener('focus', focus);
          canvas.removeEventListener('blur', blur);
          canvas.removeEventListener('keydown', key);
          publish.current = null;
          if (evidence.__logicCapture === capture) delete evidence.__logicCapture;
          renderer.destroy();
          app.destroy(true, { children: true });
        };
      })
      .catch((error) => {
        if (!disposed) current.current.onError((error as Error).message);
      });
    return () => {
      disposed = true;
      cleanup();
    };
  }, []);
  useEffect(() => {
    publish.current?.();
  }, [props.session, props.components]);
  return <div ref={host} data-testid="logic-preview" className="relative min-h-0 flex-1 overflow-hidden" />;
}
