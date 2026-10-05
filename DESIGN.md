# Developer Design Document: Web-Based 2D Skeletal Animation Editor (V3)

## 1. Project Overview

This document outlines the architecture for a browser-based 2D skeletal animation tool (a Spine
clone). The architecture is strictly divided into a **Framework-Agnostic Core Engine** (math, FK,
IK, animation logic — no React, no Pixi) and an **Editor Layer** (React + Zustand + PixiJS). This
separation ensures the animation runtime can be exported independently for game engines.

### Architectural Principles (non-negotiable)

1. **Setup Data vs. Pose State.** The rig definition (`SkeletonData`) is immutable and serialized.
   The runtime transforms (`SkeletonPose`) are mutable, per-instance, and never serialized.
   Animations are applied to the *pose*, never to the setup data.
2. **No 60fps data in React state.** UI state lives in Zustand; the document and pose live in a
   mutable engine class; the two are bridged by a `dataRevision` counter and transient
   subscriptions. The playback clock lives in the engine, never in the store.
3. **Allocation-free hot paths.** FK, the animation mixer, and mesh skinning run 60+ times per
   second: `Float32Array` buffers, numeric indices, preallocated scratch. No object allocation,
   no string parsing, no `Map`/UUID lookups inside the per-frame loop.
4. **Every user action is a Command.** Undo/redo is a foundation, not a feature — commands exist
   from Phase 2 onward.
5. **World transforms are matrices, only matrices.** A composed world transform cannot be
   losslessly decomposed into `(rotation, scale, shear)` when parents have non-uniform scale or
   shear. World transforms exist **only** as 2x3 affine matrices in a flat array. There is no
   `world: Transform` field anywhere.

## 2. Repository Structure

Monorepo using npm workspaces, with TypeScript project references between packages. (The
structure is pnpm-compatible — a `pnpm-workspace.yaml` with the same `packages/*` glob drops in;
npm is used because it is what the dev machine has installed.)

```
packages/
  ├── core/      # Pure TS: data model, Skeleton, FK/IK solvers, AnimationState, bezier,
  │              # mesh skinning, serialization. Zero runtime dependencies (gl-matrix optional).
  ├── editor/    # React + Zustand + PixiJS: UI, Viewport, Timeline, Commands, History
  └── runtime/   # Lightweight player built on @core: AnimationState + Pixi renderer for games
```

`@core` must never import from `@editor` or `@runtime`. CI enforces this with a dependency-cruiser
rule (or an import lint). The editor and the runtime are two consumers of the same engine — this
is the whole point of the split.

## 3. Core Data Model (`@core`)

### 3.1 SkeletonData — Immutable Rig Definition

```typescript
// core/types/data.ts

export const FORMAT_VERSION = 1;

export interface Transform {
  x: number;
  y: number;
  rotation: number; // RADIANS internally. Degrees exist only in <PropertiesPanel /> for UX.
  scaleX: number;
  scaleY: number;
  shearX: number;
  shearY: number;
}

export interface BoneData {
  id: string;            // UUID (crypto.randomUUID — requires a secure context, see §8.6)
  name: string;
  parentId: string | null;
  setupPose: Transform;  // The default, non-animated state
  length: number;        // Visual bone length (gizmo drawing / IK reach). Not a transform.
}

/**
 * IK constraints are TOP-LEVEL objects, not fields on BoneData:
 * - A constraint typically controls a CHAIN of 1–2 bones (e.g. upper arm + forearm).
 * - Explicit `order` makes multi-constraint solve sequence deterministic.
 */
export interface IKConstraintData {
  id: string;
  bones: string[];            // Ordered chain the constraint controls (1 or 2 entries).
  targetId: string;           // Bone whose world position pulls the chain tip.
  poleVectorId: string | null;// Optional bone controlling bend direction in the plane.
  bendDirection: 1 | -1;
  mix: number;                // 0..1 — constraint influence.
  softness: number;           // Degrees of slack before full stretch (keep 0 in v1).
  order: number;              // Solve order among all constraints (ascending).
}

export interface SlotData {
  id: string;
  name: string;
  boneId: string;
  defaultAttachmentId: string | null;
  color: number; // Packed RGBA uint32 (0xRRGGBBAA). No color strings in runtime data.
}

export interface AttachmentData {
  id: string;
  name: string;
  type: 'region' | 'mesh';
  textureId: string; // Key into the texture registry / asset manifest — NOT a URL (see §3.5).

  // --- Region (4 corners) ---
  vertices?: number[]; // 8 floats, local space relative to the slot's bone.
  uvs?: number[];      // 8 floats, normalized texture coordinates.

  // --- Mesh ---
  meshVertices?: number[];  // Flat local-space positions.
  meshTriangles?: number[]; // Earcut output — indices into meshVertices.
  meshUVs?: number[];

  /**
   * Skinning weights — interleaved PER VERTEX (mesh) / per corner (region):
   *   [count, boneIndex0, weight0, boneIndex1, weight1, ...]
   *
   * boneIndex refers to the index in SkeletonData.bones (topologically sorted) —
   * the SAME index space as SkeletonPose.worldMatrices. No strings, no UUID lookups
   * in the skinning loop. The editor resolves id <-> index via Skeleton.boneIndexMap
   * when painting weights; the serialized format stores indices because the bones
   * array order is authoritative and versioned.
   *
   * A vertex with no weight entry is rigid-bound to its slot's bone.
   */
  weights?: number[];
}

export interface SkinData {
  name: string;
  attachments: Record<string, string>; // slotId -> attachmentId shown for that slot.
}

export interface SkeletonData {
  /**
   * ALWAYS stored in topological order (parents before children).
   * The array index IS the bone index used by the FK solver and by attachment weights.
   * Structural edits re-sort this array via Skeleton.rebuild().
   */
  bones: BoneData[];
  slots: SlotData[];            // Array order defines the DEFAULT draw order.
  attachments: AttachmentData[];
  ikConstraints: IKConstraintData[]; // Sorted by `order` at load time.
  skins: SkinData[];
  activeSkin: string;
}
```

### 3.2 SkeletonPose — Mutable Runtime State

Rewritten every frame. Never serialized.

```typescript
// core/types/pose.ts

export interface BonePose {
  /** Local transform at time T. Reset from setupPose, then written by animations. */
  local: Transform;
  // NOTE: deliberately NO `world` field. See §1 principle 5. The world transform of
  // bone i lives ONLY in SkeletonPose.worldMatrices, slots [i*6 .. i*6+5].
}

export interface SlotPose {
  attachmentId: string | null;
  color: number; // Packed RGBA uint32. Never parse "#RRGGBBAA" strings in the render loop.
}

export interface SkeletonPose {
  /** Parallel to SkeletonData.bones — same topological index space. */
  bones: BonePose[];
  /** Indexed by slot id index (parallel to SkeletonData.slots). */
  slots: SlotPose[];
  /**
   * Current draw order: a permutation of slot indices. Draw-order timelines swap this.
   * (Draw order is an ordered array on the pose, NOT a z-number on each slot —
   * that is what makes animated reordering possible.)
   */
  slotOrder: number[];
  /**
   * Flat world matrices, 6 floats per bone: [a, b, c, d, tx, ty].
   *   | a c tx |
   *   | b d ty |
   * Length = bones.length * 6. Preallocated once per Skeleton instance.
   */
  worldMatrices: Float32Array;
}
```

### 3.3 Animation Data Model — Typed Timelines

Timelines are a **discriminated union of typed timelines**, not a generic
`{ targetId, property: string }`. Reason: attachment keyframes hold a string, draw-order keyframes
hold a slot permutation, color keyframes hold packed uint32 — none of these fit a
`value: number`. Type safety here directly shapes the dopesheet UI in Phase 3.

```typescript
// core/types/animation.ts

export type CurveType = 'linear' | 'stepped' | 'bezier';

export interface Curve {
  type: CurveType;
  /**
   * Bezier control points: (c1,c2) and (c3,c4) are (cx,cy) pairs.
   * Constraint: cx ∈ [0,1] so time never flows backwards.
   * cy is UNBOUNDED — values outside [0,1] produce overshoot (back/bounce eases).
   */
  c1?: number; c2?: number; c3?: number; c4?: number;
}

interface KeyframeBase {
  time: number; // Seconds.
  /** Curve from THIS keyframe to the next (Spine convention). Last frame's curve is unused. */
  curve: Curve;
}

export interface NumberKeyframe  extends KeyframeBase { value: number; }
export interface ColorKeyframe   extends KeyframeBase { value: number; }        // packed RGBA
export interface AttachmentKeyframe extends KeyframeBase { attachmentId: string | null; }
export interface DrawOrderKeyframe  extends KeyframeBase { slotOrder: number[]; } // full permutation
export interface DeformKeyframe     extends KeyframeBase {
  /** Per-vertex offsets from the setup mesh positions. null = setup pose. */
  offsets: number[] | null;
}
export interface EventKeyframe extends KeyframeBase {
  eventName: string;
  payload?: number | string;
}

// ---- Timeline union ----

export interface BonePropertyTimeline {
  kind: 'boneProperty';
  boneId: string;
  property: 'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY' | 'shearX' | 'shearY';
  keyframes: NumberKeyframe[]; // Sorted by time. Interpolation via binary search.
}

export interface SlotColorTimeline {
  kind: 'slotColor';
  slotId: string;
  keyframes: ColorKeyframe[];
}

export interface SlotAttachmentTimeline {
  kind: 'slotAttachment';
  slotId: string;
  keyframes: AttachmentKeyframe[]; // Stepped only — no interpolation between attachments.
}

export interface DrawOrderTimeline {
  kind: 'drawOrder';
  keyframes: DrawOrderKeyframe[];  // Stepped only.
}

export interface DeformTimeline {
  kind: 'deform';
  attachmentId: string;
  keyframes: DeformKeyframe[];     // Float interpolation.
}

export interface EventTimeline {
  kind: 'event';
  keyframes: EventKeyframe[];      // Stepped; fired when playback crosses the frame time.
}

export type Timeline =
  | BonePropertyTimeline
  | SlotColorTimeline
  | SlotAttachmentTimeline
  | DrawOrderTimeline
  | DeformTimeline
  | EventTimeline;

export interface Animation {
  name: string;
  duration: number; // Derived (max keyframe time) but stored for O(1) access.
  loop: boolean;
  timelines: Timeline[];
}
```

### 3.4 Exported Document Format

```jsonc
{
  "version": 1,                        // FORMAT_VERSION. See §8.3 for migrations.
  "skeleton": { "bones": [], "slots": [], "attachments": [], "ikConstraints": [], "skins": [] },
  "animations": [ { "name": "walk", "duration": 1.2, "loop": true, "timelines": [] } ],
  "assetManifest": {                   // textureId -> where the pixels come from
    "tex_abc123": { "name": "head.png", "source": "embedded" /* or atlas region */ }
  }
}
```

`version` lives ONLY here, on the exported document — not on `SkeletonData`. A rig by itself is
versionless; the file format owns versioning (two version fields would drift).

### 3.5 Texture Handling

- In-editor, textures live in a registry keyed by `textureId` (loaded from drag-and-drop files
  via `URL.createObjectURL` — local origin, no CORS issues).
- On export (Phase 8), the atlas packer bakes a combined spritesheet and **re-writes attachment
  UVs** to atlas regions; the asset manifest then references atlas regions instead of original
  files. This is why `AttachmentData` references `textureId`, not a URL.

## 4. Core Engine Logic (`@core`)

### 4.1 Skeleton Instance

```typescript
// core/skeleton/Skeleton.ts

/**
 * Runtime wrapper: data (immutable, per document) + pose (mutable, per instance).
 * One SkeletonData may back many Skeleton instances (editor preview, runtime players).
 */
export class Skeleton {
  readonly data: SkeletonData;
  readonly pose: SkeletonPose;
  /** boneId -> topological index. Baked once; rebuilt by rebuild(). Editor-side lookups only. */
  readonly boneIndexMap: Map<string, number>;
  readonly slotIndexMap: Map<string, number>;

  constructor(data: SkeletonData) { /* bake maps, allocatePose(data) */ }

  /**
   * Called by structural commands (add/remove/reparent bone, add/remove slot, IK edits):
   * 1. Re-sort bones topologically (stable — parents first). Bone indices SHIFT.
   * 2. Rebuild index maps.
   * 3. Re-allocate pose arrays; copy existing values over BY BONE ID so the current
   *    visible pose survives (e.g. undoing AddBoneCommand must not reset the rig's pose).
   * 4. Re-bake attachment weight indices? No — weights are stored against bone ids'
   *    sorted indices, so rebuild() re-maps them via the old/new index maps.
   */
  rebuild(): void;
}
```

### 4.2 FK Solver

```typescript
// core/skeleton/FKSolver.ts

/**
 * Allocation-free. Reads pose.bones[i].local, writes pose.worldMatrices.
 * data.bones is topologically sorted (parents before children), so a single
 * forward pass suffices — no recursion, no string/UUID lookups, no object creation.
 */
export function solveFK(data: SkeletonData, indexMap: Map<string, number>, pose: SkeletonPose): void {
  const wm = pose.worldMatrices;
  for (let i = 0; i < data.bones.length; i++) {
    const bone = data.bones[i];
    const t = pose.bones[i].local;
    const o = i * 6;

    // 1. Local affine (la, lb, lc, ld, tx, ty) from (x, y, rotation, sx, sy, shearX, shearY).
    //    Full formula including both shears — write once, unit-test with golden matrices.

    const p = bone.parentId === null ? -1 : indexMap.get(bone.parentId)!;
    if (p === -1) {
      // Root: world = local.
    } else {
      // Child: world = parentWorld * local  (compose affines inline, six multiplies per cell).
    }
  }
}
```

### 4.3 Per-Frame Pipeline (the update order is a contract)

```typescript
// core/pipeline.ts — driven by the editor's Pixi ticker or the runtime's update().

export function updateSkeleton(skeleton: Skeleton, animState: AnimationState, dt: number): EventFrame[] {
  // 1. RESET: copy setupPose -> pose.local for ALL bones (cheap loop over typed data).
  //    Do NOT track per-bone "was animated" flags — they are unreliable once multiple
  //    animations mix, and the reset is nearly free. Then reset slot colors/attachments
  //    to their skin defaults.
  // 2. APPLY: animState.apply(pose, ...) — one or more animations with weights (§4.4).
  // 3. FK:   solveFK(...).
  // 4. IK:   solve each constraint in ascending `order`. IK runs AFTER FK,
  //          re-computing affected world matrices (and their subtrees).
  // 5. MESH: computeMeshVertices(...) — weighted skinning against worldMatrices.
  //          Runs after IK so deformed meshes follow constrained bones.
  // 6. EVENTS: collect events crossed in (prevTime, currentTime]; returned to the caller.
}
```

### 4.4 Animation Mixer & AnimationState

The mixer is designed for **multiple simultaneous tracks with weights** from day one, even though
the editor timeline initially drives a single track. This is the heart of the runtime package;
retrofitting mixing later would rewrite the mixer.

```typescript
// core/animation/AnimationState.ts

interface Track {
  animation: Animation;
  time: number;
  prevTime: number;      // For event crossing detection.
  weight: number;        // Final applied weight this frame.
  fadeElapsed: number; fadeDuration: number; // 0 = instant set.
  loop: boolean;
  queuedNext: { name: string; fadeDuration: number; delay: number; loop: boolean } | null;
}

export class AnimationState {
  /** Replace current tracks with `name`, crossfading over fadeDuration seconds. */
  setAnimation(name: string, opts?: { loop?: boolean; fadeDuration?: number }): Track;
  /** Queue an animation (with its own fade) to start when the current track completes. */
  addAnimation(name: string, opts?: { loop?: boolean; fadeDuration?: number; delay?: number }): void;

  /**
   * Pipeline step 2. For each track: binary-search surrounding keyframes, interpolate
   * (linear / stepped / bezier), blend into pose.local weighted against other tracks.
   * Allocation-free; writes collected events into the reusable out array.
   */
  apply(skeleton: Skeleton, dt: number, outEvents: EventFrame[]): void;
}
```

### 4.5 Bezier Solver

```typescript
// core/animation/bezier.ts

/**
 * Solves y(x) for the interpolation curve at normalized time x.
 * - cx ∈ [0,1] is enforced by the editor UI; cy is unbounded (overshoot allowed).
 * - Newton–Raphson first (fast convergence), bisection fallback after N iterations.
 * - Fast path: if c1 === c3 the curve degenerates to a linear time remap — closed form,
 *   no iteration. Cache the decision on the keyframe, not per frame.
 */
export function solveBezier(curve: Curve, x: number): number;
```

### 4.6 IK Solver

Runs per constraint, in ascending `order`. One-bone: rotate the bone toward the target. Two-bone:
classic analytic solution (cosine law) with `bendDirection` choosing the elbow side, `poleVectorId`
disambiguating the bend plane, `mix` lerping between the FK result and the constrained result.
After solving, the affected bone's local transform is derived FROM the adjusted world matrix and
FK re-propagates to its subtree. (Implementation note: Spine's IK is the reference here; port the
math, not the code.)

## 5. Editor Architecture (`@editor`)

### 5.1 EditorEngine — Mutable, Owns the Clock

```typescript
// editor/engine/EditorEngine.ts

export class EditorEngine {
  skeleton: Skeleton;
  animState: AnimationState;
  document: EditorDocument; // animations list, texture registry, file metadata

  // The CLOCK lives here — NOT in Zustand. currentTime updates 60x/sec; pushing it
  // through the store would re-render every subscriber (timeline, properties panel)
  // every frame, which is exactly what this architecture forbids.
  currentTime: number;
  playing: boolean;
  playbackSpeed: number;

  /** Called from the Pixi ticker. */
  tick(deltaMS: number): void {
    if (this.playing) this.currentTime += (deltaMS / 1000) * this.playbackSpeed;
    this.pendingEvents = updateSkeleton(this.skeleton, this.animState, /*dt*/ deltaMS / 1000);
    this.emitTransient('time', this.currentTime); // transient subscribers only (§5.4)
  }
}
```

A single engine instance is provided via React context (`EngineProvider`). Avoid a bare
`getInstance()` singleton — it breaks multiple viewports and complicates tests.

### 5.2 Zustand UI Store — UI State Only

```typescript
// editor/store/editorStore.ts

interface UIState {
  selectedBoneId: string | null;
  selectedSlotIds: string[];
  activeTool: 'select' | 'create_bone' | 'create_mesh' | 'weights';
  mode: 'setup' | 'animate'; // Workflow mode — see §5.6.
  isPlaying: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** Bumped by execute/undo/redo — the ONLY signal React uses to re-read engine data. */
  dataRevision: number;

  execute: (cmd: Command) => void;
  undo: () => void;
  redo: () => void;
}

// History lives in a plain module-level HistoryManager — NEVER mutated directly on
// the Zustand state object (mutating state outside set() is a store anti-pattern and
// breaks the UIState contract).
export const useEditorStore = create<UIState>()((set) => ({
  /* ...initial values... */
  execute: (cmd) => {
    history.execute(cmd);
    set((s) => ({ dataRevision: s.dataRevision + 1, canUndo: history.canUndo, canRedo: history.canRedo }));
  },
  undo: () => {
    history.undo();
    set((s) => ({ dataRevision: s.dataRevision + 1, canUndo: history.canUndo, canRedo: history.canRedo }));
  },
  redo: () => {
    history.redo();
    set((s) => ({ dataRevision: s.dataRevision + 1, canUndo: history.canUndo, canRedo: history.canRedo }));
  },
}));
```

**Tearing caveat:** `dataRevision` + mutable engine data is the classic "version counter" pattern.
It is safe as long as commands are applied from event handlers or the ticker — never from inside
a React render or a concurrent-transition callback, or a render could observe half-applied state.

### 5.3 Command Pattern & History

```typescript
// editor/history/Command.ts

export interface Command {
  readonly label: string; // For a future "Edit > Undo Move Bone" menu.
  do(): void;
  undo(): void;
}

/**
 * Continuous commands coalesce pointer drags and text input into ONE history entry.
 * Lifecycle: open() at pointerdown -> update() per pointermove (mutates live,
 * no history involvement) -> commit() at pointerup (captures the after-snapshot;
 * only now does the command become undoable).
 */
export interface ContinuousCommand extends Command {
  open(): void;
  update(): void;
  commit(): void;
}
```

Rules that prevent the classic undo bugs:

- **Structural commands** (`AddBone`, `RemoveBone`, `ReparentBone`, `AddSlot`, `AddIKConstraint`…)
  call `skeleton.rebuild()` inside **both** `do()` and `undo()` — bone indices shift either way,
  and the pose is re-synced by id.
- **Auto-key commands are atomic**: in animate mode, a bone drag produces ONE command that both
  inserts/replaces keyframes at the playhead and records the pose change. Undo reverts both —
  never keyframes and pose separately.
- **Text input** in the properties panel opens a continuous command on focus and commits on blur
  (so typing "120" is one undo step, not three).

### 5.4 React Component Architecture

```
<App>
  ├── <EngineProvider />          # provides EditorEngine via context
  ├── <TopMenuBar />
  ├── <MainToolbar />             # tools + mode switch (Setup / Animate)
  ├── <WorkspaceLayout>           # react-resizable-panels
  │    ├── <HierarchyPanel />     # subscribes to dataRevision, reads engine.document
  │    ├── <ViewportCanvas />     # PixiJS; ticker reads engine directly, zero React state
  │    └── <PropertiesPanel />    # edits setup pose / creates commands (degrees UI)
  └── <TimelinePanel />           # dopesheet + playhead (transient, see below)
```

The **playhead** moves at 60fps without re-rendering React: it subscribes to the engine's
transient `time` channel and writes `style.transform` directly to a DOM ref.

```tsx
// editor/components/Playhead.tsx
const playheadRef = useRef<HTMLDivElement>(null);
useEffect(() => {
  return engine.onTransient('time', (t) => {
    playheadRef.current!.style.transform = `translateX(${t * pixelsPerSecond}px)`;
  });
}, [engine, pixelsPerSecond]);
```

### 5.5 ViewportCanvas — Async Init Done Right

PixiJS v8 `Application.init()` is asynchronous. Two hazards are handled explicitly: the
unmount-before-init race (leak) and React 18 StrictMode double-mounting effects in dev.

```tsx
// editor/components/ViewportCanvas.tsx
export const ViewportCanvas = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const appRef = useRef<Application | null>(null);
  const disposedRef = useRef(false);

  useEffect(() => {
    disposedRef.current = false;
    let app: Application | null = null;

    (async () => {
      if (!canvasRef.current || disposedRef.current) return;
      app = new Application();
      await app.init({
        canvas: canvasRef.current,
        backgroundColor: 0x2c2c2c,
        antialias: true,
        resizeTo: canvasRef.current.parentElement!,
      });

      // Unmounted (or StrictMode-remounted) while awaiting init: destroy immediately,
      // never touch the ticker, never leak the GPU context.
      if (disposedRef.current) { app.destroy(true, { children: true }); app = null; return; }

      appRef.current = app;
      const engine = useEngine(); // from context

      app.ticker.add((ticker) => {
        // Delta is USED (this advances the engine clock) and CAPPED so a background
        // tab / breakpoint doesn't fast-forward the animation by seconds.
        engine.tick(Math.min(ticker.deltaMS, 100));
        engine.renderToPixi(app!.stage);
      });
    })();

    return () => {
      disposedRef.current = true;
      appRef.current?.destroy(true, { children: true });
      appRef.current = null;
    };
  }, []);

  return <canvas ref={canvasRef} />;
};
```

Rendering strategy: `renderToPixi` keeps one Pixi display object per slot (sprite/mesh) and one
gizmo per bone, reused across frames — it updates transforms/vertices in place rather than
rebuilding the scene graph. Bone gizmos strictly read `SkeletonPose`; they never own state.

### 5.6 Setup Mode vs. Animate Mode (core workflow, made explicit)

| | **Setup mode** | **Animate mode** |
|---|---|---|
| Dragging a bone edits | `bone.setupPose` (via `ContinuousCommand`) | pose + auto-keyframe at playhead |
| Keyframes | Never touched | Inserted/replaced at `currentTime` (atomic command, §5.3) |
| Properties panel shows | Setup pose values | Current animated pose values |

Auto-key never silently destroys data: dropping a key at an existing frame time replaces that key,
captured in the same command.

### 5.7 Hit-Testing & Picking

Each bone gets an invisible `Graphics` hit-rectangle (rotated with the bone) with
`eventMode = 'static'`, letting Pixi's event system do the picking. Two additions beyond v2:

- **Picking priorities** (like Spine): clicking selects in a configurable order among
  bone gizmos, attachments, and mesh vertices, depending on the active tool.
- Gizmo interaction (rotation rings, scale handles, marquee selection) uses custom pointer math
  against world matrices — Pixi events are only the entry point.

## 6. Runtime Package (`@runtime`) — API Surface

Defined up front (stubbed in Phase 1, implemented against the export format) so the editor's
export format and the core mixer stay compatible with it. The hard part of a runtime is the
animation state machine, not rendering — so the API is designed around it.

```typescript
// runtime/player.ts
export class RuntimePlayer {
  constructor(doc: ExportedDocument, atlas: TextureAtlas);

  readonly state: AnimationState; // setAnimation / addAnimation / crossfade / queue.

  /** Integrate. Call once per frame with your engine's delta (seconds). */
  update(deltaSeconds: number): void;

  /** Render via Pixi — or read raw data to feed your own renderer/engine bridge. */
  render(container: Container): void;
  getWorldTransforms(): Float32Array;   // For custom renderers.
  getDeformedVertices(attachmentId: string): Float32Array;

  /** Custom timeline events ("footstep", "fire"), fired during update(). */
  onEvent(cb: (e: { name: string; payload?: number | string }) => void): () => void;
}
```

## 7. Phased Development Plan

### Phase 1 — Monorepo & Core Foundation
- npm workspaces + TypeScript project references + Vitest.
- All `@core` types from §3 (data, pose, animation) — they are the contract for everything else.
- Topological sort, index baking, `Skeleton.rebuild()`.
- FK solver (`Float32Array`, allocation-free) with unit tests against golden matrices.
- **Simple JSON save/load NOW, not in Phase 7** (file download/upload is ~50 lines) — rigging
  work in later phases produces data worth keeping.
- `@runtime` API stubs that compile against `@core` types.

### Phase 2 — Rigging & Undo/Redo
- `EditorEngine`, Zustand store with `dataRevision` pattern, `HistoryManager`.
- Commands: `AddBone`, `RemoveBone`, `ReparentBone`, `MoveBone` (continuous), structural ones
  wired to `skeleton.rebuild()`.
- `<HierarchyPanel />` tree (drag to reparent via `ReparentBone`).
- Bone gizmos in Pixi (drawn strictly from `SkeletonPose`), viewport pan (middle mouse) and
  zoom (wheel) via a root container.
- Hit-testing with picking priorities.

### Phase 3 — Animation & Timeline
- Mixer in `@core`: reset-to-setup, binary-search keyframes, linear/stepped/bezier
  (with the §4.5 solver), multi-track weights.
- `AnimationState` with `setAnimation`/`addAnimation`/crossfade — the editor uses a single
  track, but the mixing path is built and tested here.
- `<TimelinePanel />` dopesheet (HTML/CSS grid; typed timelines drive the row structure).
- Auto-keyframing + Setup/Animate mode workflow (§5.6).
- Transient playhead (60fps without React re-renders).

### Phase 4 — Attachments, Draw Order & Skins
- Texture registry; drag-and-drop loading via **File API + `URL.createObjectURL`**
  (drag-and-drop is NOT File System Access API — that is for opening/saving project files;
  both are used, for different jobs).
- Region attachments bound to slots; verify bone motion drives sprites.
- Draw order (pose `slotOrder` array) + `DrawOrderTimeline`.
- Skins (swap `attachmentId` per active skin) + `SlotColorTimeline` / `SlotAttachmentTimeline`.

### Phase 5 — Meshes, Weights & Deform
- Pixi `Mesh` rendering with custom `MeshGeometry`.
- Mesh editing tool (add/move vertices, earcut triangulation).
- Weight painting UI writing the interleaved index-based format from §3.1.
- Weighted skinning step in the pipeline (after IK).
- `DeformTimeline` support (per-vertex animation — the path to facial animation).

### Phase 6 — Constraints
- IK solver in `@core` (1-bone and 2-bone analytic), top-level ordered constraint list,
  pole vectors.
- UI: create IK targets, edit constraint properties.

### Phase 7 — Persistence & Export
- IndexedDB autosave: every 30s **and** after every committed structural command.
- File System Access API for project open/save (real files, not downloads).
- Versioned JSON export + migration runner (§8.3).

### Phase 8 — Atlas, Events & Runtime Polish
- Atlas packing with `free-tex-packer-core`; re-bake attachment UVs to atlas regions (§3.5).
- `EventTimeline` in the editor; event callbacks in `@runtime`.
- Runtime size/perf pass: tree-shake editor dependencies, bundle audit, load-time test.

## 8. Technical Decisions & Best Practices

### 8.1 Rotation: Radians Internally, Degrees in UI
`Transform.rotation` is radians everywhere in `@core` — millions of deg/rad conversions in the FK
loop are pure waste. `<PropertiesPanel />` converts to degrees on display and back on edit.

### 8.2 Memory & GC Discipline
- `worldMatrices`, mesh vertex buffers, and scratch vectors are preallocated once.
- No object creation inside `app.ticker` callbacks, the mixer, or skinning — reuse static
  temporaries.
- Colors travel as packed uint32; string colors exist only at the UI boundary.
- When an attachment or texture is deleted: `Texture.destroy(true)` to free the GPU side, revoke
  the object URL, and drop the registry entry — leaking GPU textures will crash the tab.
- `<ViewportCanvas />` cleanup destroys the Pixi `Application` (race-safe, §5.5).

### 8.3 File Versioning & Migrations

```jsonc
{ "version": 1, "skeleton": {}, "animations": [], "assetManifest": {} }
```

On load: compare `version` to `FORMAT_VERSION`; if older, run an ordered chain of migration
functions (`migrate1to2`, `migrate2to3`, …). Never assume backward compatibility without a
migration. A rejected future version (newer than current) fails loudly with a clear message.

### 8.4 UI Reactivity Contract
- React components subscribe only to UI state + `dataRevision`.
- The Pixi ticker and the playhead are updated through engine transient channels — never by
  setting 60fps values into Zustand.

### 8.5 Command Discipline
Every mutation of document/pose goes through a Command (immediate-mode scratch manipulation is
allowed only between `open()` and `commit()` of a `ContinuousCommand`). Structural commands
rebuild the skeleton index space; auto-key commands are atomic across pose + keyframes.

### 8.6 Secure Context Requirements
`crypto.randomUUID()`, File System Access API, and `IndexedDB` (in some embedded contexts)
require a secure context (`https://` or `localhost`). Ship a UUID fallback (e.g. `crypto.getRandomValues`
-based) so the editor also runs from a plain-HTTP LAN URL.

### 8.7 Testing Strategy
- `@core` is pure TS — the majority of tests live here: FK against golden matrices, IK against
  known poses, mixer interpolation edge cases (stepped at t=0, bezier overshoot, crossfade sums,
  event crossing at exact keyframe times), serialization round-trips, migration chains.
- `@editor`: component tests for panels reading `dataRevision`; a Playwright smoke test for the
  Phase 2 workflow (add bone -> drag -> undo -> redo).

## 9. Summary of Changes Since V2

| # | Change | Why |
|---|--------|-----|
| 1 | Removed `BonePose.world: Transform`; world transforms exist only as 2x3 matrices in `worldMatrices` | Decomposing a composed world transform under non-uniform parent scale/shear is lossy; also removes the duplicate source of truth |
| 2 | Typed timelines (discriminated union) replace the generic `property: string` timeline | `attachment` (string), draw order (permutation), and color don't fit `value: number` |
| 3 | Weights reference bone **indices** (topological), format fully specified | `number[]` vs string UUIDs was inconsistent; index space now matches the FK solver |
| 4 | IK constraints moved to a top-level ordered array with `bones[]` chain + pole vector | 2-bone IK needs a chain; multi-constraint solve order must be explicit |
| 5 | Explicit reset-to-setup step in the pipeline; dropped `appliedValid` flag | Per-bone "was animated" flags break with mixing; the reset is nearly free |
| 6 | `AnimationState` designed for multi-track weights/crossfade/queue from day one | Animation mixing is the heart of the runtime; retrofitting means rewriting the mixer |
| 7 | Playback clock moved from Zustand into `EditorEngine`; playhead updates transiently | `currentTime` at 60fps in the store re-renders the tree every frame |
| 8 | History moved to a module-level `HistoryManager`; store exposes `canUndo`/`canRedo` | Mutating Zustand state outside `set()` is an anti-pattern |
| 9 | Continuous commands (coalescing) + atomic auto-key + rebuild-on-structural-undo rules | Dragging must be one undo step; index shifts must not corrupt the pose |
| 10 | Colors as packed uint32 everywhere past the UI boundary | No string parsing in hot paths |
| 11 | Bezier `cy` unbounded (overshoot allowed); iterative solver spec'd | `[0,1]` on both axes makes bounce/back eases impossible |
| 12 | Ticker delta capped at 100ms | Background tabs / breakpoints must not fast-forward playback |
| 13 | Simple JSON save/load moved to Phase 1; FSAA vs drag-and-drop terminology fixed | Hours of rigging shouldn't be losable; the two file APIs serve different jobs |
| 14 | Runtime API surface (incl. animation state machine) defined up front | Editor export format and core mixer must stay runtime-compatible |
| 15 | `textureId` + asset manifest instead of `textureUrl` | Atlas packing re-bakes UVs; attachments must not pin raw file URLs |
| 16 | Deform timelines added (Phase 5); secure-context notes and testing strategy added | Per-vertex animation is the path to facial work; UUID/FSAA need secure contexts |
| 17 | pnpm → npm workspaces (implementation) | pnpm not installed on the dev machine; npm 11 workspaces are equivalent and the `packages/*` layout stays pnpm-compatible |
| 18 | `version` field removed from `SkeletonData`; it lives only on `ExportedDocument` | A rig alone is versionless — the file format owns versioning, and two version fields would drift |
