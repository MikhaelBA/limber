import { useEffect, useRef, useState } from 'react';
import { Application, Container, Graphics, Mesh, MeshGeometry, UPDATE_PRIORITY } from 'pixi.js';
import type { AttachmentData } from '@limber/core';
import {
  evaluateMarkers,
  applyTimeline,
  resetPose,
  Skeleton,
  solveFK,
  solveConstraints,
  updateSkinning,
  worldToAttachmentVertex,
  createSkinningStats,
} from '@limber/core';
import {
  AutoKeyBonePropCommand,
  AutoKeyDeformCommand,
  AutoKeyMoveBoneCommand,
} from '../commands/animationCommands';
import {
  AddBoneCommand,
  DragBoneLengthCommand,
  DragBoneTransformCommand,
  MoveBoneCommand,
} from '../commands/boneCommands';
import { AddAttachmentCommand, AddTextureCommand } from '../commands/attachmentCommands';
import { AddSlotCommand } from '../commands/slotCommands';
import {
  AddMeshVertexCommand,
  CreateHullMeshCommand,
  meshAdjacency,
  PaintWeightsCommand,
  pointInMeshHull,
  RemoveMeshVertexCommand,
  SetMeshVerticesCommand,
  vertexWeightOf,
} from '../commands/meshCommands';
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
/** Watchdog interval per wired app — cleared when the app is destroyed. */
const renderWatchdogs = new WeakMap<Application, ReturnType<typeof setInterval>>();
const viewportCleanups = new WeakMap<Application, () => void>();

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
        current.ready.then((app) => {
          const watchdog = renderWatchdogs.get(app);
          if (watchdog !== undefined) clearInterval(watchdog);
          viewportCleanups.get(app)?.();
          app.destroy(false, { children: true });
        }).catch(() => {});
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
  // Ghost outlines sit UNDER the content (onion skin), slots above them.
  const ghostG = new Graphics();
  world.addChild(ghostG);
  // Slots render BETWEEN grid and bone gizmos — sprites are the content,
  // gizmos are the overlay. zIndex follows pose.slotOrder (draw order).
  const slotsContainer = new Container({ sortableChildren: true });
  world.addChild(slotsContainer);
  // Untextured polygon gizmos (bounding boxes, clipping) + the clip mask.
  const shapesG = new Graphics();
  world.addChild(shapesG);
  const clipMasks = new Map<string, Graphics>();
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
    renderNow();
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
    // IK reach lines: chain tip → target, for constraints touching the selection.
    for (const c of data.ikConstraints) {
      if (st.selectedBoneId !== c.targetId && !(st.selectedBoneId && c.bones.includes(st.selectedBoneId))) continue;
      const endIdx = engine.skeleton.boneIndexMap.get(c.bones[c.bones.length - 1]!);
      const tIdx = engine.skeleton.boneIndexMap.get(c.targetId);
      if (endIdx === undefined || tIdx === undefined) continue;
      const e = endIdx * 6;
      const endBone = data.bones[endIdx]!;
      const tipX = wm[e]! * endBone.length + wm[e + 4]!;
      const tipY = wm[e + 1]! * endBone.length + wm[e + 5]!;
      const t = tIdx * 6;
      bonesG.setStrokeStyle({ width: 1.5 / s, color: 0xffc247, alpha: 0.85 });
      bonesG.moveTo(tipX, tipY).lineTo(wm[t + 4]!, wm[t + 5]!).stroke();
      bonesG.setStrokeStyle({ width: 2 / s, color: 0xffc247, alpha: 0.95 });
      bonesG.circle(wm[t + 4]!, wm[t + 5]!, 6 / s).stroke();
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
    sourceUvs?: number[];
    sourceTriangles?: number[];
    textureVersion?: number;
    textureId?: string;
  }

  const slotMeshes = new Map<string, SlotMesh>();
  let attachmentById = new Map<string, AttachmentData>();
  let recDataRev = -1;
  let recTexVer = -1;
  let recSkeleton: unknown = null;
  let recWorldMatrices: Float32Array | null = null;
  let geometryBuilds = 0;
  let ghostBuilds = 0;
  const drawPosOfSlot: number[] = [];
  const scratchPoint = { x: 0, y: 0 };

  // Input feedback must not depend on rAF or drop the final event in a burst.
  // Only the ticker advances playback; input redraws the current pose.
  const renderNow = (): void => {
    updateViewport(0);
    theApp.render();
  };

  // ---- Ghosting (onion skin, Phase 8) ----
  // Evaluates the CURRENT animation at offset times on a scratch skeleton and
  // strokes attachment hulls: past = blue, future = orange. Animate mode only.
  let ghostSkeleton: Skeleton | null = null;
  let ghostDrawn = 0;

  const evaluateGhostAt = (t: number): void => {
    const gs = ghostSkeleton;
    if (!gs) return;
    const data = engine.skeleton.data;
    resetPose(data, gs.pose);
    const anim = engine.currentAnimation;
    if (anim) {
      for (const tl of anim.timelines) applyTimeline(tl, gs, t, t, 1, null, anim.name);
    }
    solveFK(data, gs.boneIndexMap, gs.pose);
    solveConstraints(gs);
    updateSkinning(gs);
  };

  const strokeGhost = (color: number, alpha: number): void => {
    const gs = ghostSkeleton;
    if (!gs) return;
    const data = engine.skeleton.data;
    const s = camera.scale;
    ghostG.setStrokeStyle({ width: 1.25 / s, color, alpha });
    for (let i = 0; i < data.slots.length; i++) {
      const attId = gs.pose.slots[i]!.attachmentId;
      if (!attId) continue;
      const attachment = gs.attachmentById.get(attId);
      const state = gs.pose.attachments.get(attId);
      if (!attachment || !state || state.verts.length < 4) continue;
      const n = state.verts.length / 2;
      const ring =
        attachment.type === 'mesh' &&
        attachment.meshVertices &&
        attachment.meshVertices.length / 2 === n &&
        attachment.meshHull &&
        attachment.meshHull.length >= 3
          ? attachment.meshHull
          : null;
      ghostG.moveTo(state.verts[0]!, state.verts[1]!);
      if (ring) {
        for (let k = 0; k < ring.length; k++) {
          const idx = ring[k]!;
          ghostG.lineTo(state.verts[idx * 2]!, state.verts[idx * 2 + 1]!);
        }
      } else {
        for (let k = 1; k < n; k++) ghostG.lineTo(state.verts[k * 2]!, state.verts[k * 2 + 1]!);
      }
      ghostG.lineTo(state.verts[0]!, state.verts[1]!).stroke();
    }
  };

  const drawGhosts = (): void => {
    ghostG.clear();
    ghostDrawn = 0;
    const st = useEditorStore.getState();
    if (!st.ghostingEnabled || st.mode !== 'animate' || !engine.currentAnimation || !ghostSkeleton) return;
    const duration = engine.currentAnimation.duration;
    const step = 1 / 12; // ~2 frames at 24fps.
    const count = 3;
    for (let i = 1; i <= count; i++) {
      const before = engine.currentTime - i * step;
      const after = engine.currentTime + i * step;
      if (before >= 0) {
        evaluateGhostAt(before);
        strokeGhost(0x5b8def, 0.42 - i * 0.09);
        ghostDrawn++;
      }
      if (after <= duration + 1e-6) {
        evaluateGhostAt(after);
        strokeGhost(0xef8b5b, 0.42 - i * 0.09);
        ghostDrawn++;
      }
    }
  };

  const makeSlotMesh = (): SlotMesh => {
    geometryBuilds++;
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
    for (const [slotId, mask] of clipMasks) {
      if (!liveIds.has(slotId)) {
        world.removeChild(mask);
        mask.destroy();
        clipMasks.delete(slotId);
      }
    }
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
    // Weight/property edits share source data with the existing ghost evaluator.
    // Only a new rig or structural pose allocation requires rebuilding its maps/caches.
    if (recSkeleton !== engine.skeleton || recWorldMatrices !== engine.skeleton.pose.worldMatrices) {
      ghostSkeleton = new Skeleton(data);
      ghostBuilds++;
      recWorldMatrices = engine.skeleton.pose.worldMatrices;
    }
    recDataRev = dataRev;
    recTexVer = texVer;
    recSkeleton = engine.skeleton;
  };

  /**
   * Per-frame slot sync: attachment switching (animated slotAttachment
   * timelines), positions straight from the skinning cache, tint/alpha, and
   * zIndex from pose.slotOrder. Allocation-free steady-state. Untextured
   * polygon attachments (boundingBox/clipping) render via `shapesG` instead.
   */
  const updateSlotMeshes = (): void => {
    const skeleton = engine.skeleton;
    const data = skeleton.data;
    const pose = skeleton.pose;
    for (let p = 0; p < pose.slotOrder.length; p++) drawPosOfSlot[pose.slotOrder[p]!] = p;

    shapesG.clear();
    for (const mask of clipMasks.values()) mask.clear();
    let activeClip: { attachment: AttachmentData; mask: Graphics } | null = null;

    for (const i of pose.slotOrder) {
      const entry = slotMeshes.get(data.slots[i]!.id);
      if (!entry) continue;
      const slotPose = pose.slots[i]!;
      const attachment = slotPose.attachmentId ? attachmentById.get(slotPose.attachmentId) : undefined;
      const isTextured = attachment !== undefined && (attachment.type === 'region' || attachment.type === 'mesh');
      const local = attachment === undefined || !isTextured ? null : attachment.type === 'mesh' ? attachment.meshVertices : attachment.vertices;
      const state = attachment ? pose.attachments.get(attachment.id) : undefined;

      // Entering the end slot releases the active clip (Spine semantics).
      if (activeClip && data.slots[i]!.id === activeClip.attachment.endSlotId) activeClip = null;

      if (attachment && state && attachment.type === 'clipping') {
        drawPolygonOutline(attachment, state.verts, 0xb45bef, 0.85);
        const slotId = data.slots[i]!.id;
        let mask = clipMasks.get(slotId);
        if (!mask) {
          mask = new Graphics();
          mask.includeInBuild = false;
          clipMasks.set(slotId, mask);
          world.addChild(mask);
        }
        updateClipMask(mask, state.verts);
        activeClip = { attachment, mask };
      } else if (attachment && state && attachment.type === 'boundingBox') {
        drawPolygonOutline(attachment, state.verts, 0xe6d55a, 0.9);
      }

      const attachmentChanged = slotPose.attachmentId !== entry.attachmentId;
      if (attachmentChanged || entry.textureVersion !== textureRegistry.version || entry.textureId !== attachment?.textureId) {
        entry.attachmentId = slotPose.attachmentId;
        if (attachment && isTextured && local) {
          entry.mesh.texture = textureRegistry.get(attachment.textureId) ?? textureRegistry.placeholder;
          entry.textureVersion = textureRegistry.version;
          entry.textureId = attachment.textureId;
        }
      }
      const sourceUvs = attachment?.type === 'region' ? attachment.uvs : attachment?.meshUVs;
      const sourceTriangles = attachment?.type === 'mesh' ? attachment.meshTriangles : undefined;
      if (attachment && isTextured && local && (attachmentChanged ||
          entry.sourceUvs !== sourceUvs || entry.sourceTriangles !== sourceTriangles ||
          entry.mesh.geometry.positions.length !== local.length)) {
        // Topology changed (vertex count / triangles): swap in fresh geometry.
        geometryBuilds++;
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
        entry.sourceUvs = sourceUvs;
        entry.sourceTriangles = sourceTriangles;
      }

      if (!attachment || !isTextured || !local || !state) {
        entry.mesh.visible = false;
        entry.mesh.mask = null;
        continue;
      }
      entry.mesh.visible = true;

      const pos = entry.mesh.geometry.positions;
      for (let k = 0; k < state.verts.length; k++) pos[k] = state.verts[k]!;
      entry.mesh.geometry.getBuffer('aPosition').update();
      const color = slotPose.color;
      entry.mesh.tint = color >>> 8;
      entry.mesh.alpha = (color & 0xff) / 255;
      entry.mesh.blendMode = data.slots[i]!.blendMode === 'add' ? 'add' : 'normal';
      entry.mesh.zIndex = drawPosOfSlot[i] ?? i;

      // World-space polygon mask (mask + meshes share the `world` container's
      // local space, so the skinning cache coords line up exactly).
      if (activeClip) {
        entry.mesh.mask = activeClip.mask;
      } else {
        entry.mesh.mask = null;
      }
    }
    for (const mask of clipMasks.values()) mask.includeInBuild = false;
  };

  const updateClipMask = (clipMask: Graphics, verts: Float32Array): void => {
    const n = verts.length / 2;
    if (n < 3) return;
    clipMask.clear();
    clipMask.moveTo(verts[0]!, verts[1]!);
    for (let k = 1; k < n; k++) clipMask.lineTo(verts[k * 2]!, verts[k * 2 + 1]!);
    clipMask.lineTo(verts[0]!, verts[1]!).fill({ color: 0xffffff });
  };

  /** Closed polygon outline (bounding boxes / clipping gizmos). */
  const drawPolygonOutline = (
    attachment: AttachmentData,
    verts: Float32Array,
    color: number,
    alpha: number,
  ): void => {
    const n = verts.length / 2;
    if (n < 2) return;
    const ring = attachment.meshHull && attachment.meshHull.length >= 2 ? attachment.meshHull : null;
    shapesG.setStrokeStyle({ width: 1.5 / camera.scale, color, alpha });
    shapesG.moveTo(verts[0]!, verts[1]!);
    if (ring) {
      for (let k = 0; k < ring.length; k++) {
        const idx = ring[k]!;
        shapesG.lineTo(verts[idx * 2]!, verts[idx * 2 + 1]!);
      }
    } else {
      for (let k = 1; k < n; k++) shapesG.lineTo(verts[k * 2]!, verts[k * 2 + 1]!);
    }
    shapesG.lineTo(verts[0]!, verts[1]!).stroke();
  };

  /** Attachment picking (§5.7): topmost-first region/mesh hit test, bones win first. */
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
      if (!attachment || (slotPose.color & 0xff) === 0) continue;
      if (attachment.type === 'mesh') {
        const state = pose.attachments.get(attachment.id);
        if (state && pointInMeshHull({
          meshVertices: Array.from(state.verts), meshHull: attachment.meshHull,
        }, wx, wy)) return skeleton.data.slots[i]!.id;
        continue;
      }
      if (attachment.type !== 'region' || !attachment.vertices) continue;
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

  const markersG = new Graphics();
  world.addChild(markersG);
  const drawMarkers = () => {
    markersG.clear();
    for (const sampler of engine.skeleton.pathSamplers.values()) {
      const wm=engine.skeleton.pose.worldMatrices,o=engine.skeleton.boneIndexMap.get(sampler.path.boneId)!*6;
      const points=sampler.points;
      markersG.setStrokeStyle({width:1.5/camera.scale,color:0x47ddbb,alpha:0.8});
      for (let i=0;i<points.length;i+=2) {
        const x=wm[o]!*points[i]!+wm[o+2]!*points[i+1]!+wm[o+4]!,y=wm[o+1]!*points[i]!+wm[o+3]!*points[i+1]!+wm[o+5]!;
        if(i===0)markersG.moveTo(x,y);else markersG.lineTo(x,y);
      }
      markersG.stroke();
    }
    const evaluated = evaluateMarkers(engine.skeleton.data, engine.skeleton.pose, engine.skeleton.boneIndexMap);
    for (const { marker, world: matrix, outline } of evaluated) {
      const color = marker.kind === 'hitbox' ? 0xff6878 : marker.kind === 'hurtbox' ? 0x7aa8ff : 0x47ddbb;
      const x = matrix[4], y = matrix[5], r = 5 / camera.scale;
      markersG.setStrokeStyle({ width: 1.5 / camera.scale, color });
      markersG.moveTo(x - r, y).lineTo(x + r, y).moveTo(x, y - r).lineTo(x, y + r).stroke();
      // The short local X axis exposes orientation/reflection as well as position.
      markersG.moveTo(x, y).lineTo(x + matrix[0] * 15, y + matrix[1] * 15).stroke();
      if (outline.length) {
        markersG.moveTo(outline[0]!, outline[1]!);
        for (let i = 2; i < outline.length; i += 2) markersG.lineTo(outline[i]!, outline[i + 1]!);
        markersG.closePath().stroke();
      }
    }
    (window as unknown as Record<string, unknown>).__markers = evaluated.map(({ marker, world: matrix, outline }) => ({ id: marker.id, world: matrix, outline }));
  };
  const handlesG = new Graphics();
  world.addChild(handlesG); // Above bones — handles are the active edit layer.

  type MeshAttachment = AttachmentData & { type: 'mesh' | 'boundingBox' | 'clipping' };
  type RegionAttachment = AttachmentData & { type: 'region' };
  interface EditableMesh {
    slotIndex: number;
    attachment: MeshAttachment;
    boneIndex: number; // The slot's bone — local space of meshVertices.
  }
  interface EditableRegion {
    slotIndex: number;
    attachment: RegionAttachment;
    boneIndex: number;
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
    if (!attachment || !attachment.meshVertices) return null; // Any polygon-bearing attachment.
    if (attachment.type !== 'mesh' && attachment.type !== 'boundingBox' && attachment.type !== 'clipping') return null;
    return {
      slotIndex,
      attachment: attachment as MeshAttachment,
      boneIndex: skeleton.boneIndexMap.get(skeleton.data.slots[slotIndex]!.boneId)!,
    };
  };

  /** Mesh tool over a REGION — the slot enters hull-drawing mode instead. */
  const editableRegion = (): EditableRegion | null => {
    const st = useEditorStore.getState();
    if (st.activeTool !== 'mesh') return null;
    if (!st.selectedSlotId) return null;
    const skeleton = engine.skeleton;
    const slotIndex = skeleton.slotIndexMap.get(st.selectedSlotId);
    if (slotIndex === undefined) return null;
    const attId = skeleton.pose.slots[slotIndex]!.attachmentId;
    if (!attId) return null;
    const attachment = skeleton.attachmentById.get(attId);
    if (!attachment || attachment.type !== 'region' || !attachment.vertices) return null;
    return {
      slotIndex,
      attachment: attachment as RegionAttachment,
      boneIndex: skeleton.boneIndexMap.get(skeleton.data.slots[slotIndex]!.boneId)!,
    };
  };

  // ---- Hull drawing (mesh tool over a region attachment) ----
  // Bone-local points of the hull being drawn; slotId/boneIndex captured at the
  // first click so switching selection mid-draw can't corrupt the conversion.
  let hullPts: number[] | null = null;
  let hullSlotId: string | null = null;
  let hullBoneIndex = -1;
  /** Latest pointer position in world space (brush circle / hull rubber band). */
  let mouseWorld: { x: number; y: number } | null = null;

  const closeHull = (): void => {
    const pts = hullPts;
    const slotId = hullSlotId;
    hullPts = null;
    hullSlotId = null;
    hullBoneIndex = -1;
    if (!pts || !slotId) return;
    const st = useEditorStore.getState();
    const usingSkin = engine.skeleton.data.activeSkin !== '';
    try {
      st.execute(new CreateHullMeshCommand(engine, slotId, pts, usingSkin ? 'skin' : 'default'));
      st.setStatus('Hull mesh created — drag vertices, double-click inside to add one, Alt+click to delete.');
    } catch (err) {
      st.setStatus((err as Error).message);
    }
  };

  /**
   * Capture-phase so Esc/Enter during a hull draw don't ALSO trigger the global
   * shortcuts (tool switching): stopPropagation from window-capture blocks the
   * later bubble-phase listener on window.
   */
  const onHullKey = (e: KeyboardEvent): void => {
    if (!hullPts) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (e.key === 'Escape') {
      hullPts = null;
      hullSlotId = null;
      hullBoneIndex = -1;
      useEditorStore.getState().setStatus('Hull drawing cancelled.');
      e.stopImmediatePropagation();
      e.preventDefault();
      renderNow();
    } else if (e.key === 'Enter') {
      closeHull();
      e.stopImmediatePropagation();
      e.preventDefault();
      renderNow();
    }
  };
  window.addEventListener('keydown', onHullKey, true);

  const drawHandles = () => {
    handlesG.clear();
    const st = useEditorStore.getState();
    if (createDrag && mouseWorld) {
      handlesG.setStrokeStyle({ width: 2 / camera.scale, color: 0xffa028 });
      handlesG.moveTo(createWx, createWy).lineTo(mouseWorld.x, mouseWorld.y).stroke();
      handlesG.circle(createWx, createWy, 3.5 / camera.scale).fill({ color: 0xffa028 });
    }
    const ed = editableMesh();
    if (ed) {
      const state = engine.skeleton.pose.attachments.get(ed.attachment.id);
      if (state) {
        const s = camera.scale;
        const count = ed.attachment.meshVertices!.length / 2;
        // Triangulation wireframe first (world-space, from the skinning cache)
        // — makes the mesh's structure visible and obviously editable, like
        // Spine's mesh tool. Skipped for bbox/clipping polygons (no triangles).
        const tris = ed.attachment.meshTriangles ?? [];
        if (tris.length >= 3) {
          handlesG.setStrokeStyle({
            width: 1 / s,
            color: st.activeTool === 'weights' ? 0x4a5a70 : 0x9cc7ff,
            alpha: 0.55,
          });
          for (let t = 0; t < tris.length; t += 3) {
            const a = tris[t]! * 2;
            const b = tris[t + 1]! * 2;
            const c = tris[t + 2]! * 2;
            handlesG
              .moveTo(state.verts[a]!, state.verts[a + 1]!)
              .lineTo(state.verts[b]!, state.verts[b + 1]!)
              .lineTo(state.verts[c]!, state.verts[c + 1]!)
              .lineTo(state.verts[a]!, state.verts[a + 1]!)
              .stroke();
          }
        }
        const r = 4.5 / s;
        // Weights tool colors vertices by influence toward the selected bone.
        const targetIndex =
          st.activeTool === 'weights' && st.weightBoneId
            ? engine.skeleton.boneIndexMap.get(st.weightBoneId)
            : undefined;
        for (let k = 0; k < count; k++) {
          let color = 0x9cc7ff;
          if (targetIndex !== undefined) {
            const t = vertexWeightOf(ed.attachment.weights, k, targetIndex, ed.boneIndex);
            const mix = (lo: number, hi: number): number => Math.round(lo + (hi - lo) * t);
            color =
              t <= 0
                ? 0x4a5a70
                : (mix(0x9c, 0xff) << 16) | (mix(0xc7, 0x50) << 8) | mix(0xff, 0x40);
          }
          handlesG.circle(state.verts[k * 2]!, state.verts[k * 2 + 1]!, r).fill({ color });
        }
      }
    }

    // Hull-in-progress: placed points + rubber band to the cursor.
    if (hullPts && hullBoneIndex >= 0 && mouseWorld) {
      const wm = engine.skeleton.pose.worldMatrices;
      const o = hullBoneIndex * 6;
      const toWorld = (i: number): { x: number; y: number } => ({
        x: wm[o]! * hullPts![i]! + wm[o + 2]! * hullPts![i + 1]! + wm[o + 4]!,
        y: wm[o + 1]! * hullPts![i]! + wm[o + 3]! * hullPts![i + 1]! + wm[o + 5]!,
      });
      const n = hullPts.length / 2;
      const s = camera.scale;
      handlesG.setStrokeStyle({ width: 1.5 / s, color: 0x35d0a5 });
      const first = toWorld(0);
      handlesG.moveTo(first.x, first.y);
      for (let i = 1; i < n; i++) {
        const p = toWorld(i * 2);
        handlesG.lineTo(p.x, p.y);
      }
      handlesG.lineTo(mouseWorld.x, mouseWorld.y).stroke();
      for (let i = 0; i < n; i++) {
        const p = toWorld(i * 2);
        handlesG.circle(p.x, p.y, 4 / s).fill({ color: i === 0 ? 0xffa028 : 0x35d0a5 });
      }
      if (n >= 3) {
        // Closable: ring the first vertex as the "click here to finish" affordance.
        handlesG.setStrokeStyle({ width: 2 / s, color: 0xffa028, alpha: 0.9 });
        handlesG.circle(first.x, first.y, 9 / s).stroke();
      }
    }

    // Weight brush radius follows the cursor.
    if (st.activeTool === 'weights' && mouseWorld) {
      handlesG.setStrokeStyle({ width: 1.25 / camera.scale, color: 0xffffff, alpha: 0.35 });
      handlesG.circle(mouseWorld.x, mouseWorld.y, st.brushRadius).stroke();
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

  /** World point through the INVERSE of a raw 6-float affine [a,b,c,d,tx,ty]. */
  const inverseOf = (m: ArrayLike<number>, wx: number, wy: number, out: { x: number; y: number }): void => {
    const det = m[0]! * m[3]! - m[1]! * m[2]!;
    const dx = wx - m[4]!;
    const dy = wy - m[5]!;
    out.x = (m[3]! * dx - m[2]! * dy) / det;
    out.y = (m[0]! * dy - m[1]! * dx) / det;
  };

  // ---- Pointer interaction ----
  let panning = false;
  let lastPX = 0;
  let lastPY = 0;
  let moveCmd: MoveBoneCommand | null = null;
  let autoKeyCmd: AutoKeyMoveBoneCommand | null = null;
  let dragBoneId: string | null = null;
  let meshDragCmd: SetMeshVerticesCommand | null = null;
  let deformDragCmd: AutoKeyDeformCommand | null = null;
  let paintCmd: PaintWeightsCommand | null = null;
  let dragVertex = -1;

  // Transform-tool drags (spine-tools semantics).
  type DragKind = 'translate' | 'rotate' | 'scale' | 'shear' | 'length' | 'create' | null;
  let dragKind: DragKind = null;
  let setupDragCmd: DragBoneTransformCommand | null = null;
  let lengthDragCmd: DragBoneLengthCommand | null = null;
  let propKeyCmd: AutoKeyBonePropCommand | null = null; // animate: rotation / shearX / scaleX
  let propKeyCmd2: AutoKeyBonePropCommand | null = null; // animate: scaleY (scale tool)
  let grabAngle = 0;
  let startRotation = 0;
  let startSx = 1;
  let startSy = 1;
  let startShear = 0;
  let grabDist = 1;
  /** The dragged bone's world matrix at shear-grab (a stable reference frame). */
  const grabWorld = new Float64Array(6);
  const grabLocalPt = { x: 0, y: 0 };
  /** Empty-space grabs: a plain click DESELECTS, a drag adjusts (Spine). */
  let emptyGrab = false;
  let downWp = { x: 0, y: 0 };
  let createDrag: { parentId: string | null; lx: number; ly: number } | null = null;
  let createWx = 0;
  let createWy = 0;

  const isTransformTool = (t: string): boolean =>
    t === 'translate' || t === 'rotate' || t === 'scale' || t === 'shear';

  /** The bone's CURRENT local value — the animated pose in Animate mode, setup otherwise. */
  const currentLocalOf = (boneId: string, prop: 'rotation' | 'scaleX' | 'scaleY' | 'shearX'): number => {
    const idx = engine.skeleton.boneIndexMap.get(boneId)!;
    if (useEditorStore.getState().mode === 'animate') return engine.skeleton.pose.bones[idx]!.local[prop];
    return engine.skeleton.data.bones[idx]!.setupPose[prop];
  };

  const worldOriginOf = (idx: number): { x: number; y: number } => {
    const o = idx * 6;
    return { x: engine.skeleton.pose.worldMatrices[o + 4]!, y: engine.skeleton.pose.worldMatrices[o + 5]! };
  };

  const parentWorldAngleOf = (boneId: string): number => {
    const parentId = engine.skeleton.data.bones.find((b) => b.id === boneId)?.parentId ?? null;
    if (parentId === null) return 0;
    const p = engine.skeleton.boneIndexMap.get(parentId)! * 6;
    return Math.atan2(engine.skeleton.pose.worldMatrices[p + 1]!, engine.skeleton.pose.worldMatrices[p]!);
  };

  /** One brush dab: every vertex inside brushRadius, smoothstep-falloff scaled. */
  const paintStrokeAt = (wx: number, wy: number): void => {
    const st = useEditorStore.getState();
    const ed = editableMesh();
    if (!ed || !paintCmd || !st.weightBoneId) return;
    const boneIndex = engine.skeleton.boneIndexMap.get(st.weightBoneId);
    if (boneIndex === undefined) return;
    const state = engine.skeleton.pose.attachments.get(ed.attachment.id);
    if (!state) return;
    const r = st.brushRadius;
    const r2 = r * r;
    for (let k = 0; k < state.verts.length / 2; k++) {
      const dx = state.verts[k * 2]! - wx;
      const dy = state.verts[k * 2 + 1]! - wy;
      const d2 = dx * dx + dy * dy;
      if (d2 >= r2) continue;
      const t = 1 - Math.sqrt(d2) / r; // 1 at center → 0 at the rim.
      const falloff = t * t * (3 - 2 * t); // smoothstep
      try { paintCmd.update(k, boneIndex, ed.boneIndex, falloff * st.brushStrength, st.brushMode); } catch (error) { st.setStatus((error as Error).message); return; }
    }
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
    mouseWorld = wp;

    // Mesh tool: over a region → hull drawing; over a mesh → vertex editing.
    if (st.activeTool === 'mesh') {
      if (!editableRegion() && !editableMesh()) {
        st.selectSlot(pickSlot(wp.x, wp.y));
      }
      const reg = editableRegion();
      if (reg) {
        inverseTransformPoint(engine.skeleton.pose.worldMatrices, reg.boneIndex, wp.x, wp.y, scratchPoint);
        if (!hullPts) {
          hullPts = [scratchPoint.x, scratchPoint.y];
          hullSlotId = st.selectedSlotId;
          hullBoneIndex = reg.boneIndex;
          st.setStatus('Placing hull vertices — click the first vertex (or Enter) to finish, Esc to cancel.');
        } else {
          const n = hullPts.length / 2;
          const o = hullBoneIndex * 6;
          const wm = engine.skeleton.pose.worldMatrices;
          const fx = wm[o]! * hullPts[0]! + wm[o + 2]! * hullPts[1]! + wm[o + 4]!;
          const fy = wm[o + 1]! * hullPts[0]! + wm[o + 3]! * hullPts[1]! + wm[o + 5]!;
          if (n >= 3 && Math.hypot(wp.x - fx, wp.y - fy) < 12 / camera.scale) closeHull();
          else hullPts.push(scratchPoint.x, scratchPoint.y);
        }
        return;
      }
      const ed = editableMesh();
      if (!ed) {
        st.setStatus('Select a slot showing a region (draw a hull) or a mesh (edit vertices) — or Properties → Grid mesh.');
        return;
      }
      const v = pickVertex(wp.x, wp.y);
      if (e.altKey) {
        // Alt+click deletes a vertex (hull or interior; never below 3 total).
        if (v >= 0) { try { st.execute(new RemoveMeshVertexCommand(engine, ed.attachment.id, v)); } catch (error) { st.setStatus((error as Error).message); } }
        return;
      }
      if (v < 0) return;
      if (st.mode === 'animate' && engine.currentAnimation) {
        // Animate mode: the drag writes a DEFORM key at the playhead (§5.6).
        deformDragCmd = new AutoKeyDeformCommand(engine, ed.attachment.id);
        deformDragCmd.open();
        dragVertex = v;
        try {
          worldToAttachmentVertex(ed.attachment, ed.boneIndex, engine.skeleton.pose.worldMatrices, engine.skeleton.pose.attachments.get(ed.attachment.id)!, v, wp.x, wp.y, scratchPoint);
          deformDragCmd.update(v, scratchPoint.x, scratchPoint.y);
        } catch (error) { st.setStatus((error as Error).message); }
      } else {
        meshDragCmd = new SetMeshVerticesCommand(engine, ed.attachment.id);
        meshDragCmd.open();
        dragVertex = v;
      }
      canvas.style.cursor = 'crosshair';
      return;
    }

    // Weights tool: radius brush over the selected slot's mesh.
    if (st.activeTool === 'weights') {
      if (st.mode !== 'setup') {
        st.setStatus('Switch to Setup to paint weights. Animate mode preserves the mesh binding.');
        return;
      }
      const ed = editableMesh();
      if (!ed) {
        st.setStatus('Select a slot showing a mesh attachment (or create one: Properties → Grid mesh).');
        return;
      }
      if (!st.weightBoneId || !engine.skeleton.boneIndexMap.has(st.weightBoneId)) {
        st.setStatus('Choose a Paint bone in the toolbar, or click a bone in the hierarchy while the mesh is selected.');
        return;
      }
      paintCmd = new PaintWeightsCommand(engine, ed.attachment.id);
      paintCmd.open(meshAdjacency(ed.attachment.meshTriangles ?? []));
      paintStrokeAt(wp.x, wp.y); // Immediate dab on press.
      canvas.style.cursor = 'crosshair';
      return;
    }

    if (st.activeTool === 'create_bone') {
      // Spine create tool: press sets the origin; release drops the bone. A
      // plain click = default bone; a drag sets rotation + length.
      const hitId = pickBone(wp.x, wp.y); // Child of the hit bone, else a new root.
      const local = parentLocalOf(hitId, wp.x, wp.y);
      createDrag = { parentId: hitId, lx: local.x, ly: local.y };
      createWx = wp.x;
      createWy = wp.y;
      dragKind = 'create';
      return;
    }

    // ---- Transform tools (translate/rotate/scale/shear) ----
    downWp = wp;
    emptyGrab = false;

    // Tip grab (setup only): dragging the SELECTED bone's tip changes length.
    if (st.mode === 'setup' && st.selectedBoneId) {
      const idx = engine.skeleton.boneIndexMap.get(st.selectedBoneId);
      if (idx !== undefined) {
        const o = idx * 6;
        const wm = engine.skeleton.pose.worldMatrices;
        const len = engine.skeleton.data.bones[idx]!.length;
        const tipX = wm[o]! * len + wm[o + 4]!;
        const tipY = wm[o + 1]! * len + wm[o + 5]!;
        if (Math.hypot(wp.x - tipX, wp.y - tipY) < 10 / camera.scale) {
          lengthDragCmd = new DragBoneLengthCommand(engine, st.selectedBoneId);
          lengthDragCmd.open();
          dragBoneId = st.selectedBoneId;
          dragKind = 'length';
          canvas.style.cursor = 'ew-resize';
          return;
        }
      }
    }

    const hitId = pickBone(wp.x, wp.y);
    const hitSlotId = hitId ? null : pickSlot(wp.x, wp.y);
    if (hitSlotId) {
      st.selectSlot(hitSlotId);
      return;
    }
    // Spine: dragging in EMPTY SPACE adjusts the selected item; clicking empty
    // space deselects (resolved at pointerup by movement).
    const targetId = hitId ?? (isTransformTool(st.activeTool) ? st.selectedBoneId : null);
    if (targetId) {
      if (hitId) st.select(hitId);
      emptyGrab = hitId === null;
      dragBoneId = targetId;
      const idx = engine.skeleton.boneIndexMap.get(targetId)!;
      const o = idx * 6;
      const origin = worldOriginOf(idx);
      const animate = st.mode === 'animate' && engine.currentAnimation;
      const tool = st.activeTool;

      if (tool === 'translate') {
        dragKind = 'translate';
        // Animate mode: drags write keyframes at the playhead (auto-key §5.6).
        // Setup mode: drags edit the rig's setup pose.
        if (animate) {
          autoKeyCmd = new AutoKeyMoveBoneCommand(engine, targetId);
          autoKeyCmd.open();
        } else {
          moveCmd = new MoveBoneCommand(engine, targetId);
          moveCmd.open();
        }
      } else if (tool === 'rotate') {
        dragKind = 'rotate';
        grabAngle = Math.atan2(wp.y - origin.y, wp.x - origin.x);
        startRotation = currentLocalOf(targetId, 'rotation');
        if (animate) {
          propKeyCmd = new AutoKeyBonePropCommand(engine, targetId, 'rotation');
          propKeyCmd.open();
        } else {
          setupDragCmd = new DragBoneTransformCommand(engine, targetId, ['rotation']);
          setupDragCmd.open();
        }
      } else if (tool === 'scale') {
        dragKind = 'scale';
        grabDist = Math.max(1e-3, Math.hypot(wp.x - origin.x, wp.y - origin.y));
        startSx = currentLocalOf(targetId, 'scaleX');
        startSy = currentLocalOf(targetId, 'scaleY');
        if (animate) {
          propKeyCmd = new AutoKeyBonePropCommand(engine, targetId, 'scaleX');
          propKeyCmd.open();
          propKeyCmd2 = new AutoKeyBonePropCommand(engine, targetId, 'scaleY');
          propKeyCmd2.open();
        } else {
          setupDragCmd = new DragBoneTransformCommand(engine, targetId, ['scaleX', 'scaleY']);
          setupDragCmd.open();
        }
      } else {
        // shear: drag skews along the bone's x-axis (shearX).
        dragKind = 'shear';
        const wm = engine.skeleton.pose.worldMatrices;
        for (let k = 0; k < 6; k++) grabWorld[k] = wm[o + k]!;
        inverseOf(grabWorld, wp.x, wp.y, scratchPoint);
        grabLocalPt.x = scratchPoint.x;
        grabLocalPt.y = scratchPoint.y;
        startShear = currentLocalOf(targetId, 'shearX');
        if (animate) {
          propKeyCmd = new AutoKeyBonePropCommand(engine, targetId, 'shearX');
          propKeyCmd.open();
        } else {
          setupDragCmd = new DragBoneTransformCommand(engine, targetId, ['shearX']);
          setupDragCmd.open();
        }
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
    mouseWorld = wp;
    if (meshDragCmd && dragVertex >= 0) {
      // Drag writes BONE-LOCAL positions — the skinning step lifts them to
      // world space next tick, so the handle follows the cursor exactly.
      const ed = editableMesh();
      if (ed) {
        try {
          worldToAttachmentVertex(ed.attachment, ed.boneIndex, engine.skeleton.pose.worldMatrices, engine.skeleton.pose.attachments.get(ed.attachment.id)!, dragVertex, wp.x, wp.y, scratchPoint);
          meshDragCmd.update(dragVertex, scratchPoint.x, scratchPoint.y);
        } catch (error) { useEditorStore.getState().setStatus((error as Error).message); }
      }
      return;
    }
    if (deformDragCmd && dragVertex >= 0) {
      const ed = editableMesh();
      if (ed) {
        try {
          worldToAttachmentVertex(ed.attachment, ed.boneIndex, engine.skeleton.pose.worldMatrices, engine.skeleton.pose.attachments.get(ed.attachment.id)!, dragVertex, wp.x, wp.y, scratchPoint);
          deformDragCmd.update(dragVertex, scratchPoint.x, scratchPoint.y);
        } catch (error) { useEditorStore.getState().setStatus((error as Error).message); }
      }
      return;
    }
    if (paintCmd) {
      paintStrokeAt(wp.x, wp.y);
      return;
    }
    if (dragKind === 'length' && lengthDragCmd && dragBoneId) {
      const idx = engine.skeleton.boneIndexMap.get(dragBoneId)!;
      const o = idx * 6;
      const wm = engine.skeleton.pose.worldMatrices;
      // Project the cursor onto the bone's world x-axis.
      const len = (wp.x - wm[o + 4]!) * wm[o]! + (wp.y - wm[o + 5]!) * wm[o + 1]!;
      lengthDragCmd.set(len);
      return;
    }
    if (dragKind === 'rotate' && dragBoneId) {
      const origin = worldOriginOf(engine.skeleton.boneIndexMap.get(dragBoneId)!);
      let target = startRotation + (Math.atan2(wp.y - origin.y, wp.x - origin.x) - grabAngle);
      if (e.shiftKey) {
        // Spine: shift constrains rotation to 15° increments (world space).
        const parentAngle = parentWorldAngleOf(dragBoneId);
        const snapped = Math.round((parentAngle + target) / (Math.PI / 12)) * (Math.PI / 12);
        target = snapped - parentAngle;
      }
      if (setupDragCmd) setupDragCmd.set('rotation', target);
      else propKeyCmd?.set(target);
      return;
    }
    if (dragKind === 'scale' && dragBoneId) {
      const origin = worldOriginOf(engine.skeleton.boneIndexMap.get(dragBoneId)!);
      const r = Math.hypot(wp.x - origin.x, wp.y - origin.y) / grabDist;
      if (setupDragCmd) {
        setupDragCmd.set('scaleX', startSx * r);
        setupDragCmd.set('scaleY', startSy * r);
      } else {
        propKeyCmd?.set(startSx * r);
        propKeyCmd2?.set(startSy * r);
      }
      return;
    }
    if (dragKind === 'shear' && dragBoneId) {
      inverseOf(grabWorld, wp.x, wp.y, scratchPoint);
      const len = Math.max(engine.skeleton.data.bones.find((b) => b.id === dragBoneId)!.length, 20);
      const target = Math.max(
        -1.4,
        Math.min(1.4, startShear + (scratchPoint.x - grabLocalPt.x) / len),
      );
      if (setupDragCmd) setupDragCmd.set('shearX', target);
      else propKeyCmd?.set(target);
      return;
    }
    if (dragKind === 'create' && createDrag) {
      return; // Length/rotation resolve at pointerup.
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
      const overVertex = pickVertex(wp.x, wp.y) >= 0;
      const overRegion = st.activeTool === 'mesh' && editableRegion() !== null;
      canvas.style.cursor = overVertex || overRegion || hullPts ? 'crosshair' : 'default';
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
    const wpUp = screenToWorld(e);
    if (meshDragCmd) {
      meshDragCmd.commit();
      if (meshDragCmd.changed) st.execute(meshDragCmd); // One history entry per drag.
      meshDragCmd = null;
      dragVertex = -1;
    }
    if (deformDragCmd) {
      deformDragCmd.commit();
      if (deformDragCmd.changed) st.execute(deformDragCmd);
      deformDragCmd = null;
      dragVertex = -1;
    }
    if (paintCmd) {
      paintCmd.commit();
      if (paintCmd.changed) st.execute(paintCmd); // One history entry per stroke.
      paintCmd = null;
      dragVertex = -1;
    }
    if (dragKind === 'create' && createDrag) {
      const dx = wpUp.x - createWx;
      const dy = wpUp.y - createWy;
      const dragged = Math.hypot(dx, dy) > 6 / camera.scale;
      let cmd: AddBoneCommand;
      if (dragged) {
        // Local rotation = drag angle minus the parent's world angle.
        let parentAngle = 0;
        if (createDrag.parentId !== null) {
          const p = engine.skeleton.boneIndexMap.get(createDrag.parentId)! * 6;
          const wm = engine.skeleton.pose.worldMatrices;
          parentAngle = Math.atan2(wm[p + 1]!, wm[p]!);
        }
        cmd = new AddBoneCommand(engine, createDrag.parentId, { x: createDrag.lx, y: createDrag.ly }, {
          rotation: Math.atan2(dy, dx) - parentAngle,
          length: Math.hypot(dx, dy),
        });
      } else {
        cmd = new AddBoneCommand(engine, createDrag.parentId, { x: createDrag.lx, y: createDrag.ly });
      }
      st.execute(cmd);
      st.select(cmd.boneId);
      createDrag = null;
      dragKind = null;
    }
    if (lengthDragCmd) {
      lengthDragCmd.commit();
      if (lengthDragCmd.changed) st.execute(lengthDragCmd);
      lengthDragCmd = null;
      dragKind = null;
      dragBoneId = null;
    }
    if (setupDragCmd || propKeyCmd) {
      // Empty-space grab without movement = DESELECT (Spine), not an edit.
      const moved = Math.hypot(wpUp.x - downWp.x, wpUp.y - downWp.y) > 3 / camera.scale;
      if (setupDragCmd) {
        setupDragCmd.commit();
        if (moved && setupDragCmd.changed) st.execute(setupDragCmd);
      }
      if (propKeyCmd) {
        propKeyCmd.commit();
        if (moved && propKeyCmd.changed) st.execute(propKeyCmd);
      }
      if (propKeyCmd2) {
        propKeyCmd2.commit();
        if (moved && propKeyCmd2.changed) st.execute(propKeyCmd2);
      }
      if (emptyGrab && !moved) st.clearSelection();
      setupDragCmd = null;
      propKeyCmd = null;
      propKeyCmd2 = null;
      dragKind = null;
      dragBoneId = null;
    }
    if (moveCmd || autoKeyCmd) {
      if (emptyGrab) {
        const moved = Math.hypot(wpUp.x - downWp.x, wpUp.y - downWp.y) > 3 / camera.scale;
        if (!moved) st.clearSelection();
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
      dragKind = null;
    }
    dragBoneId = null;
    emptyGrab = false;
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

  const onContextMenu = (e: Event) => {
    e.preventDefault();
    // Spine: right click toggles between the current and last used tool. During
    // hull drawing it cancels the hull instead.
    if (hullPts) {
      hullPts = null;
      hullSlotId = null;
      hullBoneIndex = -1;
      useEditorStore.getState().setStatus('Hull drawing cancelled.');
      return;
    }
    useEditorStore.getState().toggleLastTool();
  };

  /** Double-click: mesh tool adds an interior vertex; transform tools deselect. */
  const onDoubleClick = (e: MouseEvent): void => {
    const st = useEditorStore.getState();
    if (st.activeTool === 'mesh') {
      const ed = editableMesh();
      if (!ed) return;
      const wp = screenToWorld(e);
      if (pickVertex(wp.x, wp.y) >= 0) return; // On a vertex — that's a drag, not an add.
      inverseTransformPoint(engine.skeleton.pose.worldMatrices, ed.boneIndex, wp.x, wp.y, scratchPoint);
      if (!pointInMeshHull(ed.attachment, scratchPoint.x, scratchPoint.y)) return;
      try { st.execute(new AddMeshVertexCommand(engine, ed.attachment.id, scratchPoint.x, scratchPoint.y)); } catch (error) { st.setStatus((error as Error).message); }
      return;
    }
    if (isTransformTool(st.activeTool)) st.clearSelection(); // Spine: dblclick deselects.
  };

  let tickCount = 0;
  let lastTickAt = performance.now();
  // Bounded opt-in browser evidence. Normal playback allocates no profiling records.
  type RigFrame = { coreMs: number; viewportMs: number; vertexTransforms: number;
    bindMatrixProducts: number; vertices: number; attachments: number; maskedMeshes: number };
  type RigCapture = { limit: number; frames: (RigFrame & { cpuMs: number; timestamp: number })[] };
  let measuredFrame: RigFrame | null = null;
  let measuredCapture: RigCapture | null = null;
  let measuredStart = 0;
  let measuredStats: ReturnType<typeof createSkinningStats> | undefined;
  const updateViewport = (deltaMS: number): void => {
    const capture = (window as unknown as { __rigFrameMetrics?: RigCapture }).__rigFrameMetrics;
    const recording = deltaMS > 0 && capture && capture.frames.length < Math.min(600, capture.limit);
    measuredFrame = null;
    if (recording) {
      measuredCapture = capture;
      measuredStart = performance.now();
      measuredStats ??= createSkinningStats();
    }
    engine.tick(deltaMS, recording ? measuredStats : undefined);
    const coreMs = recording ? performance.now() - measuredStart : 0;

    const st = useEditorStore.getState();
    if (st.dataRevision !== recDataRev || textureRegistry.version !== recTexVer || recSkeleton !== engine.skeleton) {
      reconcileSlots(st.dataRevision, textureRegistry.version);
    }
    updateSlotMeshes();
    drawGhosts();
    drawBones();
    drawMarkers();
    drawHandles();

    tickCount++;
    const w = window as unknown as Record<string, unknown>;
    w.__ticks = tickCount;
    // Test hooks for the smoke suite: how many slot meshes render + where the
    // first one sits (skeleton space) so "sprite follows bone" is assertable.
    w.__slotMeshes = slotsContainer.children.length;
    w.__rigGeometryBuilds = geometryBuilds;
    w.__rigGhostBuilds = ghostBuilds;
    const first = slotsContainer.children[0] as Mesh | undefined;
    w.__slotMesh0 = first && first.visible ? [first.geometry.positions[0], first.geometry.positions[1]] : null;
    w.__slotMeshVerts0 = first && first.visible ? first.geometry.positions.length / 2 : 0;
    // Total deform keyframes across all animations (deform auto-key smoke).
    let deformKeys = 0;
    let eventKeys = 0;
    for (const anim of engine.document.animations) {
      for (const tl of anim.timelines) {
        if (tl.kind === 'deform') deformKeys += tl.keyframes.length;
        else if (tl.kind === 'event') eventKeys += tl.keyframes.length;
      }
    }
    w.__deformKeyframes = deformKeys;
    w.__eventKeys = eventKeys;
    // Event dispatch during playback: surface fired events on the status bar.
    if (deltaMS > 0 && engine.lastEvents.length > 0) {
      const names = engine.lastEvents.map((e) => e.eventName).join(', ');
      useEditorStore.getState().setStatus(`⚡ ${names}`);
    }
    // Camera transform for the smoke suite. page.mouse coordinates are PAGE-
    // relative while camera.x/y are canvas-relative — include the rect offset.
    w.__worldToScreen = (x: number, y: number): [number, number] => {
      const r = canvas.getBoundingClientRect();
      return [r.left + x * camera.scale + camera.x, r.top + y * camera.scale + camera.y];
    };
    // Ghosts drawn last frame (ghosting smoke assertion).
    w.__ghostCount = ghostDrawn;
    // Root bone world angle + origin (IK-follows-target smoke assertion).
    w.__boneAngle0 = Math.atan2(
      engine.skeleton.pose.worldMatrices[1]!,
      engine.skeleton.pose.worldMatrices[0]!,
    );
    w.__boneOrigin0 = [
      engine.skeleton.pose.worldMatrices[4]!,
      engine.skeleton.pose.worldMatrices[5]!,
    ];
    // First IK constraint's target world position (drag source in smoke).
    const ik0 = engine.skeleton.data.ikConstraints[0];
    if (ik0) {
      const ti = engine.skeleton.boneIndexMap.get(ik0.targetId);
      w.__ikTarget0 = ti !== undefined
        ? [engine.skeleton.pose.worldMatrices[ti * 6 + 4]!, engine.skeleton.pose.worldMatrices[ti * 6 + 5]!]
        : null;
    } else {
      w.__ikTarget0 = null;
    }
    if (recording) measuredFrame = {
      coreMs, viewportMs: performance.now() - measuredStart,
      vertices: measuredStats!.vertices, attachments: measuredStats!.attachments,
      vertexTransforms: measuredStats!.vertexTransforms, bindMatrixProducts: measuredStats!.bindMatrixProducts,
      maskedMeshes: [...slotMeshes.values()].filter((entry) => entry.mesh.visible && entry.mesh.mask).length,
    };
  };
  theApp.ticker.add(() => {
    lastTickAt = performance.now();
    // Background tabs must not fast-forward playback.
    updateViewport(Math.min(theApp.ticker.deltaMS, 100));
  });
  // Pixi submits rendering at LOW; UTILITY observes completion of CPU submission.
  // GPU completion is asynchronous and is intentionally outside cpuMs.
  theApp.ticker.add(() => {
    if (measuredFrame && measuredCapture) {
      const timestamp = performance.now();
      measuredCapture.frames.push({ ...measuredFrame, timestamp, cpuMs: timestamp - measuredStart });
      measuredFrame = null;
    }
  }, undefined, UPDATE_PRIORITY.UTILITY);

  // rAF-frozen webviews (observed in the in-app browser: 0 frames in 2.5s
  // while visibility reports "visible") leave the canvas on its very first
  // frame — the user edits and sees NOTHING change. Throttled timers still
  // fire there (~1fps), so a watchdog pumps the ticker whenever rAF stalls.
  // When rAF is healthy, lastTickAt stays fresh and the watchdog is a no-op.
  const watchdog = setInterval(() => {
    const now = performance.now();
    if (now - lastTickAt > 250) theApp.ticker.update(now);
  }, 120);
  renderWatchdogs.set(theApp, watchdog);

  const afterInput = <E extends Event,>(handler: (event: E) => void) => (event: E) => {
    handler(event);
    renderNow();
  };
  const down = afterInput(onPointerDown);
  const move = afterInput(onPointerMove);
  const up = afterInput(onPointerUp);
  const cancel = afterInput((e: PointerEvent) => {
    // Keep completed edits undoable, but don't create a bone on cancellation.
    createDrag = null;
    panning = false;
    onPointerUp(e);
  });
  const doubleClick = afterInput(onDoubleClick);
  const wheel = afterInput(onWheel);
  const contextMenu = afterInput(onContextMenu);
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', cancel);
  canvas.addEventListener('dblclick', doubleClick);
  canvas.addEventListener('wheel', wheel, { passive: false });
  canvas.addEventListener('contextmenu', contextMenu);

  // Inspector edits, undo/redo and tool changes also need immediate feedback.
  // Defer until the complete command/selection update has finished.
  let disposed = false;
  let queued = false;
  const unsubscribe = useEditorStore.subscribe((state, previous) => {
    if (Object.keys(state).every((key) => key === 'statusMessage' ||
          state[key as keyof typeof state] === previous[key as keyof typeof previous])) return;
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (!disposed) renderNow();
    });
  });
  viewportCleanups.set(theApp, () => {
    disposed = true;
    unsubscribe();
    resizeObserver.disconnect();
    window.removeEventListener('keydown', onHullKey, true);
    canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', up);
    canvas.removeEventListener('pointercancel', cancel);
    canvas.removeEventListener('dblclick', doubleClick);
    canvas.removeEventListener('wheel', wheel);
    canvas.removeEventListener('contextmenu', contextMenu);
  });
  resizeToWrapper();
}
