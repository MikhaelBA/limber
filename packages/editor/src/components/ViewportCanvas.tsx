import { useEffect, useRef } from 'react';
import { Application, Container, Graphics } from 'pixi.js';
import { AutoKeyMoveBoneCommand } from '../commands/animationCommands';
import { AddBoneCommand, MoveBoneCommand } from '../commands/boneCommands';
import { useEngine } from '../hooks/useEngine';
import { distToSegment, inverseTransformPoint } from '../math/matrix';
import { useEditorStore } from '../store/editorStore';

interface Camera {
  x: number;
  y: number;
  scale: number;
}

/**
 * One Application per CANVAS ELEMENT, shared across effect runs and StrictMode
 * remounts (DESIGN.md §5.5).
 *
 * Why a manager: React 18 StrictMode double-invokes effect setups AND cleanups
 * synchronously. A cleanup that destroys the app immediately would kill the
 * shared WebGL context (real ANGLE/D3D drivers lose it for good — seen as
 * "Could not retrieve shader source"), and nulling a memoized init promise
 * makes the next setup create a SECOND Application on the same canvas. So:
 * - the init promise is cached on the canvas (WeakMap), never re-created;
 * - wiring happens exactly once per Application (WeakSet);
 * - destroy only runs when the refcount is still zero a microtask LATER —
 *   StrictMode's synchronous remount re-acquires before that fires.
 */
interface CanvasAppEntry {
  ready: Promise<Application>;
  users: number;
}

const canvasApps = new WeakMap<HTMLCanvasElement, CanvasAppEntry>();
const wiredApps = new WeakSet<Application>();

function acquireApp(canvas: HTMLCanvasElement, initOpts: Parameters<Application['init']>[0]): CanvasAppEntry {
  let entry = canvasApps.get(canvas);
  if (!entry) {
    const app = new Application();
    const ready = app.init(initOpts).then(
      () => app,
      (err) => {
        canvasApps.delete(canvas);
        throw err;
      },
    );
    entry = { ready, users: 0 };
    canvasApps.set(canvas, entry);
  }
  entry.users++;
  return entry;
}

function releaseApp(canvas: HTMLCanvasElement): void {
  const entry = canvasApps.get(canvas);
  if (!entry) return;
  entry.users--;
  if (entry.users <= 0) {
    queueMicrotask(() => {
      const current = canvasApps.get(canvas);
      if (current && current.users <= 0) {
        canvasApps.delete(canvas);
        // removeView=false: React owns the canvas and removes it with the tree.
        current.ready.then((app) => app.destroy(false, { children: true })).catch(() => {});
      }
    });
  }
}

export function ViewportCanvas() {
  const engine = useEngine();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    let disposed = false;

    const entry = acquireApp(canvas, {
      canvas,
      antialias: true,
      background: 0x2c2c2c,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      preference: 'webgl',
      width: Math.max(1, wrap.clientWidth),
      height: Math.max(1, wrap.clientHeight),
    });

    entry.ready
      .then((app) => {
        if (disposed || wiredApps.has(app)) return;
        wiredApps.add(app);
        (window as unknown as Record<string, unknown>).__sprine = 'init-done';
        wireViewport(app, canvas, wrap, engine);
      })
      .catch((err) => console.error('Pixi init failed:', err));

    return () => {
      disposed = true;
      releaseApp(canvas);
    };
  }, [engine]);

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden bg-neutral-800">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full touch-none" />
    </div>
  );
}

function wireViewport(
  theApp: Application,
  canvas: HTMLCanvasElement,
  wrap: HTMLDivElement,
  engine: ReturnType<typeof useEngine>,
): void {
  const world = new Container();
  theApp.stage.addChild(world);
  const grid = new Graphics();
  world.addChild(grid);
  const bonesG = new Graphics();
  world.addChild(bonesG);

  const camera: Camera = { x: theApp.screen.width * 0.5, y: theApp.screen.height * 0.42, scale: 1 };
  let centered = false;

  const drawGrid = () => {
    grid.clear();
    const s = camera.scale;
    let step = 10;
    while (step * s < 24) step *= 5; // Keep grid lines readable at any zoom.
    const half = 3000;
    const w = 1 / s;
    for (let v = -half; v <= half; v += step) {
      grid.setStrokeStyle({ width: w, color: 0x3a3f46, alpha: 0.5 });
      grid.moveTo(v, -half).lineTo(v, half).stroke();
      grid.moveTo(-half, v).lineTo(half, v).stroke();
    }
    grid.setStrokeStyle({ width: 1.5 / s, color: 0x7a4a4a, alpha: 0.9 });
    grid.moveTo(-half, 0).lineTo(half, 0).stroke(); // X axis
    grid.setStrokeStyle({ width: 1.5 / s, color: 0x4a7a4a, alpha: 0.9 });
    grid.moveTo(0, -half).lineTo(0, half).stroke(); // Y axis
  };

  const applyCamera = () => {
    world.position.set(camera.x, camera.y);
    world.scale.set(camera.scale);
    drawGrid();
  };

  // resizeTo is NOT used: nested resizable panels can measure 0×0 at init and
  // Pixi then locks a 0×0 inline style onto the canvas. We resize manually
  // from the wrapper's real box instead.
  const resizeToWrapper = () => {
    const w = Math.max(1, wrap.clientWidth);
    const h = Math.max(1, wrap.clientHeight);
    theApp.renderer.resize(w, h);
    if (!centered && w > 1 && h > 1) {
      centered = true;
      camera.x = w * 0.5;
      camera.y = h * 0.42;
      applyCamera();
    }
  };
  const resizeObserver = new ResizeObserver(resizeToWrapper);
  resizeObserver.observe(wrap);

  const drawBones = () => {
    const st = useEditorStore.getState();
    bonesG.clear();
    const data = engine.skeleton.data;
    const wm = engine.skeleton.pose.worldMatrices;
    const s = camera.scale;
    for (let i = 0; i < data.bones.length; i++) {
      const bone = data.bones[i]!;
      const o = i * 6;
      const ox = wm[o + 4]!;
      const oy = wm[o + 5]!;
      const len = bone.length || 50;
      const tx = wm[o]! * len + ox;
      const ty = wm[o + 1]! * len + oy;
      const color =
        st.selectedBoneId === bone.id ? 0xffa028 : st.hoveredBoneId === bone.id ? 0x9cc7ff : 0x6aa9ff;
      bonesG.setStrokeStyle({ width: (st.selectedBoneId === bone.id ? 2.5 : 2) / s, color, cap: 'round' });
      bonesG.moveTo(ox, oy).lineTo(tx, ty).stroke();
      bonesG.circle(ox, oy, 3.5 / s).fill({ color });
      if (st.selectedBoneId === bone.id) {
        bonesG.circle(ox, oy, 9 / s).fill({ color: 0xffa028, alpha: 0.15 });
      }
    }
  };

  const screenToWorld = (e: { clientX: number; clientY: number }) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left - camera.x) / camera.scale,
      y: (e.clientY - rect.top - camera.y) / camera.scale,
    };
  };

  /** Custom picking (§5.7): topmost-first distance test against bone segments. */
  const pickBone = (wx: number, wy: number): string | null => {
    const r = 8 / camera.scale;
    const data = engine.skeleton.data;
    const wm = engine.skeleton.pose.worldMatrices;
    for (let i = data.bones.length - 1; i >= 0; i--) {
      const o = i * 6;
      const ox = wm[o + 4]!;
      const oy = wm[o + 5]!;
      const len = data.bones[i]!.length || 50;
      const tx = wm[o]! * len + ox;
      const ty = wm[o + 1]! * len + oy;
      if (distToSegment(wx, wy, ox, oy, tx, ty) <= r || Math.hypot(wx - ox, wy - oy) <= r * 1.4) {
        return data.bones[i]!.id;
      }
    }
    return null;
  };

  /** World point → the LOCAL space of `parentId` (null = skeleton root). */
  const parentLocalOf = (parentId: string | null, wx: number, wy: number) => {
    if (parentId === null) return { x: wx, y: wy };
    const out = { x: 0, y: 0 };
    const idx = engine.skeleton.boneIndexMap.get(parentId)!;
    inverseTransformPoint(engine.skeleton.pose.worldMatrices, idx, wx, wy, out);
    return out;
  };

  // ---- Pointer interaction ----
  let panning = false;
  let lastPX = 0;
  let lastPY = 0;
  let moveCmd: MoveBoneCommand | null = null;
  let autoKeyCmd: AutoKeyMoveBoneCommand | null = null;
  let dragBoneId: string | null = null;

  const onPointerDown = (e: PointerEvent) => {
    canvas.setPointerCapture(e.pointerId);
    if (e.button === 1) {
      panning = true;
      lastPX = e.clientX;
      lastPY = e.clientY;
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    const st = useEditorStore.getState();
    const wp = screenToWorld(e);

    if (st.activeTool === 'create_bone') {
      const hitId = pickBone(wp.x, wp.y); // Child of the hit bone, else a new root.
      const local = parentLocalOf(hitId, wp.x, wp.y);
      const cmd = new AddBoneCommand(engine, hitId, local);
      st.execute(cmd);
      st.select(cmd.boneId);
      return;
    }

    const hitId = pickBone(wp.x, wp.y);
    st.select(hitId);
    if (hitId) {
      dragBoneId = hitId;
      // Animate mode: drags write keyframes at the playhead (auto-key §5.6).
      // Setup mode: drags edit the rig's setup pose.
      if (st.mode === 'animate' && engine.currentAnimation) {
        autoKeyCmd = new AutoKeyMoveBoneCommand(engine, hitId);
        autoKeyCmd.open();
      } else {
        moveCmd = new MoveBoneCommand(engine, hitId);
        moveCmd.open();
      }
      canvas.style.cursor = 'grabbing';
    }
  };

  const onPointerMove = (e: PointerEvent) => {
    if (panning) {
      camera.x += e.clientX - lastPX;
      camera.y += e.clientY - lastPY;
      lastPX = e.clientX;
      lastPY = e.clientY;
      applyCamera();
      return;
    }
    const wp = screenToWorld(e);
    if ((moveCmd || autoKeyCmd) && dragBoneId) {
      const bone = engine.skeleton.data.bones.find((b) => b.id === dragBoneId);
      if (!bone) return;
      const parentId = bone.parentId;
      // In animate mode the parent's world matrix is the ANIMATED pose — which
      // is exactly what the user sees, so converting through it keeps the bone
      // under the cursor.
      const local = parentLocalOf(parentId, wp.x, wp.y);
      if (moveCmd) moveCmd.update(local.x, local.y);
      else autoKeyCmd?.update(local.x, local.y);
      return;
    }
    const st = useEditorStore.getState();
    const hit = pickBone(wp.x, wp.y);
    if (st.hoveredBoneId !== hit) st.setHover(hit);
    canvas.style.cursor = hit ? 'grab' : 'default';
  };

  const onPointerUp = (e: PointerEvent) => {
    if (panning && e.button === 1) {
      panning = false;
      return;
    }
    const st = useEditorStore.getState();
    if (moveCmd) {
      moveCmd.commit();
      if (moveCmd.changed) st.execute(moveCmd); // One history entry per drag.
      moveCmd = null;
    }
    if (autoKeyCmd) {
      autoKeyCmd.commit();
      if (autoKeyCmd.changed) st.execute(autoKeyCmd);
      autoKeyCmd = null;
    }
    dragBoneId = null;
    canvas.style.cursor = 'default';
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const wx = (sx - camera.x) / camera.scale;
    const wy = (sy - camera.y) / camera.scale;
    const factor = Math.exp(-e.deltaY * 0.0015); // Smooth exponential zoom.
    camera.scale = Math.min(20, Math.max(0.05, camera.scale * factor));
    camera.x = sx - wx * camera.scale; // Keep the point under the cursor fixed.
    camera.y = sy - wy * camera.scale;
    applyCamera();
  };

  const onContextMenu = (e: Event) => e.preventDefault();

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContextMenu);
  resizeToWrapper();

  let tickCount = 0;
  theApp.ticker.add(() => {
    // Delta capped: background tabs must not fast-forward the clock (DESIGN.md §5.5).
    engine.tick(Math.min(theApp.ticker.deltaMS, 100));
    drawBones();
    tickCount++;
    (window as unknown as Record<string, unknown>).__ticks = tickCount;
  });
}
