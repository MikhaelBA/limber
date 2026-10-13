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
  attachmentTriangleOrder,
  pathWeightAttachment,
  weightAttachment,
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
import { useWeightEditingStore, weightColor } from '../store/weightEditingStore';
import { brushFalloff, weightNeighbors } from '@limber/mesh';
import {
  DirectWeightsCommand,
  weightContext,
  pasteWeights,
  weightWorldVertices,
} from '../commands/weightEditingCommands';
import { BindMeshCommand } from '../commands/bindMeshCommand';
import { WeightVisuals } from './WeightVisuals';
import { angleStep, inverseVector, projectedLength, unit } from '../math/rigGesture';
import { drawRigBone, drawRigGizmo, pickRigHandle, rigGizmo, type RigHandle } from './RigVisuals';

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
        current.ready
          .then((app) => {
            const watchdog = renderWatchdogs.get(app);
            if (watchdog !== undefined) clearInterval(watchdog);
            viewportCleanups.get(app)?.();
            app.destroy(false, { children: true });
          })
          .catch(() => {});
      }
    });
  }
}

export function ViewportCanvas() {
  const engine = useEngine();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dropping, setDropping] = useState(false);
  const mode = useEditorStore((s) => s.mode);
  const options = useEditorStore((s) => s.viewOptions[s.mode]);
  const toggleViewOption = useEditorStore((s) => s.toggleViewOption);

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
      <div
        className="absolute left-2 top-2 flex items-center gap-2 rounded bg-neutral-950/80 px-2 py-1 text-xs"
        aria-label="Viewport display"
      >
        <span className="text-neutral-400">
          {mode === 'setup' ? 'Setup · rig & mesh' : 'Animate · keys at playhead'}
        </span>
        {(['grid', 'bones'] as const).map((option) => (
          <button
            key={option}
            aria-pressed={options[option]}
            onClick={() => toggleViewOption(option)}
            className={options[option] ? 'text-sky-300' : 'text-neutral-500'}
          >
            {option === 'grid' ? 'Grid' : 'Bones'}
          </button>
        ))}
      </div>
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
    if (!st.viewOptions[st.mode].bones) return;
    const data = engine.skeleton.data;
    const wm = engine.skeleton.pose.worldMatrices;
    const s = camera.scale;
    for (let i = 0; i < data.bones.length; i++) {
      const bone = data.bones[i]!;
      if (
        st.mode === 'animate' &&
        st.activeTool !== 'weights' &&
        bone.id !== st.selectedBoneId &&
        bone.id !== st.hoveredBoneId
      )
        continue;
      const o = i * 6;
      const ox = wm[o + 4]!;
      const oy = wm[o + 5]!;
      const len = bone.length;
      const tx = wm[o]! * len + ox;
      const ty = wm[o + 1]! * len + oy;
      const color =
        st.activeTool === 'weights' && (st.selectedSlotId || useWeightEditingStore.getState().pathId)
          ? (() => {
              const slotIndex = st.selectedSlotId ? engine.skeleton.slotIndexMap.get(st.selectedSlotId)! : -1;
              const id = engine.skeleton.pose.slots[slotIndex]?.attachmentId;
              const geometry = id
                ? engine.skeleton.attachmentById.get(id)
                : weightAttachment(data, useWeightEditingStore.getState().pathId!);
              const index = geometry?.boneBindings?.findIndex((b) => b.boneId === bone.id);
              return index !== undefined && index >= 0 ? weightColor(index) : 0x555555;
            })()
          : st.selectedBoneId === bone.id
            ? 0xffa028
            : st.hoveredBoneId === bone.id
              ? 0x9cc7ff
              : (bone.color ?? 0x64db85);
      drawRigBone(bonesG, { x: ox, y: oy }, { x: tx, y: ty }, s, color, st.selectedBoneId === bone.id);
    }
    // IK reach lines: chain tip → target, for constraints touching the selection.
    for (const c of data.ikConstraints) {
      if (st.selectedBoneId !== c.targetId && !(st.selectedBoneId && c.bones.includes(st.selectedBoneId)))
        continue;
      const endIdx = engine.skeleton.boneIndexMap.get(c.bones[c.bones.length - 1]!);
      const tIdx = engine.skeleton.boneIndexMap.get(c.targetId);
      if (endIdx === undefined || tIdx === undefined) continue;
      const e = endIdx * 6;
      const endBone = data.bones[endIdx]!;
      const tipX = wm[e]! * endBone.length + wm[e + 4]!;
      const tipY = wm[e + 1]! * endBone.length + wm[e + 5]!;
      const t = tIdx * 6;
      bonesG.setStrokeStyle({ width: 1.5 / s, color: 0xffc247, alpha: 0.85 });
      bonesG
        .moveTo(tipX, tipY)
        .lineTo(wm[t + 4]!, wm[t + 5]!)
        .stroke();
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
      if (!useEditorStore.getState().viewOptions[useEditorStore.getState().mode].bones) return null;
      const len = data.bones[i]!.length;
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
    orderedTriangles?: number[];
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
      const isTextured =
        attachment !== undefined && (attachment.type === 'region' || attachment.type === 'mesh');
      const local =
        attachment === undefined || !isTextured
          ? null
          : attachment.type === 'mesh'
            ? attachment.meshVertices
            : attachment.vertices;
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
      if (
        attachmentChanged ||
        entry.textureVersion !== textureRegistry.version ||
        entry.textureId !== attachment?.textureId
      ) {
        entry.attachmentId = slotPose.attachmentId;
        if (attachment && isTextured && local) {
          entry.mesh.texture = textureRegistry.get(attachment.textureId) ?? textureRegistry.placeholder;
          entry.textureVersion = textureRegistry.version;
          entry.textureId = attachment.textureId;
        }
      }
      const sourceUvs = attachment?.type === 'region' ? attachment.uvs : attachment?.meshUVs;
      const sourceTriangles = attachment?.type === 'mesh' ? attachment.meshTriangles : undefined;
      if (
        attachment &&
        isTextured &&
        local &&
        (attachmentChanged ||
          entry.sourceUvs !== sourceUvs ||
          entry.sourceTriangles !== sourceTriangles ||
          entry.mesh.geometry.positions.length !== local.length)
      ) {
        // Topology changed (vertex count / triangles): swap in fresh geometry.
        geometryBuilds++;
        const uvs = new Float32Array(local.length);
        const srcUvs =
          attachment.type === 'region'
            ? (attachment.uvs ?? [0, 0, 1, 0, 1, 1, 0, 1])
            : (attachment.meshUVs ?? []);
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
      if (attachment.type === 'mesh') {
        const ordered = attachmentTriangleOrder(attachment, skeleton);
        if (ordered !== entry.orderedTriangles) {
          entry.mesh.geometry.indices = new Uint32Array(ordered);
          entry.orderedTriangles = ordered;
        }
      }

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
      if (attachment.meshVertices) {
        const state = pose.attachments.get(attachment.id);
        if (
          state &&
          pointInMeshHull(
            {
              meshVertices: Array.from(state.verts),
              meshHull: attachment.meshHull,
              meshTriangles: attachment.meshTriangles,
            },
            wx,
            wy,
          )
        )
          return skeleton.data.slots[i]!.id;
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
      const wm = engine.skeleton.pose.worldMatrices,
        o = engine.skeleton.boneIndexMap.get(sampler.path.boneId)! * 6;
      sampler.updateMetric(wm, o);
      const points = sampler.points;
      markersG.setStrokeStyle({ width: 1.5 / camera.scale, color: 0x47ddbb, alpha: 0.8 });
      for (let i = 0; i < points.length; i += 2) {
        const x = sampler.path.weights
            ? points[i]!
            : wm[o]! * points[i]! + wm[o + 2]! * points[i + 1]! + wm[o + 4]!,
          y = sampler.path.weights
            ? points[i + 1]!
            : wm[o + 1]! * points[i]! + wm[o + 3]! * points[i + 1]! + wm[o + 5]!;
        if (i === 0) markersG.moveTo(x, y);
        else markersG.lineTo(x, y);
      }
      markersG.stroke();
    }
    const evaluated = evaluateMarkers(
      engine.skeleton.data,
      engine.skeleton.pose,
      engine.skeleton.boneIndexMap,
    );
    for (const { marker, world: matrix, outline } of evaluated) {
      const color = marker.kind === 'hitbox' ? 0xff6878 : marker.kind === 'hurtbox' ? 0x7aa8ff : 0x47ddbb;
      const x = matrix[4],
        y = matrix[5],
        r = 5 / camera.scale;
      markersG.setStrokeStyle({ width: 1.5 / camera.scale, color });
      markersG
        .moveTo(x - r, y)
        .lineTo(x + r, y)
        .moveTo(x, y - r)
        .lineTo(x, y + r)
        .stroke();
      // The short local X axis exposes orientation/reflection as well as position.
      markersG
        .moveTo(x, y)
        .lineTo(x + matrix[0] * 15, y + matrix[1] * 15)
        .stroke();
      if (outline.length) {
        markersG.moveTo(outline[0]!, outline[1]!);
        for (let i = 2; i < outline.length; i += 2) markersG.lineTo(outline[i]!, outline[i + 1]!);
        markersG.closePath().stroke();
      }
    }
    (window as unknown as Record<string, unknown>).__markers = evaluated.map(
      ({ marker, world: matrix, outline }) => ({ id: marker.id, world: matrix, outline }),
    );
  };
  const handlesG = new Graphics();
  const weightVisuals = new WeightVisuals();
  world.addChild(weightVisuals.container);
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
    const path =
      st.activeTool === 'weights' && !st.selectedSlotId
        ? engine.skeleton.data.paths?.find((p) => p.id === useWeightEditingStore.getState().pathId)
        : undefined;
    if (path)
      return {
        slotIndex: -1,
        attachment: pathWeightAttachment(path) as MeshAttachment,
        boneIndex: engine.skeleton.boneIndexMap.get(path.boneId)!,
      };
    if (!st.selectedSlotId) return null;
    const skeleton = engine.skeleton;
    const slotIndex = skeleton.slotIndexMap.get(st.selectedSlotId);
    if (slotIndex === undefined) return null;
    const attId = skeleton.pose.slots[slotIndex]!.attachmentId;
    if (!attId) return null;
    const attachment = skeleton.attachmentById.get(attId);
    if (!attachment || !attachment.meshVertices) return null; // Any polygon-bearing attachment.
    if (attachment.type !== 'mesh' && attachment.type !== 'boundingBox' && attachment.type !== 'clipping')
      return null;
    return {
      slotIndex,
      attachment: attachment as MeshAttachment,
      boneIndex: skeleton.boneIndexMap.get(skeleton.data.slots[slotIndex]!.boneId)!,
    };
  };

  /** Mesh tool over a REGION — the slot enters hull-drawing mode instead. */
  const editableRegion = (): EditableRegion | null => {
    const st = useEditorStore.getState();
    if (st.activeTool !== 'mesh' || st.mode !== 'setup') return null;
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
    if (st.mode !== 'setup') {
      st.setStatus('Create mesh topology in Setup.');
      return;
    }
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
    const t = e.target as HTMLElement | null;
    if (
      t &&
      (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
    )
      return;
    const st = useEditorStore.getState(),
      ui = useWeightEditingStore.getState();
    if (e.key === 'Escape' && dragKind) {
      cancelBoneGesture();
      e.preventDefault();
      e.stopImmediatePropagation();
      renderNow();
      return;
    }
    if (st.activeTool === 'weights') {
      const ed = editableMesh(),
        key = e.key.toLowerCase(),
        modifier = e.ctrlKey || e.metaKey;
      let handled = true;
      try {
        if ((key === 'escape' || key === ' ') && ui.binding) {
          if (ed && (st.selectedSlotId || ui.pathId) && ui.bones.length)
            st.execute(
              new BindMeshCommand(engine, ed.attachment.id, st.selectedSlotId ?? ui.pathId!, ui.bones, true),
            );
          ui.patch({ binding: false });
        } else if (key === 'escape' || key === ' ') ui.setVertices([]);
        else if (modifier && key === 'a' && ed)
          ui.setVertices(Array.from({ length: ed.attachment.meshVertices!.length / 2 }, (_, i) => i));
        else if (modifier && key === 'c' && ed) {
          const context = weightContext(engine, ed.attachment.id);
          if (!ui.vertices.length) throw new Error('Select vertices to copy weights.');
          ui.patch({
            clipboard: {
              rows: ui.vertices.map((v) =>
                context.rows[v]!.map((item) => ({
                  boneId: engine.skeleton.data.bones[item.boneIndex]!.id,
                  weight: item.weight,
                })),
              ),
            },
          });
          st.setStatus(`Copied ${ui.vertices.length} vertex weights.`);
        } else if (modifier && key === 'v' && ed && ui.clipboard)
          st.execute(pasteWeights(engine, ed.attachment.id, ui.vertices, ui.clipboard.rows));
        else handled = false;
      } catch (error) {
        st.setStatus((error as Error).message);
      }
      if (handled) {
        e.stopImmediatePropagation();
        e.preventDefault();
        renderNow();
        return;
      }
    }
    if (!hullPts) return;
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

  let selectionTopology: {
    attachment: AttachmentData;
    triangles: number[] | undefined;
    hull: number[] | undefined;
    count: number;
    edges: [number, number][];
  } | null = null;
  const drawHandles = () => {
    handlesG.clear();
    weightVisuals.hide();
    const st = useEditorStore.getState();
    // Selection is an editor overlay, independent of Bone/Grid visibility and tool.
    // Read posed vertices so the outline follows weighted deformation and clip switches.
    const selectedIndex = st.selectedSlotId ? engine.skeleton.slotIndexMap.get(st.selectedSlotId) : undefined;
    const selectedPose = selectedIndex === undefined ? undefined : engine.skeleton.pose.slots[selectedIndex];
    const selectedAttachment = selectedPose?.attachmentId
      ? attachmentById.get(selectedPose.attachmentId)
      : undefined;
    const selectedVerts = selectedAttachment
      ? engine.skeleton.pose.attachments.get(selectedAttachment.id)?.verts
      : undefined;
    if (selectedAttachment && selectedVerts && selectedVerts.length >= 4) {
      if (
        selectionTopology?.attachment !== selectedAttachment ||
        selectionTopology.triangles !== selectedAttachment.meshTriangles ||
        selectionTopology.hull !== selectedAttachment.meshHull ||
        selectionTopology.count !== selectedVerts.length
      ) {
        const edges: [number, number][] = [];
        if (selectedAttachment.type === 'mesh' && !selectedAttachment.meshHull?.length) {
          // Interior triangle edges are not part of the visible selection boundary.
          const counts = new Map<string, { a: number; b: number; count: number }>();
          const triangles = selectedAttachment.meshTriangles ?? [];
          for (let i = 0; i < triangles.length; i += 3)
            for (let j = 0; j < 3; j++) {
              const a = triangles[i + j]!,
                b = triangles[i + ((j + 1) % 3)]!;
              const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
              const edge = counts.get(key);
              if (edge) edge.count++;
              else counts.set(key, { a, b, count: 1 });
            }
          for (const edge of counts.values()) if (edge.count === 1) edges.push([edge.a, edge.b]);
        } else {
          const ring = selectedAttachment.meshHull?.length
            ? selectedAttachment.meshHull
            : Array.from({ length: selectedVerts.length / 2 }, (_, i) => i);
          for (let i = 0; i < ring.length; i++) edges.push([ring[i]!, ring[(i + 1) % ring.length]!]);
        }
        selectionTopology = {
          attachment: selectedAttachment,
          triangles: selectedAttachment.meshTriangles,
          hull: selectedAttachment.meshHull,
          count: selectedVerts.length,
          edges,
        };
      }
      for (const [width, color] of [
        [5, 0x16191e],
        [2, 0xffbe45],
      ]) {
        for (const [a, b] of selectionTopology.edges)
          handlesG
            .moveTo(selectedVerts[a * 2]!, selectedVerts[a * 2 + 1]!)
            .lineTo(selectedVerts[b * 2]!, selectedVerts[b * 2 + 1]!);
        handlesG.stroke({ width: width! / camera.scale, color: color! });
      }
    }
    const gizmo = selectedGizmo();
    if (gizmo && st.viewOptions[st.mode].bones) drawRigGizmo(handlesG, gizmo, camera.scale, st.activeTool);
    const length = selectedLengthHandle();
    if (length && st.viewOptions[st.mode].bones)
      handlesG
        .rect(length.x - 3 / camera.scale, length.y - 3 / camera.scale, 6 / camera.scale, 6 / camera.scale)
        .fill({ color: 0xffbe45 })
        .stroke({ color: 0x16191e, width: 1 / camera.scale });
    if (createDrag && mouseWorld) {
      const dragged =
        Math.hypot(mouseWorld.x - createDrag.down.x, mouseWorld.y - createDrag.down.y) > 6 / camera.scale;
      handlesG.setStrokeStyle({ width: 2 / camera.scale, color: 0xffa028 });
      if (dragged) handlesG.moveTo(createWx, createWy).lineTo(mouseWorld.x, mouseWorld.y).stroke();
      handlesG.circle(createWx, createWy, 3.5 / camera.scale).fill({ color: 0xffa028 });
    }
    const ed = editableMesh();
    if (ed) {
      const state =
        ed.slotIndex < 0
          ? { verts: weightWorldVertices(engine, ed.attachment.id) }
          : engine.skeleton.pose.attachments.get(ed.attachment.id);
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
        if (st.activeTool === 'weights') {
          const hull = ed.attachment.meshHull ?? [];
          handlesG.setStrokeStyle({ width: 1.5 / s, color: 0x35d0d5 });
          for (let i = 0; i < hull.length; i++) {
            const a = hull[i]! * 2,
              b = hull[(i + 1) % hull.length]! * 2;
            handlesG
              .moveTo(state.verts[a]!, state.verts[a + 1]!)
              .lineTo(state.verts[b]!, state.verts[b + 1]!)
              .stroke();
          }
          handlesG.setStrokeStyle({ width: 1 / s, color: 0xff9d48, alpha: 0.65 });
          const edges = ed.attachment.weightEdges ?? [];
          for (let i = 0; i < edges.length; i += 2) {
            const a = edges[i]! * 2,
              b = edges[i + 1]! * 2;
            handlesG
              .moveTo(state.verts[a]!, state.verts[a + 1]!)
              .lineTo(state.verts[b]!, state.verts[b + 1]!)
              .stroke();
          }
        }
        if (st.activeTool === 'weights')
          weightVisuals.draw(handlesG, ed.attachment, engine.skeleton, state.verts, ed.boneIndex, s);
        // Weights tool colors vertices by influence toward the selected bone.
        const targetIndex =
          st.activeTool === 'weights' && st.weightBoneId
            ? engine.skeleton.boneIndexMap.get(st.weightBoneId)
            : undefined;
        for (let k = 0; k < count; k++) {
          if (st.activeTool === 'weights') continue;
          let color = 0x9cc7ff;
          if (targetIndex !== undefined) {
            const t = vertexWeightOf(ed.attachment.weights, k, targetIndex, ed.boneIndex);
            const mix = (lo: number, hi: number): number => Math.round(lo + (hi - lo) * t);
            color = t <= 0 ? 0x4a5a70 : (mix(0x9c, 0xff) << 16) | (mix(0xc7, 0x50) << 8) | mix(0xff, 0x40);
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
    if (st.activeTool === 'weights' && mouseWorld && st.brushMode !== 'direct') {
      handlesG.setStrokeStyle({ width: 1.25 / camera.scale, color: 0xffffff, alpha: 0.35 });
      handlesG.circle(mouseWorld.x, mouseWorld.y, st.brushRadius).stroke();
    }
    if (weightBox)
      handlesG
        .rect(
          Math.min(weightBox.start.x, weightBox.end.x),
          Math.min(weightBox.start.y, weightBox.end.y),
          Math.abs(weightBox.end.x - weightBox.start.x),
          Math.abs(weightBox.end.y - weightBox.start.y),
        )
        .fill({ color: 0x54c4ff, alpha: 0.12 })
        .stroke({ color: 0x54c4ff, width: 1 / camera.scale });
  };

  const pickVertex = (wx: number, wy: number): number => {
    const ed = editableMesh();
    if (!ed) return -1;
    const state =
      ed.slotIndex < 0
        ? { verts: weightWorldVertices(engine, ed.attachment.id) }
        : engine.skeleton.pose.attachments.get(ed.attachment.id);
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
  let directCmd: DirectWeightsCommand | null = null;
  let directY = 0;
  let weightBox: {
    start: { x: number; y: number };
    end: { x: number; y: number };
    original: number[];
    additive: boolean;
  } | null = null;
  let brushDown: { x: number; y: number; vertex: number } | null = null;
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
  let handle: RigHandle | null = null;
  let moveOrigin = { x: 0, y: 0 };
  let scaleDirection = { x: 1, y: 0 };
  const grabParent = new Float64Array([1, 0, 0, 1, 0, 0]);
  let rotationDelta = 0;
  let rotationArmed = false;

  const selectedGizmo = () => {
    const st = useEditorStore.getState();
    const idx = st.selectedBoneId ? engine.skeleton.boneIndexMap.get(st.selectedBoneId) : undefined;
    return idx === undefined
      ? null
      : rigGizmo(
          engine.skeleton.pose.worldMatrices.subarray(idx * 6, idx * 6 + 6),
          camera.scale,
          st.activeTool,
        );
  };
  const selectedLengthHandle = () => {
    const st = useEditorStore.getState();
    const idx = st.selectedBoneId ? engine.skeleton.boneIndexMap.get(st.selectedBoneId) : undefined;
    if (idx === undefined || st.mode !== 'setup' || st.activeTool !== 'translate') return null;
    const bone = engine.skeleton.data.bones[idx]!,
      o = idx * 6,
      wm = engine.skeleton.pose.worldMatrices;
    if (bone.length === 0) return null;
    const axis = unit({ x: wm[o]!, y: wm[o + 1]! });
    return {
      x: wm[o + 4]! + wm[o]! * bone.length - (axis.y * 12) / camera.scale,
      y: wm[o + 5]! + wm[o + 1]! * bone.length + (axis.x * 12) / camera.scale,
    };
  };
  const cancelBoneGesture = () => {
    for (const cmd of [moveCmd, autoKeyCmd, setupDragCmd, lengthDragCmd, propKeyCmd, propKeyCmd2])
      cmd?.undo();
    moveCmd = null;
    autoKeyCmd = null;
    setupDragCmd = null;
    lengthDragCmd = null;
    propKeyCmd = null;
    propKeyCmd2 = null;
    createDrag = null;
    dragKind = null;
    dragBoneId = null;
    emptyGrab = false;
    handle = null;
    canvas.style.cursor = 'default';
  };
  /** The dragged bone's world matrix at shear-grab (a stable reference frame). */
  const grabWorld = new Float64Array(6);
  const grabLocalPt = { x: 0, y: 0 };
  /** Empty-space grabs: a plain click DESELECTS, a drag adjusts (Spine). */
  let emptyGrab = false;
  let downWp = { x: 0, y: 0 };
  let createDrag: {
    parentId: string | null;
    lx: number;
    ly: number;
    down: { x: number; y: number };
  } | null = null;
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

  /** One brush dab: every vertex inside brushRadius, smoothstep-falloff scaled. */
  const paintStrokeAt = (wx: number, wy: number): void => {
    const st = useEditorStore.getState();
    const ed = editableMesh();
    if (!ed || !paintCmd || !st.weightBoneId) return;
    const boneIndex = engine.skeleton.boneIndexMap.get(st.weightBoneId);
    if (boneIndex === undefined) return;
    const state =
      ed.slotIndex < 0
        ? { verts: weightWorldVertices(engine, ed.attachment.id) }
        : engine.skeleton.pose.attachments.get(ed.attachment.id);
    if (!state) return;
    const r = st.brushRadius;
    const r2 = r * r;
    const weightUI = useWeightEditingStore.getState(),
      selected = new Set(weightUI.vertices);
    const boneIndices = (weightUI.bones.includes(st.weightBoneId) ? weightUI.bones : [st.weightBoneId])
      .filter((id) => !ed.attachment.weightLocks?.includes(id))
      .map((id) => engine.skeleton.boneIndexMap.get(id)!);
    for (let k = 0; k < state.verts.length / 2; k++) {
      if (selected.size && !selected.has(k)) continue;
      const dx = state.verts[k * 2]! - wx;
      const dy = state.verts[k * 2 + 1]! - wy;
      const d2 = dx * dx + dy * dy;
      if (d2 >= r2) continue;
      const falloff = brushFalloff(Math.sqrt(d2), r, weightUI.feather);
      const current = boneIndices.reduce(
        (sum, index) => sum + vertexWeightOf(ed.attachment.weights, k, index, ed.boneIndex),
        0,
      );
      const amount =
        st.brushMode === 'replace'
          ? current + (st.brushStrength - current) * falloff
          : falloff * st.brushStrength;
      try {
        paintCmd.update(k, boneIndex, ed.boneIndex, amount, st.brushMode, boneIndices);
      } catch (error) {
        st.setStatus((error as Error).message);
        return;
      }
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
        st.setStatus(
          'Select a slot showing a region (draw a hull) or a mesh (edit vertices) — or Properties → Grid mesh.',
        );
        return;
      }
      const v = pickVertex(wp.x, wp.y);
      if (e.altKey) {
        if (st.mode !== 'setup') {
          st.setStatus('Edit mesh topology in Setup; Animate drags create Deform keys.');
          return;
        }
        // Alt+click deletes a vertex (hull or interior; never below 3 total).
        if (v >= 0) {
          try {
            st.execute(new RemoveMeshVertexCommand(engine, ed.attachment.id, v));
          } catch (error) {
            st.setStatus((error as Error).message);
          }
        }
        return;
      }
      if (v < 0) return;
      if (st.mode === 'animate' && engine.currentAnimation) {
        // Animate mode: the drag writes a DEFORM key at the playhead (§5.6).
        deformDragCmd = new AutoKeyDeformCommand(engine, ed.attachment.id);
        deformDragCmd.open();
        dragVertex = v;
        try {
          worldToAttachmentVertex(
            ed.attachment,
            ed.boneIndex,
            engine.skeleton.pose.worldMatrices,
            engine.skeleton.pose.attachments.get(ed.attachment.id)!,
            v,
            wp.x,
            wp.y,
            scratchPoint,
          );
          deformDragCmd.update(v, scratchPoint.x, scratchPoint.y);
        } catch (error) {
          st.setStatus((error as Error).message);
        }
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
      const ui = useWeightEditingStore.getState();
      if (ui.binding) {
        const bone = pickBone(wp.x, wp.y);
        if (bone) {
          ui.setBones(ui.bones.includes(bone) ? ui.bones.filter((id) => id !== bone) : [...ui.bones, bone]);
          st.setWeightBone(bone);
          return;
        }
        const slot = pickSlot(wp.x, wp.y);
        if (slot && !st.selectedSlotId && ui.bones.length) {
          const index = engine.skeleton.slotIndexMap.get(slot)!,
            id = engine.skeleton.pose.slots[index]!.attachmentId;
          if (id) {
            try {
              st.execute(new BindMeshCommand(engine, id, slot, ui.bones, true));
              st.selectSlot(slot);
              ui.patch({ binding: false });
            } catch (error) {
              st.setStatus((error as Error).message);
            }
          }
        }
        return;
      }
      if (!editableMesh()) st.selectSlot(pickSlot(wp.x, wp.y));
      const ed = editableMesh();
      if (!ed) {
        st.setStatus('Select a slot showing a mesh attachment (or create one: Properties → Grid mesh).');
        return;
      }
      const vertex = pickVertex(wp.x, wp.y);
      const pickedBone = vertex < 0 ? pickBone(wp.x, wp.y) : null;
      if (pickedBone && ed.attachment.boneBindings?.some((binding) => binding.boneId === pickedBone)) {
        ui.setBones(e.ctrlKey || e.metaKey ? [...new Set([...ui.bones, pickedBone])] : [pickedBone]);
        st.setWeightBone(pickedBone);
        return;
      }
      if (
        e.ctrlKey ||
        e.metaKey ||
        (st.brushMode === 'direct' && (vertex < 0 || !ui.vertices.includes(vertex)))
      ) {
        if (vertex >= 0) ui.setVertices(e.ctrlKey || e.metaKey ? [...ui.vertices, vertex] : [vertex]);
        else if (!e.ctrlKey && !e.metaKey) ui.setVertices([]);
        weightBox = {
          start: wp,
          end: wp,
          original: e.ctrlKey || e.metaKey ? ui.vertices : [],
          additive: e.ctrlKey || e.metaKey,
        };
        return;
      }
      if (!st.weightBoneId || !engine.skeleton.boneIndexMap.has(st.weightBoneId)) {
        st.setStatus(
          'Choose a Paint bone in the toolbar, or click a bone in the hierarchy while the mesh is selected.',
        );
        return;
      }
      if (st.brushMode === 'direct') {
        directCmd = new DirectWeightsCommand(
          engine,
          ed.attachment.id,
          ui.vertices,
          ui.bones.includes(st.weightBoneId) ? ui.bones : [st.weightBoneId],
        );
        directCmd.open();
        directY = e.clientY;
      } else brushDown = { x: wp.x, y: wp.y, vertex };
      canvas.style.cursor = 'crosshair';
      return;
    }

    if (st.activeTool === 'create_bone' && st.mode === 'setup') {
      // Child creation always starts at the parent's tip, regardless of where
      // its body was clicked. Empty canvas presses place a new root.
      const hitId = pickBone(wp.x, wp.y); // Child of the hit bone, else a new root.
      const local = parentLocalOf(hitId, wp.x, wp.y);
      if (!Number.isFinite(local.x) || !Number.isFinite(local.y)) {
        st.setStatus('Cannot create under a parent with zero scale.');
        return;
      }
      const index = hitId === null ? undefined : engine.skeleton.boneIndexMap.get(hitId);
      const parent = index === undefined ? null : engine.skeleton.data.bones[index]!;
      const o = (index ?? 0) * 6;
      const wm = engine.skeleton.pose.worldMatrices;
      createDrag = { parentId: hitId, lx: parent?.length ?? local.x, ly: parent ? 0 : local.y, down: wp };
      createWx = parent ? wm[o + 4]! + wm[o]! * parent.length : wp.x;
      createWy = parent ? wm[o + 5]! + wm[o + 1]! * parent.length : wp.y;
      dragKind = 'create';
      return;
    }

    // ---- Transform tools (translate/rotate/scale/shear) ----
    downWp = wp;
    emptyGrab = false;

    const gizmo = selectedGizmo();
    handle =
      gizmo && st.viewOptions[st.mode].bones ? pickRigHandle(gizmo, wp, camera.scale, st.activeTool) : null;
    const lengthHandle = selectedLengthHandle();
    if (
      lengthHandle &&
      Math.hypot(wp.x - lengthHandle.x, wp.y - lengthHandle.y) < 7 / camera.scale &&
      st.viewOptions[st.mode].bones
    ) {
      lengthDragCmd = new DragBoneLengthCommand(engine, st.selectedBoneId!);
      lengthDragCmd.open();
      dragBoneId = st.selectedBoneId;
      dragKind = 'length';
      canvas.style.cursor = 'ew-resize';
      return;
    }
    // Only Translate exposes length editing; rotation/scale handles take priority.
    if (!handle && st.activeTool === 'translate' && st.mode === 'setup' && st.selectedBoneId) {
      const idx = engine.skeleton.boneIndexMap.get(st.selectedBoneId);
      if (idx !== undefined) {
        const o = idx * 6;
        const wm = engine.skeleton.pose.worldMatrices;
        const len = engine.skeleton.data.bones[idx]!.length;
        const tipX = wm[o]! * len + wm[o + 4]!;
        const tipY = wm[o + 1]! * len + wm[o + 5]!;
        if (len > 0 && Math.hypot(wp.x - tipX, wp.y - tipY) < 10 / camera.scale) {
          lengthDragCmd = new DragBoneLengthCommand(engine, st.selectedBoneId);
          lengthDragCmd.open();
          dragBoneId = st.selectedBoneId;
          dragKind = 'length';
          canvas.style.cursor = 'ew-resize';
          return;
        }
      }
    }

    const hitId = handle ? st.selectedBoneId : pickBone(wp.x, wp.y);
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
      moveOrigin = origin;
      grabParent.set([1, 0, 0, 1, 0, 0]);
      const parentId = engine.skeleton.data.bones[idx]!.parentId;
      if (parentId) {
        const parentIndex = engine.skeleton.boneIndexMap.get(parentId)! * 6;
        grabParent.set(engine.skeleton.pose.worldMatrices.subarray(parentIndex, parentIndex + 6));
      }
      if (!inverseVector(grabParent, { x: 1, y: 0 })) {
        dragBoneId = null;
        st.setStatus('The parent has zero scale; restore its scale before dragging.');
        return;
      }
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
        const vector = inverseVector(grabParent, { x: wp.x - origin.x, y: wp.y - origin.y })!;
        grabAngle = Math.atan2(vector.y, vector.x);
        rotationArmed = Math.hypot(wp.x - origin.x, wp.y - origin.y) > 12 / camera.scale;
        rotationDelta = 0;
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
        // Fixed screen-space sensitivity remains usable even when grabbing the origin.
        const dragGizmo = rigGizmo(engine.skeleton.pose.worldMatrices.subarray(o, o + 6), camera.scale, tool);
        const end = handle === 'x' ? dragGizmo.x : handle === 'y' ? dragGizmo.y : dragGizmo.free;
        scaleDirection = end
          ? unit({ x: end.x - origin.x, y: end.y - origin.y })
          : unit({ x: wp.x - origin.x, y: wp.y - origin.y });
        grabDist = 64 / camera.scale;
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
        if (!inverseVector(engine.skeleton.pose.worldMatrices.subarray(o, o + 6), { x: 1, y: 0 })) {
          dragBoneId = null;
          st.setStatus('Restore the bone scale before shearing.');
          return;
        }
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
    if (weightBox) {
      weightBox.end = wp;
      const ed = editableMesh(),
        verts = ed ? weightWorldVertices(engine, ed.attachment.id) : undefined;
      if (verts && Math.hypot(wp.x - weightBox.start.x, wp.y - weightBox.start.y) * camera.scale > 3) {
        const selected = [...weightBox.original];
        for (let v = 0; v < verts.length / 2; v++)
          if (
            verts[v * 2]! >= Math.min(wp.x, weightBox.start.x) &&
            verts[v * 2]! <= Math.max(wp.x, weightBox.start.x) &&
            verts[v * 2 + 1]! >= Math.min(wp.y, weightBox.start.y) &&
            verts[v * 2 + 1]! <= Math.max(wp.y, weightBox.start.y)
          )
            selected.push(v);
        useWeightEditingStore.getState().setVertices(selected);
      }
      return;
    }
    if (directCmd) {
      try {
        directCmd.update((directY - e.clientY) / 200, true);
      } catch (error) {
        useEditorStore.getState().setStatus((error as Error).message);
      }
      return;
    }
    if (brushDown && !paintCmd && Math.hypot(wp.x - brushDown.x, wp.y - brushDown.y) * camera.scale > 3) {
      const ed = editableMesh();
      if (ed) {
        paintCmd = new PaintWeightsCommand(engine, ed.attachment.id);
        paintCmd.open(
          weightNeighbors(
            ed.attachment.meshVertices!.length / 2,
            ed.attachment.meshHull ?? [],
            ed.attachment.weightEdges ?? [],
          ),
        );
        paintStrokeAt(brushDown.x, brushDown.y);
      }
    }
    if (meshDragCmd && dragVertex >= 0) {
      // Drag writes BONE-LOCAL positions — the skinning step lifts them to
      // world space next tick, so the handle follows the cursor exactly.
      const ed = editableMesh();
      if (ed) {
        try {
          worldToAttachmentVertex(
            ed.attachment,
            ed.boneIndex,
            engine.skeleton.pose.worldMatrices,
            engine.skeleton.pose.attachments.get(ed.attachment.id)!,
            dragVertex,
            wp.x,
            wp.y,
            scratchPoint,
          );
          meshDragCmd.update(dragVertex, scratchPoint.x, scratchPoint.y);
        } catch (error) {
          useEditorStore.getState().setStatus((error as Error).message);
        }
      }
      return;
    }
    if (deformDragCmd && dragVertex >= 0) {
      const ed = editableMesh();
      if (ed) {
        try {
          worldToAttachmentVertex(
            ed.attachment,
            ed.boneIndex,
            engine.skeleton.pose.worldMatrices,
            engine.skeleton.pose.attachments.get(ed.attachment.id)!,
            dragVertex,
            wp.x,
            wp.y,
            scratchPoint,
          );
          deformDragCmd.update(dragVertex, scratchPoint.x, scratchPoint.y);
        } catch (error) {
          useEditorStore.getState().setStatus((error as Error).message);
        }
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
      const len = projectedLength(
        { x: wm[o]!, y: wm[o + 1]! },
        { x: wp.x - wm[o + 4]!, y: wp.y - wm[o + 5]! },
      );
      if (len !== null) lengthDragCmd.set(len);
      return;
    }
    if (dragKind === 'rotate' && dragBoneId) {
      const vector = inverseVector(grabParent, { x: wp.x - moveOrigin.x, y: wp.y - moveOrigin.y })!;
      if (Math.hypot(vector.x, vector.y) < 1e-8) return;
      const angle = Math.atan2(vector.y, vector.x);
      if (!rotationArmed) {
        if (Math.hypot(wp.x - moveOrigin.x, wp.y - moveOrigin.y) > 12 / camera.scale) {
          grabAngle = angle;
          rotationArmed = true;
        }
        return;
      }
      rotationDelta += angleStep(grabAngle, angle);
      grabAngle = angle;
      let target = startRotation + rotationDelta;
      if (e.shiftKey) target = Math.round(target / (Math.PI / 12)) * (Math.PI / 12);
      if (setupDragCmd) setupDragCmd.set('rotation', target);
      else propKeyCmd?.set(target);
      return;
    }
    if (dragKind === 'scale' && dragBoneId) {
      const r = 1 + ((wp.x - downWp.x) * scaleDirection.x + (wp.y - downWp.y) * scaleDirection.y) / grabDist;
      const sx = handle === 'y' && !e.shiftKey ? startSx : startSx * r;
      const sy = handle === 'x' && !e.shiftKey ? startSy : startSy * r;
      if (setupDragCmd) {
        setupDragCmd.set('scaleX', sx);
        setupDragCmd.set('scaleY', sy);
      } else {
        if (handle !== 'y' || e.shiftKey) propKeyCmd?.set(sx);
        if (handle !== 'x' || e.shiftKey) propKeyCmd2?.set(sy);
      }
      return;
    }
    if (dragKind === 'shear' && dragBoneId) {
      inverseOf(grabWorld, wp.x, wp.y, scratchPoint);
      const len = Math.max(engine.skeleton.data.bones.find((b) => b.id === dragBoneId)!.length, 20);
      const target = Math.max(-1.4, Math.min(1.4, startShear + (scratchPoint.x - grabLocalPt.x) / len));
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
      let dx = wp.x - downWp.x,
        dy = wp.y - downWp.y;
      if (handle === 'x') dy = 0;
      if (handle === 'y') dx = 0;
      if (e.shiftKey && !handle) {
        if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      const local = parentLocalOf(parentId, moveOrigin.x + dx, moveOrigin.y + dy);
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
    const gizmo = selectedGizmo();
    const overHandle =
      gizmo && st.viewOptions[st.mode].bones && pickRigHandle(gizmo, wp, camera.scale, st.activeTool);
    canvas.style.cursor = overHandle || hit ? 'grab' : pickSlot(wp.x, wp.y) !== null ? 'pointer' : 'default';
  };

  const onPointerUp = (e: PointerEvent) => {
    if (panning && e.button === 1) {
      panning = false;
      return;
    }
    const st = useEditorStore.getState();
    const wpUp = screenToWorld(e);
    weightBox = null;
    if (directCmd) {
      directCmd.commit();
      if (directCmd.changed) st.execute(directCmd);
      directCmd = null;
    }
    if (brushDown && !paintCmd)
      useWeightEditingStore.getState().setVertices(brushDown.vertex < 0 ? [] : [brushDown.vertex]);
    brushDown = null;
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
      // A click on the parent's middle is still a click, despite the snapped origin.
      const dragged = Math.hypot(wpUp.x - createDrag.down.x, wpUp.y - createDrag.down.y) > 6 / camera.scale;
      let cmd: AddBoneCommand;
      if (dragged) {
        const parent =
          createDrag.parentId === null
            ? new Float64Array([1, 0, 0, 1, 0, 0])
            : engine.skeleton.pose.worldMatrices.subarray(
                engine.skeleton.boneIndexMap.get(createDrag.parentId)! * 6,
                engine.skeleton.boneIndexMap.get(createDrag.parentId)! * 6 + 6,
              );
        const vector = inverseVector(parent, { x: dx, y: dy });
        if (!vector) {
          cancelBoneGesture();
          st.setStatus('Cannot create under a parent with zero scale.');
          return;
        }
        cmd = new AddBoneCommand(
          engine,
          createDrag.parentId,
          { x: createDrag.lx, y: createDrag.ly },
          {
            rotation: Math.atan2(vector.y, vector.x),
            length: Math.hypot(vector.x, vector.y),
          },
        );
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
      const commands = [setupDragCmd, propKeyCmd, propKeyCmd2].filter((cmd) => cmd !== null);
      for (const cmd of commands) {
        if (moved) cmd.commit();
        else cmd.undo();
      }
      const changed = commands.filter((cmd) => cmd.changed);
      if (moved && changed.length) st.execute(new CompositeCommand('Transform Bone', changed));
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
        if (Math.hypot(wpUp.x - downWp.x, wpUp.y - downWp.y) <= 3 / camera.scale) moveCmd.undo();
        else if (moveCmd.changed) st.execute(moveCmd); // One history entry per drag.
        moveCmd = null;
      }
      if (autoKeyCmd) {
        autoKeyCmd.commit();
        if (Math.hypot(wpUp.x - downWp.x, wpUp.y - downWp.y) <= 3 / camera.scale) autoKeyCmd.undo();
        else if (autoKeyCmd.changed) st.execute(autoKeyCmd);
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
      if (st.mode !== 'setup') return;
      const ed = editableMesh();
      if (!ed) return;
      const wp = screenToWorld(e);
      if (pickVertex(wp.x, wp.y) >= 0) return; // On a vertex — that's a drag, not an add.
      inverseTransformPoint(engine.skeleton.pose.worldMatrices, ed.boneIndex, wp.x, wp.y, scratchPoint);
      if (!pointInMeshHull(ed.attachment, scratchPoint.x, scratchPoint.y)) return;
      try {
        st.execute(new AddMeshVertexCommand(engine, ed.attachment.id, scratchPoint.x, scratchPoint.y));
      } catch (error) {
        st.setStatus((error as Error).message);
      }
      return;
    }
    if (isTransformTool(st.activeTool)) st.clearSelection(); // Spine: dblclick deselects.
  };

  let tickCount = 0;
  let lastTickAt = performance.now();
  // Bounded opt-in browser evidence. Normal playback allocates no profiling records.
  type RigFrame = {
    coreMs: number;
    viewportMs: number;
    vertexTransforms: number;
    bindMatrixProducts: number;
    vertices: number;
    attachments: number;
    maskedMeshes: number;
  };
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
    const previewWeights = useWeightEditingStore.getState().preview;
    const originalWeights: { attachment: AttachmentData; weights: number[] | undefined }[] = [];
    if (previewWeights)
      for (const [id, weights] of Object.entries(previewWeights)) {
        const attachment = weightAttachment(engine.skeleton.data, id);
        if (attachment) {
          originalWeights.push({ attachment, weights: attachment.weights });
          attachment.weights = weights;
        }
      }
    let coreMs = 0;
    try {
      engine.tick(deltaMS, recording ? measuredStats : undefined);
      coreMs = recording ? performance.now() - measuredStart : 0;

      const st = useEditorStore.getState();
      grid.visible = st.viewOptions[st.mode].grid;
      if (
        st.dataRevision !== recDataRev ||
        textureRegistry.version !== recTexVer ||
        recSkeleton !== engine.skeleton
      ) {
        reconcileSlots(st.dataRevision, textureRegistry.version);
      }
      updateSlotMeshes();
      drawGhosts();
      drawBones();
      drawMarkers();
      drawHandles();
    } finally {
      for (const { attachment, weights } of originalWeights) attachment.weights = weights;
    }

    tickCount++;
    const w = window as unknown as Record<string, unknown>;
    w.__ticks = tickCount;
    w.__rigGizmo = selectedGizmo();
    w.__rigLengthHandle = selectedLengthHandle();
    // Test hooks for the smoke suite: how many slot meshes render + where the
    // first one sits (skeleton space) so "sprite follows bone" is assertable.
    w.__slotMeshes = slotsContainer.children.length;
    w.__rigGeometryBuilds = geometryBuilds;
    w.__rigGhostBuilds = ghostBuilds;
    const first = slotsContainer.children[0] as Mesh | undefined;
    w.__slotMesh0 =
      first && first.visible ? [first.geometry.positions[0], first.geometry.positions[1]] : null;
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
    w.__boneOrigin0 = [engine.skeleton.pose.worldMatrices[4]!, engine.skeleton.pose.worldMatrices[5]!];
    // First IK constraint's target world position (drag source in smoke).
    const ik0 = engine.skeleton.data.ikConstraints[0];
    if (ik0) {
      const ti = engine.skeleton.boneIndexMap.get(ik0.targetId);
      w.__ikTarget0 =
        ti !== undefined
          ? [engine.skeleton.pose.worldMatrices[ti * 6 + 4]!, engine.skeleton.pose.worldMatrices[ti * 6 + 5]!]
          : null;
    } else {
      w.__ikTarget0 = null;
    }
    if (recording)
      measuredFrame = {
        coreMs,
        viewportMs: performance.now() - measuredStart,
        vertices: measuredStats!.vertices,
        attachments: measuredStats!.attachments,
        vertexTransforms: measuredStats!.vertexTransforms,
        bindMatrixProducts: measuredStats!.bindMatrixProducts,
        maskedMeshes: [...slotMeshes.values()].filter((entry) => entry.mesh.visible && entry.mesh.mask)
          .length,
      };
  };
  theApp.ticker.add(() => {
    lastTickAt = performance.now();
    // Background tabs must not fast-forward playback.
    updateViewport(Math.min(theApp.ticker.deltaMS, 100));
  });
  // Pixi submits rendering at LOW; UTILITY observes completion of CPU submission.
  // GPU completion is asynchronous and is intentionally outside cpuMs.
  theApp.ticker.add(
    () => {
      if (measuredFrame && measuredCapture) {
        const timestamp = performance.now();
        measuredCapture.frames.push({ ...measuredFrame, timestamp, cpuMs: timestamp - measuredStart });
        measuredFrame = null;
      }
    },
    undefined,
    UPDATE_PRIORITY.UTILITY,
  );

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

  const afterInput =
    <E extends Event>(handler: (event: E) => void) =>
    (event: E) => {
      handler(event);
      renderNow();
    };
  const down = afterInput(onPointerDown);
  const move = afterInput(onPointerMove);
  const up = afterInput(onPointerUp);
  const cancel = afterInput((e: PointerEvent) => {
    cancelBoneGesture();
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
    if (
      Object.keys(state).every(
        (key) =>
          key === 'statusMessage' ||
          state[key as keyof typeof state] === previous[key as keyof typeof previous],
      )
    )
      return;
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (!disposed) renderNow();
    });
  });
  const unsubscribeWeights = useWeightEditingStore.subscribe(() => {
    if (!disposed) renderNow();
  });
  viewportCleanups.set(theApp, () => {
    disposed = true;
    unsubscribe();
    unsubscribeWeights();
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
