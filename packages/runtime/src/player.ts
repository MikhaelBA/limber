import type { EventFrame, ExportedDocument } from '@limber/core';
import {
  AnimationState,
  Skeleton,
  resetPose,
  solveFK,
  solveConstraints,
  updateSkinning,
  validateDeformTimelines,
  validateAnimationEvents,
  FixedStepClock,
  SECONDARY_STEP_SECONDS,
} from '@limber/core';

export interface RuntimePlayerOptions {
  /** Default loop setting for animations started without an explicit loop flag. */
  loopDefault?: boolean;
}

export interface AnimationStartOptions {
  loop?: boolean;
  /** Crossfade length in seconds. */
  fadeDuration?: number;
}

export interface QueuedAnimationOptions extends AnimationStartOptions {
  /** Seconds to wait after the current animation before the queued one starts. */
  delay?: number;
}

export interface WireframeRenderOptions {
  /** Bone stick stroke color/width. */
  boneColor?: string;
  boneWidth?: number;
  /** Attachment outline stroke. */
  attachmentColor?: string;
  attachmentWidth?: number;
}

/**
 * Lightweight player for exported Limber documents (DESIGN.md §6) — the whole
 * pipeline (reset → mixer apply → FK → IK → skinning) in one `update()` call.
 * DOM-free and renderer-free: engines read world transforms / deformed
 * vertices; a Canvas2D wireframe helper is included for previews.
 *
 * ```ts
 * const player = new RuntimePlayer(doc);
 * player.setAnimation('walk');
 * player.onEvent((e) => sound.play(e.eventName));
 * function frame(dt) { player.update(dt); draw(player.getDeformedVertices(attId)); }
 * ```
 */
export class RuntimePlayer {
  private readonly skeleton: Skeleton;
  private readonly mixer = new AnimationState();
  private readonly secondaryClock = new FixedStepClock();
  private readonly listeners = new Set<(e: EventFrame) => void>();
  private readonly loopDefault: boolean;
  /** Events crossed during the last update() — also dispatched to onEvent(). */
  readonly events: EventFrame[] = [];
  readonly animations: ExportedDocument['animations'];

  constructor(
    doc:
      | ExportedDocument
      | { skeleton: ExportedDocument['skeleton']; animations: ExportedDocument['animations'] },
    opts: RuntimePlayerOptions = {},
  ) {
    validateDeformTimelines(doc.skeleton, doc.animations);
    validateAnimationEvents(doc.animations);
    this.skeleton = new Skeleton(doc.skeleton);
    this.animations = doc.animations;
    this.loopDefault = opts.loopDefault ?? true;
    this.update(0);
  }

  /** Integrates the clock and the whole posing pipeline. Call once per frame. */
  update(deltaSeconds: number): void {
    const motion = this.skeleton.secondaryMotion;
    if (motion) {
      this.events.length = 0;
      if (!motion.initialized) {
        this.secondaryClock.reset();
        this.sample();
        motion.rebase(this.skeleton);
      }
      const steps = this.secondaryClock.consume(deltaSeconds);
      for (let n = 0; n < steps; n++) {
        const previous = this.mixer.currentAnimationName;
        this.mixer.update(SECONDARY_STEP_SECONDS);
        const fired = this.sample();
        if (previous !== this.mixer.currentAnimationName) motion.rebase(this.skeleton);
        motion.evaluate(this.skeleton, true);
        for (const e of fired) {
          this.events.push(e);
          for (const cb of this.listeners) cb(e);
        }
      }
      if (steps === 0) {
        this.sample();
        motion.evaluate(this.skeleton, false);
      }
      updateSkinning(this.skeleton);
      return;
    }
    const dt = Math.min(Math.max(deltaSeconds, 0), 0.1); // Tab-stall guard.
    this.mixer.update(dt);
    const data = this.skeleton.data;
    resetPose(data, this.skeleton.pose);
    const fired = this.mixer.apply(this.skeleton);
    this.events.length = 0;
    for (const e of fired) {
      this.events.push(e);
      for (const cb of this.listeners) cb(e);
    }
    solveFK(data, this.skeleton.boneIndexMap, this.skeleton.pose);
    solveConstraints(this.skeleton);
    updateSkinning(this.skeleton);
  }

  private sample(): EventFrame[] {
    resetPose(this.skeleton.data, this.skeleton.pose);
    const events = this.mixer.apply(this.skeleton);
    solveFK(this.skeleton.data, this.skeleton.boneIndexMap, this.skeleton.pose);
    solveConstraints(this.skeleton);
    return events;
  }
  /** Rebase inertia at the current animation sample; use after an external teleport. */
  resetSecondaryMotion(): void {
    this.secondaryClock.reset();
    this.skeleton.secondaryMotion?.invalidate();
  }

  /**
   * Live view of the world transform array (6 floats per bone: [a, b, c, d, tx, ty]).
   * Do not retain or mutate — contents are rewritten by update().
   */
  getWorldTransforms(): Float32Array {
    return this.skeleton.pose.worldMatrices;
  }

  /**
   * WORLD-space, deform-applied, skinned vertices for one attachment — the
   * render-ready data (regions, meshes, bounding boxes, clipping polygons
   * alike). Read-only view; rewritten by update().
   */
  getDeformedVertices(attachmentId: string): Float32Array {
    const state = this.skeleton.pose.attachments.get(attachmentId);
    if (!state) throw new Error(`@limber/runtime: unknown attachment "${attachmentId}".`);
    return state.verts;
  }

  /** The attachment a slot currently shows (after skins/timelines), or null. */
  getSlotAttachmentId(slotIndex: number): string | null {
    return this.skeleton.pose.slots[slotIndex]?.attachmentId ?? null;
  }

  /** Packed 0xRRGGBBAA slot color after timelines. */
  getSlotColor(slotIndex: number): number {
    return this.skeleton.pose.slots[slotIndex]?.color ?? 0xffffffff;
  }

  /** Slot indices in draw order (front of the array = drawn first). */
  getDrawOrder(): readonly number[] {
    return this.skeleton.pose.slotOrder;
  }

  /** Switches the active skin — affects slots on the next update(). */
  setSkin(name: string): void {
    this.skeleton.data.activeSkin = name;
  }

  /** Seconds into the current animation (after looping/fades). */
  get time(): number {
    return this.mixer.time;
  }

  /** Duration of the current animation in seconds. */
  get duration(): number {
    return this.mixer.duration;
  }

  setAnimation(name: string, opts: AnimationStartOptions = {}): void {
    this.mixer.setAnimation(this.requireAnimation(name), {
      loop: opts.loop ?? this.loopDefault,
      fadeDuration: opts.fadeDuration ?? 0,
    });
    this.resetSecondaryMotion();
  }

  addAnimation(name: string, opts: QueuedAnimationOptions = {}): void {
    this.mixer.addAnimation(this.requireAnimation(name), {
      loop: opts.loop ?? this.loopDefault,
      fadeDuration: opts.fadeDuration ?? 0,
      delay: opts.delay ?? 0,
    });
  }

  /** Subscribes to animation events; returns the unsubscribe function. */
  onEvent(cb: (e: EventFrame) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private requireAnimation(name: string) {
    const anim = this.animations.find((a) => a.name === name);
    if (!anim) {
      throw new Error(
        `@limber/runtime: no animation "${name}" (${this.animations.map((a) => a.name).join(', ') || 'none'}).`,
      );
    }
    return anim;
  }
}

/**
 * Canvas2D wireframe preview: bone sticks + attachment outlines in the
 * player's world space (y-down — canvas-friendly). Renderer-agnostic games
 * read the vertex data instead; this exists for quick visualization.
 */
export function renderWireframe(
  ctx: CanvasRenderingContext2D,
  player: RuntimePlayer,
  opts: WireframeRenderOptions = {},
): void {
  const bones = opts.boneColor ?? '#6aa9ff';
  const boneW = opts.boneWidth ?? 2;
  const atts = opts.attachmentColor ?? 'rgba(53, 208, 165, 0.9)';
  const attW = opts.attachmentWidth ?? 1.5;
  const wm = player.getWorldTransforms();

  // Attachment outlines straight from the skinning cache.
  ctx.strokeStyle = atts;
  ctx.lineWidth = attW;
  for (const slotIndex of player.getDrawOrder()) {
    const attId = player.getSlotAttachmentId(slotIndex);
    if (!attId) continue;
    const verts = player.getDeformedVertices(attId);
    if (verts.length < 4) continue;
    ctx.beginPath();
    ctx.moveTo(verts[0]!, verts[1]!);
    for (let k = 1; k < verts.length / 2; k++) ctx.lineTo(verts[k * 2]!, verts[k * 2 + 1]!);
    ctx.closePath();
    ctx.stroke();
  }

  // Bone sticks: origin → +x-axis (fixed visual length).
  ctx.strokeStyle = bones;
  ctx.lineWidth = boneW;
  for (let i = 0; i < wm.length / 6; i++) {
    const o = i * 6;
    const ox = wm[o + 4]!;
    const oy = wm[o + 5]!;
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ox + wm[o]! * 30, oy + wm[o + 1]! * 30);
    ctx.stroke();
  }
}
