import { useEffect, useRef, useState } from 'react';
import { Application, Container, Graphics, Mesh, MeshGeometry } from 'pixi.js';
import type { AttachmentData } from '@limber/core';
import { AutoKeyMoveBoneCommand } from '../commands/animationCommands';
import { AddBoneCommand, MoveBoneCommand } from '../commands/boneCommands';
import { AddAttachmentCommand, AddTextureCommand } from '../commands/attachmentCommands';
import { AddSlotCommand } from '../commands/slotCommands';
import { PaintWeightsCommand, SetMeshVerticesCommand, vertexWeightOf } from '../commands/meshCommands';
import { textureRegistry } from '../engine/TextureRegistry';
import { CompositeCommand, type Command } from '../history/history';
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
  const [dropping, setDropping] = useState(false);

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
        (window as unknown as Record<string, unknown>).__limber = 'init-done';
        wireViewport(app, canvas, wrap, engine);
      })
      .catch((err) => console.error('Pixi init failed:', err));

    return () => {
      disposed = true;
      releaseApp(canvas);
    };
  }, [engine]);

  /**
   * Phase 4 texture import (DESIGN.md §3.5): image files land here via the
   * File API (NOT File System Access). Each drop registers the texture and,
   * when a bone is selected, creates slot + region attachment in ONE undo
   * step — the sprite immediately follows that bone.
   */
  const onDropFiles = async (e: React.DragEvent) => {
    e.preventDefault();
    setDropping(false);
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
    if (files.length === 0) return;
    const st = useEditorStore.getState();
    for (const file of files) {
      try {
        const loaded = await textureRegistry.loadFile(file);
        const boneId = st.selectedBoneId ?? engine.skeleton.data.bones[0]?.id ?? null;
        const cmds: Command[] = [new AddTextureCommand(engine, loaded.textureId, loaded.name)];
        let slotId: string | null = null;
        if (boneId) {
          const slotCmd = new AddSlotCommand(engine, boneId);
          cmds.push(
            slotCmd,
            new AddAttachmentCommand(engine, slotCmd.slotId, {
              textureId: loaded.textureId,
              x: 0,
              y: 0,
              width: loaded.width,
              height: loaded.height,
            }),
          );
          slotId = slotCmd.slotId;
        }
        st.execute(new CompositeCommand(`Drop Image ${loaded.name}`, cmds));
        if (slotId) st.selectSlot(slotId);
        else st.setStatus('Texture imported — create a bone first to attach it.');
      } catch (err) {
        st.setStatus((err as Error).message);
      }
    }
  };

  return (
    <div
      ref={wrapRef}
      className={`relative h-full w-full overflow-hidden bg-neutral-800 ${dropping ? 'ring-2 ring-inset ring-sky-400' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDropping(true);
        }
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={onDropFiles}
    >
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full touch-none" />
      <div className="pointer-events-none absolute bottom-1 left-2 text-[10px] text-neutral-500">
        drop images to attach
      </div>
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
  // Slots render BETWEEN grid and bone gizmos — sprites are the content,
  // gizmos are the overlay. zIndex follows pose.slotOrder (draw order).
  const slotsContainer = new Container({ sortableChildren: true });
  world.addChild(slotsContainer);
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

  // ---- Slot rendering (Phase 4 + Phase 5 meshes) ----
  // One Mesh per slot, reused across frames. Positions come from the pose
  // attachment cache — already WORLD-space output of the skinning step
  // (rigid or weighted LBS + deform), so the renderer never transforms
  // vertices itself and shear stays exact (§1 principle 5).

  interface SlotMesh {
    mesh: Mesh;
    /** Last attachmentId the mesh was built for (null = hidden placeholder state). */
    attachmentId: string | null;
  }

  const slotMeshes = new Map<string, SlotMesh>();
  let attachmentById = new Map<string, AttachmentData>();
  let recDataRev = -1;
  let recTexVer = -1;
  let recSkeleton: unknown = null;
  const drawPosOfSlot: number[] = [];
  const scratchPoint = { x: 0, y: 0 };

  const makeSlotMesh = (): SlotMesh => {
    const geometry = new MeshGeometry({
      positions: new Float32Array(8),
      uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    });
    const mesh = new Mesh({ geometry, texture: textureRegistry.placeholder });
    slotsContainer.addChild(mesh);
    return { mesh, attachmentId: null };
  };

  /** Syncs the mesh SET (and attachment lookup) when the document changed. */
  const reconcileSlots = (dataRev: number, texVer: number): void => {
    const data = engine.skeleton.data;
    attachmentById = new Map(data.attachments.map((a) => [a.id, a]));
    const liveIds = new Set(data.slots.map((s) => s.id));
    for (const [slotId, entry] of slotMeshes) {
      if (!liveIds.has(slotId)) {
        slotsContainer.removeChild(entry.mesh);
        entry.mesh.destroy();
        slotMeshes.delete(slotId);
      }
    }
    for (const slot of data.slots) {
      if (!slotMeshes.has(slot.id)) slotMeshes.set(slot.id, makeSlotMesh());
    }
    // Textures may have arrived (registry.version) — force re-resolution.
    for (const entry of slotMeshes.values()) entry.attachmentId = null;
    recDataRev = dataRev;
    recTexVer = texVer;
    recSkeleton = engine.skeleton;
  };

  /**
   * Per-frame slot sync: attachment switching (animated slotAttachment
   * timelines), positions straight from the skinning cache, tint/alpha, and
   * zIndex from pose.slotOrder. Allocation-free steady-state.
   */
  const updateSlotMeshes = (): void => {
    const skeleton = engine.skeleton;
    const data = skeleton.data;
    const pose = skeleton.pose;
    for (let p = 0; p < pose.slotOrder.length; p++) drawPosOfSlot[pose.slotOrder[p]!] = p;

    for (let i = 0; i < data.slots.length; i++) {
      const entry = slotMeshes.get(data.slots[i]!.id);
      if (!entry) continue;
      const slotPose = pose.slots[i]!;
      const attachment = slotPose.attachmentId ? attachmentById.get(slotPose.attachmentId) : undefined;
      const local =
        attachment === undefined ? null : attachment.type === 'mesh' ? attachment.meshVertices : attachment.vertices;

      if (slotPose.attachmentId !== entry.attachmentId) {
        entry.attachmentId = slotPose.attachmentId;
        if (attachment && local) {
          entry.mesh.texture = textureRegistry.get(attachment.textureId) ?? textureRegistry.placeholder;
          // Topology changed (vertex count / triangles): swap in fresh geometry.
          const uvs = new Float32Array(local.length);
          const srcUvs =
            attachment.type === 'region'
              ? attachment.uvs ?? [0, 0, 1, 0, 1, 1, 0, 1]
              : attachment.meshUVs ?? [];
          for (let k = 0; k < uvs.length; k++) uvs[k] = srcUvs[k] ?? 0;
          const indices =
            attachment.type === 'region'
              ? new Uint32Array([0, 1, 2, 0, 2, 3])
              : new Uint32Array(attachment.meshTriangles ?? []);
          entry.mesh.geometry.destroy();
          entry.mesh.geometry = new MeshGeometry({
            positions: new Float32Array(local.length),
            uvs,
            indices,
          });
        }
      }
      const state = attachment && local ? pose.attachments.get(attachment.id) : undefined;
      if (!attachment || !local || !state) {
        entry.mesh.visible = false;
        continue;
      }
      entry.mesh.visible = true;

      const pos = entry.mesh.geometry.positions;
      for (let k = 0; k < state.verts.length; k++) pos[k] = state.verts[k]!;
      entry.mesh.geometry.getBuffer('aPosition').update();
      const color = slotPose.color;
      entry.mesh.tint = color & 0x00ffffff;
      entry.mesh.alpha = (color >>> 24) / 255;
      entry.mesh.zIndex = drawPosOfSlot[i] ?? i;
    }
  };

  /** Attachment picking (§5.7): topmost-first point-in-quad, bones win first. */
  const pointInQuad = (v: number[], x: number, y: number): boolean => {
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const j = ((i + 1) & 3) * 2;
      const x1 = v[i * 2]!;
      const y1 = v[i * 2 + 1]!;
      const cross = (v[j]! - x1) * (y - y1) - (v[j + 1]! - y1) * (x - x1);
      const s = Math.sign(cross);
      if (s === 0) continue;
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
    return true;
  };

  const pickSlot = (wx: number, wy: number): string | null => {
    const skeleton = engine.skeleton;
    const pose = skeleton.pose;
    for (let p = pose.slotOrder.length - 1; p >= 0; p--) {
      const i = pose.slotOrder[p]!;
      const slotPose = pose.slots[i]!;
      const attachment = slotPose.attachmentId ? attachmentById.get(slotPose.attachmentId) : undefined;
      if (!attachment || attachment.type !== 'region' || !attachment.vertices) continue;
      inverseTransformPoint(
        pose.worldMatrices,
        skeleton.boneIndexMap.get(skeleton.data.slots[i]!.boneId)!,
        wx,
        wy,
        scratchPoint,
      );
      if (pointInQuad(attachment.vertices, scratchPoint.x, scratchPoint.y)) return skeleton.data.slots[i]!.id;
    }
    return null;
  };

  // ---- Mesh/weights editing (Phase 5) ----
  // Vertex handles + drag (Mesh tool) and weight painting (Weights tool) for
  // the SELECTED slot's active mesh attachment. Handles read the skinning
  // cache, so dragged vertices and painted weights update live via tick().

  const handlesG = new Graphics();
  world.addChild(handlesG); // Above bones — handles are the active edit layer.

  type MeshAttachment = AttachmentData & { type: 'mesh' };
  interface EditableMesh {
    slotIndex: number;
    attachment: MeshAttachment;
    boneIndex: number; // The slot's bone — local space of meshVertices.
  }

  const editableMesh = (): EditableMesh | null => {
    const st = useEditorStore.getState();
    if (st.activeTool !== 'mesh' && st.activeTool !== 'weights') return null;
    if (!st.selectedSlotId) return null;
    const skeleton = engine.skeleton;
    const slotIndex = skeleton.slotIndexMap.get(st.selectedSlotId);
    if (slotIndex === undefined) return null;
    const attId = skeleton.pose.slots[slotIndex]!.attachmentId;
    if (!attId) return null;
    const attachment = skeleton.attachmentById.get(attId);
    if (!attachment || attachment.type !== 'mesh' || !attachment.meshVertices) return null;
    return {
      slotIndex,
      attachment: attachment as MeshAttachment,
      boneIndex: skeleton.boneIndexMap.get(skeleton.data.slots[slotIndex]!.boneId)!,
    };
  };

  const drawHandles = () => {
    handlesG.clear();
    const st = useEditorStore.getState();
    const ed = editableMesh();
    if (!ed) return;
    const state = engine.skeleton.pose.attachments.get(ed.attachment.id);
    if (!state) return;
    const r = 4.5 / camera.scale;
    // Weights tool colors vertices by influence toward the selected bone.
    const targetIndex =
      st.activeTool === 'weights' && st.selectedBoneId
        ? engine.skeleton.boneIndexMap.get(st.selectedBoneId)
        : undefined;
    const count = ed.attachment.meshVertices!.length / 2;
    for (let k = 0; k < count; k++) {
      let color = 0x9cc7ff;
      if (targetIndex !== undefined) {
        const t = vertexWeightOf(ed.attachment.weights, k, targetIndex);
        const mix = (lo: number, hi: number): number => Math.round(lo + (hi - lo) * t);
        color =
          t <= 0
            ? 0x4a5a70
            : (mix(0x9c, 0xff) << 16) | (mix(0xc7, 0x50) << 8) | mix(0xff, 0x40);
      }
      handlesG.circle(state.verts[k * 2]!, state.verts[k * 2 + 1]!, r).fill({ color });
    }
  };

  const pickVertex = (wx: number, wy: number): number => {
    const ed = editableMesh();
    if (!ed) return -1;
    const state = engine.skeleton.pose.attachments.get(ed.attachment.id);
    if (!state) return -1;
    const radius = 12 / camera.scale;
    let best = -1;
    let bestD = radius * radius;
    for (let k = 0; k < state.verts.length / 2; k++) {
      const dx = state.verts[k * 2]! - wx;
      const dy = state.verts[k * 2 + 1]! - wy;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    return best;
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
  let meshDragCmd: SetMeshVerticesCommand | null = null;
  let paintCmd: PaintWeightsCommand | null = null;
  let dragVertex = -1;

  const paintAt = (vertexIndex: number): void => {
    const st = useEditorStore.getState();
    const ed = editableMesh();
    if (!ed || !paintCmd || !st.selectedBoneId) return;
    const boneIndex = engine.skeleton.boneIndexMap.get(st.selectedBoneId);
    if (boneIndex === undefined) return;
    paintCmd.update(vertexIndex, boneIndex, ed.boneIndex, 0.35);
  };

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

    // Mesh/weights tools edit the selected slot's mesh — no bone picking.
    if (st.activeTool === 'mesh' || st.activeTool === 'weights') {
      const ed = editableMesh();
      if (!ed) {
        st.setStatus('Select a slot showing a mesh attachment (or create one: Properties → Grid mesh).');
        return;
      }
      const v = pickVertex(wp.x, wp.y);
      if (v < 0) return;
      if (st.activeTool === 'mesh') {
        meshDragCmd = new SetMeshVerticesCommand(engine, ed.attachment.id);
        meshDragCmd.open();
        dragVertex = v;
      } else {
        if (!st.selectedBoneId) {
          st.setStatus('Pick the bone to paint toward (click it in the hierarchy).');
          return;
        }
        paintCmd = new PaintWeightsCommand(engine, ed.attachment.id);
        paintCmd.open();
        dragVertex = v;
        paintAt(v); // Immediate dab on press.
      }
      canvas.style.cursor = 'crosshair';
      return;
    }

    if (st.activeTool === 'create_bone') {
      const hitId = pickBone(wp.x, wp.y); // Child of the hit bone, else a new root.
      const local = parentLocalOf(hitId, wp.x, wp.y);
      const cmd = new AddBoneCommand(engine, hitId, local);
      st.execute(cmd);
      st.select(cmd.boneId);
      return;
    }

    const hitId = pickBone(wp.x, wp.y);
    if (hitId) {
      st.select(hitId);
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
    } else {
      // No bone under the cursor — attachments pick second (§5.7 priority).
      st.selectSlot(pickSlot(wp.x, wp.y));
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
    if (meshDragCmd && dragVertex >= 0) {
      // Drag writes BONE-LOCAL positions — the skinning step lifts them to
      // world space next tick, so the handle follows the cursor exactly.
      const ed = editableMesh();
      if (ed) {
        inverseTransformPoint(engine.skeleton.pose.worldMatrices, ed.boneIndex, wp.x, wp.y, scratchPoint);
        meshDragCmd.update(dragVertex, scratchPoint.x, scratchPoint.y);
      }
      return;
    }
    if (paintCmd) {
      const v = pickVertex(wp.x, wp.y);
      if (v >= 0) {
        dragVertex = v;
        paintAt(v);
      }
      return;
    }
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
    if (st.activeTool === 'mesh' || st.activeTool === 'weights') {
      canvas.style.cursor = pickVertex(wp.x, wp.y) >= 0 ? 'crosshair' : 'default';
      return;
    }
    const hit = pickBone(wp.x, wp.y);
    if (st.hoveredBoneId !== hit) st.setHover(hit);
    canvas.style.cursor = hit ? 'grab' : pickSlot(wp.x, wp.y) !== null ? 'pointer' : 'default';
  };

  const onPointerUp = (e: PointerEvent) => {
    if (panning && e.button === 1) {
      panning = false;
      return;
    }
    const st = useEditorStore.getState();
    if (meshDragCmd) {
      meshDragCmd.commit();
      if (meshDragCmd.changed) st.execute(meshDragCmd); // One history entry per drag.
      meshDragCmd = null;
      dragVertex = -1;
    }
    if (paintCmd) {
      paintCmd.commit();
      if (paintCmd.changed) st.execute(paintCmd); // One history entry per stroke.
      paintCmd = null;
      dragVertex = -1;
    }
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

    const st = useEditorStore.getState();
    if (st.dataRevision !== recDataRev || textureRegistry.version !== recTexVer || recSkeleton !== engine.skeleton) {
      reconcileSlots(st.dataRevision, textureRegistry.version);
    }
    updateSlotMeshes();
    drawBones();
    drawHandles();

    tickCount++;
    const w = window as unknown as Record<string, unknown>;
    w.__ticks = tickCount;
    // Test hooks for the smoke suite: how many slot meshes render + where the
    // first one sits (skeleton space) so "sprite follows bone" is assertable.
    w.__slotMeshes = slotsContainer.children.length;
    const first = slotsContainer.children[0] as Mesh | undefined;
    w.__slotMesh0 = first && first.visible ? [first.geometry.positions[0], first.geometry.positions[1]] : null;
    w.__slotMeshVerts0 = first && first.visible ? first.geometry.positions.length / 2 : 0;
  });
}
