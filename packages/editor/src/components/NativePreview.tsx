import { useEffect, useRef } from 'react';
import { Application } from 'pixi.js';
import {
  NativeArtboardPlayer,
  inspectRuntimeFrame,
  type NativeRuntimeAsset,
  type RuntimeFrameWork,
  type RuntimeProfileSummary,
  type NativeArtboardEvent,
} from '@limber/runtime';
import { NativeWebAssets, NativeWebRenderer, NativeWebFrameProfiler } from '@limber/runtime-web';
import type { LogicRouteEvent } from '@limber/core';

export interface NativePreviewHandle {
  player: NativeArtboardPlayer;
  refresh: () => void;
}
export interface NativePreviewStatistics {
  work: RuntimeFrameWork;
  profile: RuntimeProfileSummary;
  playing: boolean;
  tick: number;
  events: NativeArtboardEvent[];
}
interface Props {
  asset: NativeRuntimeAsset;
  artboardId: string;
  inputOwner?: string;
  viewport?: { width: number; height: number };
  onReady: (handle: NativePreviewHandle | null) => void;
  onStatistics: (statistics: NativePreviewStatistics) => void;
  onError: (message: string) => void;
  onInputError?: (message: string) => void;
}
/** The same packaged asset/font/render path used by the independent Web acceptance gates. */
export function NativePreview(props: Props) {
  const host = useRef<HTMLDivElement>(null),
    current = useRef(props),
    reframe = useRef<(() => void) | null>(null);
  current.current = props;
  useEffect(() => {
    const element = host.current!,
      controller = new AbortController(),
      app = new Application();
    let disposed = false,
      initialized = false,
      assets: NativeWebAssets | undefined,
      view: NativeWebRenderer | undefined,
      resize: ResizeObserver | undefined,
      raf = 0;
    const detach: (() => void)[] = [];
    const cleanup = () => {
      element.dataset.ready = 'false';
      reframe.current = null;
      cancelAnimationFrame(raf);
      resize?.disconnect();
      for (const remove of detach.splice(0)) remove();
      view?.destroy();
      view = undefined;
      if (initialized) {
        app.destroy(true);
        initialized = false;
      }
      assets?.dispose();
      assets = undefined;
    };
    current.current.onReady(null);
    void (async () => {
      assets = await NativeWebAssets.load(props.asset, { signal: controller.signal });
      if (disposed) {
        cleanup();
        return;
      }
      await app.init({
        background: 0x151821,
        antialias: true,
        preference: 'webgl',
        resolution: Math.min(2, devicePixelRatio),
        autoDensity: true,
        autoStart: false,
      });
      initialized = true;
      if (disposed) {
        cleanup();
        return;
      }
      const player = new NativeArtboardPlayer(props.asset, { artboardId: props.artboardId, autoplay: true });
      const authoredSize = { width: player.getView().width, height: player.getView().height };
      const native = new NativeWebRenderer(player, assets);
      view = native;
      const profiler = new NativeWebFrameProfiler(native),
        events: NativeArtboardEvent[] = [];
      detach.push(
        player.onEvent((event) => {
          events.push(event);
          if (events.length > 32) events.shift();
        }),
      );
      app.stage.addChild(native.world);
      element.appendChild(app.canvas);
      const canvas = app.canvas;
      canvas.tabIndex = 0;
      canvas.setAttribute('aria-label', 'Packaged native interaction preview');
      canvas.style.touchAction = 'none';
      const statistics = () => {
        if (disposed) return;
        element.dataset.tick = String(player.currentTick);
        element.dataset.playing = String(player.playing);
        current.current.onStatistics({
          work: inspectRuntimeFrame(player),
          profile: profiler.frames.inspect(),
          tick: player.currentTick,
          playing: player.playing,
          events: [...events],
        });
      };
      const refresh = () => {
        native.sync();
        app.render();
        statistics();
      };
      const frame = () => {
        const size = current.current.viewport ?? authoredSize;
        player.resize(size.width, size.height);
        app.renderer.resize(Math.max(1, element.clientWidth), Math.max(1, element.clientHeight));
        const board = player.getView(),
          scale = Math.max(
            0.01,
            Math.min((element.clientWidth - 40) / board.width, (element.clientHeight - 40) / board.height),
          );
        native.world.scale.set(scale);
        native.world.position.set(element.clientWidth / 2, element.clientHeight / 2);
        refresh();
      };
      const send = (event: LogicRouteEvent, id: string | null = null) => {
        try {
          const owner = current.current.inputOwner;
          if (owner) {
            const rig = player.getRig(owner);
            if (id !== null || rig.mode !== 'logic') return;
            rig.dispatch(event);
          } else {
            if (player.scene.mode !== 'logic') return;
            player.dispatch(event, id);
          }
          refresh();
        } catch (error) {
          current.current.onInputError?.((error as Error).message);
        }
      };
      const hit = (event: PointerEvent | MouseEvent) => {
        const rect = canvas.getBoundingClientRect();
        return native.hitTest(
          (event.clientX - rect.left - native.world.x) / native.world.scale.x,
          (event.clientY - rect.top - native.world.y) / native.world.scale.y,
        );
      };
      let hovered: string | null = null,
        pressed: string | null = null;
      const hover = (id: string | null) => {
        if (hovered === id) return;
        if (hovered !== null) send('pointerLeave', hovered);
        hovered = id;
        if (id !== null) send('pointerEnter', id);
      };
      const listeners: [string, EventListener][] = [
        ['pointermove', ((event: PointerEvent) => hover(hit(event))) as EventListener],
        [
          'pointerdown',
          ((event: PointerEvent) => {
            if (event.button !== 0) return;
            canvas.focus();
            pressed = hit(event);
            hover(pressed);
            send('pointerDown');
            if (pressed !== null) send('pointerDown', pressed);
            canvas.setPointerCapture(event.pointerId);
          }) as EventListener,
        ],
        [
          'pointerup',
          ((event: PointerEvent) => {
            if (event.button !== 0) return;
            send('pointerUp');
            if (pressed !== null) send('pointerUp', pressed);
            pressed = null;
          }) as EventListener,
        ],
        [
          'click',
          ((event: MouseEvent) => {
            send('click');
            const id = hit(event);
            if (id !== null) send('click', id);
          }) as EventListener,
        ],
        ['pointerenter', () => send('pointerEnter')],
        [
          'pointerleave',
          () => {
            hover(null);
            send('pointerLeave');
          },
        ],
        [
          'pointercancel',
          () => {
            if (pressed !== null) send('pointerUp', pressed);
            pressed = null;
            hover(null);
            send('pointerUp');
          },
        ],
        ['focus', () => send('focus')],
        [
          'blur',
          () => {
            pressed = null;
            send('blur');
          },
        ],
        [
          'keydown',
          ((event: KeyboardEvent) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              event.stopPropagation();
              send('click');
            }
          }) as EventListener,
        ],
      ];
      for (const [event, listener] of listeners) {
        canvas.addEventListener(event, listener);
        detach.push(() => canvas.removeEventListener(event, listener));
      }
      resize = new ResizeObserver(frame);
      reframe.current = frame;
      resize.observe(element);
      frame();
      let previous = performance.now(),
        published = previous;
      const tick = (now: number) => {
        if (disposed) return;
        try {
          const renderer = app.renderer as unknown as { gl?: WebGLRenderingContext | WebGL2RenderingContext };
          profiler.run(Math.max(0, (now - previous) / 1000), () => app.render(), renderer.gl);
          if (now - published >= 250) {
            statistics();
            published = now;
          }
          previous = now;
          raf = requestAnimationFrame(tick);
        } catch (error) {
          current.current.onError((error as Error).message);
          cleanup();
          current.current.onReady(null);
        }
      };
      raf = requestAnimationFrame(tick);
      element.dataset.ready = 'true';
      current.current.onReady({ player, refresh });
    })().catch((error) => {
      cleanup();
      if (!disposed) current.current.onError((error as Error).message);
    });
    return () => {
      disposed = true;
      controller.abort();
      element.dataset.ready = 'false';
      cleanup();
      current.current.onReady(null);
    };
  }, [props.asset, props.artboardId]);
  useEffect(() => reframe.current?.(), [props.viewport]);
  return (
    <div
      ref={host}
      data-testid="native-preview"
      className="relative min-h-64 min-w-0 flex-1 overflow-hidden"
    />
  );
}
