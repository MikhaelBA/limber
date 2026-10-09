import type {
  Animation,
  ColorKeyframe,
  Curve,
  DeformKeyframe,
  DeformTimeline,
  DrawOrderKeyframe,
  DrawOrderTimeline,
  EventKeyframe,
  EventTimeline,
  NumberKeyframe,
  SlotColorTimeline,
} from '@limber/core';
import { defaultCurve, validateDeformTimelines } from '@limber/core';
import type { EditorEngine } from '../engine/EditorEngine';
import type { Command } from '../history/history';

/** Draw order never interpolates — permutation keyframes are stepped (§3.3). */
function steppedCurve() {
  return { type: 'stepped' as const };
}

export type BonePropertyName = 'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY' | 'shearX' | 'shearY';

// ---------- keyframe data helpers (mutate the document directly) ----------

function findTimeline(
  anim: Animation,
  boneId: string,
  property: BonePropertyName,
): Extract<Animation['timelines'][number], { kind: 'boneProperty' }> | undefined {
  return anim.timelines.find(
    (tl): tl is Extract<Animation['timelines'][number], { kind: 'boneProperty' }> =>
      tl.kind === 'boneProperty' && tl.boneId === boneId && tl.property === property,
  );
}

function cloneKeyframes(kfs: NumberKeyframe[]): NumberKeyframe[] {
  return kfs.map((kf) => ({ ...kf, curve: { ...kf.curve } }));
}

/** Inserts or replaces the keyframe at exactly `time`; keeps the list sorted. */
export function upsertKeyframe(
  anim: Animation,
  boneId: string,
  property: BonePropertyName,
  time: number,
  value: number,
): void {
  let tl = findTimeline(anim, boneId, property);
  if (!tl) {
    tl = { kind: 'boneProperty', boneId, property, keyframes: [] };
    anim.timelines.push(tl);
  }
  const kfs = tl.keyframes;
  let at = kfs.findIndex((kf) => Math.abs(kf.time - time) < 1e-6);
  if (at >= 0) {
    kfs[at]!.value = value;
    return;
  }
  at = kfs.findIndex((kf) => kf.time > time);
  const kf: NumberKeyframe = { time, value, curve: defaultCurve() };
  if (at === -1) kfs.push(kf);
  else kfs.splice(at, 0, kf);
}

interface TimelineSnapshot {
  existed: boolean;
  timelineIndex: number;
  keyframes: NumberKeyframe[] | null;
}

function snapshot(anim: Animation, boneId: string, property: BonePropertyName): TimelineSnapshot {
  const tl = findTimeline(anim, boneId, property);
  return tl
    ? { existed: true, timelineIndex: anim.timelines.indexOf(tl), keyframes: cloneKeyframes(tl.keyframes) }
    : { existed: false, timelineIndex: -1, keyframes: null };
}

function restore(anim: Animation, boneId: string, property: BonePropertyName, snap: TimelineSnapshot): void {
  const tl = findTimeline(anim, boneId, property);
  if (snap.existed) {
    if (tl) tl.keyframes = cloneKeyframes(snap.keyframes!);
    else anim.timelines.splice(Math.min(snap.timelineIndex, anim.timelines.length), 0, {
      kind: 'boneProperty',
      boneId,
      property,
      keyframes: cloneKeyframes(snap.keyframes!),
    });
  } else if (tl) {
    anim.timelines.splice(anim.timelines.indexOf(tl), 1);
  }
}

function requireAnimation(engine: EditorEngine): Animation {
  const anim = engine.currentAnimation;
  if (!anim) throw new Error('No active animation (switch to Animate mode with an animation selected).');
  return anim;
}

function refreshDuration(anim: Animation): void {
  // Keep duration >= the last keyframe so nothing is parked off-range.
  let max = 0;
  for (const tl of anim.timelines) {
    const kfs = tl.keyframes;
    if (kfs.length > 0) max = Math.max(max, kfs[kfs.length - 1]!.time);
  }
  if (anim.duration < max) anim.duration = max;
}

// -------------------------- animation CRUD --------------------------

export class AddAnimationCommand implements Command {
  /** Placeholder until first do() — two commands constructed together must not collide. */
  name = 'animation';
  private named = false;
  private _label = 'Add Animation';

  constructor(private engine: EditorEngine, base = 'animation') {
    this.name = base;
  }

  get label(): string {
    return this._label;
  }

  do(): void {
    if (!this.named) {
      const names = new Set(this.engine.document.animations.map((a) => a.name));
      let i = 2;
      while (names.has(this.name)) this.name = `${this.name.replace(/\d+$/, '')}${i++}`;
      this.named = true;
      this._label = `Add Animation ${this.name}`;
    }
    this.engine.document.animations.push({
      name: this.name,
      duration: 1.5,
      loop: true,
      timelines: [],
    });
  }

  undo(): void {
    const anims = this.engine.document.animations;
    anims.splice(anims.findIndex((a) => a.name === this.name), 1);
    if (this.engine.activeAnimationName === this.name) this.engine.setAnimation(null);
  }
}

export class RemoveAnimationCommand implements Command {
  readonly label: string;
  private index: number;
  private removed: Animation | null = null;

  constructor(
    private engine: EditorEngine,
    readonly name: string,
  ) {
    this.index = engine.document.animations.findIndex((a) => a.name === name);
    this.label = `Delete Animation ${name}`;
  }

  do(): void {
    if (this.index < 0) return;
    this.removed = this.engine.document.animations.splice(this.index, 1)[0] ?? null;
    if (this.engine.activeAnimationName === this.name) this.engine.setAnimation(null);
  }

  undo(): void {
    if (!this.removed) return;
    this.engine.document.animations.splice(Math.min(this.index, this.engine.document.animations.length), 0, this.removed);
  }
}

export interface AnimationMeta {
  loop?: boolean;
  duration?: number;
  newName?: string;
}

function engineIsActive(engine: EditorEngine, name: string): boolean {
  return engine.activeAnimationName === name && engine.document.animations.some((a) => a.name === name);
}

export class SetAnimationMetaCommand implements Command {
  readonly label = 'Edit Animation';
  private before: Required<Pick<Animation, 'name' | 'loop' | 'duration'>>;
  private after: Required<Pick<Animation, 'name' | 'loop' | 'duration'>>;

  constructor(
    private engine: EditorEngine,
    readonly name: string,
    edits: AnimationMeta,
  ) {
    const anim = engine.document.animations.find((a) => a.name === name)!;
    this.anim = anim;
    this.before = { name: anim.name, loop: anim.loop, duration: anim.duration };
    this.after = {
      name: edits.newName ?? anim.name,
      loop: edits.loop ?? anim.loop,
      duration: Math.max(0.01, edits.duration ?? anim.duration),
    };
  }

  private anim: Animation;

  private applyTo(meta: Required<Pick<Animation, 'name' | 'loop' | 'duration'>>): void {
    // Check activity BEFORE renaming, against BOTH names — afterwards the old
    // name no longer resolves (undo restores it while the engine points at
    // the new one, and vice versa).
    const wasActive =
      engineIsActive(this.engine, this.name) || engineIsActive(this.engine, meta.name) || this.engine.currentAnimation === this.anim;
    this.anim.name = meta.name;
    this.anim.loop = meta.loop;
    this.anim.duration = meta.duration;
    if (wasActive) {
      // animState holds the same Animation object — only the engine's name
      // pointer needs updating, no clock reset.
      this.engine.activeAnimationName = meta.name;
    }
  }

  do(): void {
    this.applyTo(this.after);
  }

  undo(): void {
    this.applyTo(this.before);
  }
}

// -------------------------- keyframe commands --------------------------

/** Sets one property key at the playhead (properties panel in Animate mode). */
export class SetKeyframeCommand implements Command {
  readonly label: string;
  private before: TimelineSnapshot;

  constructor(
    private engine: EditorEngine,
    private boneId: string,
    private property: BonePropertyName,
    private time: number,
    private value: number,
  ) {
    this.before = snapshot(requireAnimation(engine), boneId, property);
    this.label = `Key ${property}`;
  }

  do(): void {
    const anim = requireAnimation(this.engine);
    upsertKeyframe(anim, this.boneId, this.property, this.time, this.value);
    refreshDuration(anim);
  }

  undo(): void {
    restore(requireAnimation(this.engine), this.boneId, this.property, this.before);
  }
}

/**
 * Continuous SINGLE-property drag in ANIMATE mode (rotate/scale/shear tools):
 * each pointermove re-keys the property at the playhead. Same lifecycle and
 * undo semantics as AutoKeyMoveBoneCommand.
 */
export class AutoKeyBonePropCommand implements Command {
  readonly label: string;
  private before: TimelineSnapshot | null = null;
  private after: TimelineSnapshot | null = null;

  constructor(
    private engine: EditorEngine,
    private boneId: string,
    private prop: BonePropertyName,
  ) {
    this.label = `Auto-Key ${prop}`;
  }

  open(): void {
    this.before = snapshot(requireAnimation(this.engine), this.boneId, this.prop);
  }

  set(value: number): void {
    const anim = requireAnimation(this.engine);
    upsertKeyframe(anim, this.boneId, this.prop, this.engine.currentTime, value);
    refreshDuration(anim);
  }

  commit(): void {
    this.after = snapshot(requireAnimation(this.engine), this.boneId, this.prop);
  }

  get changed(): boolean {
    return (
      this.before !== null &&
      this.after !== null &&
      JSON.stringify(this.before.keyframes) !== JSON.stringify(this.after.keyframes)
    );
  }

  do(): void {
    if (this.after) restore(requireAnimation(this.engine), this.boneId, this.prop, this.after);
  }

  undo(): void {
    if (this.before) restore(requireAnimation(this.engine), this.boneId, this.prop, this.before);
  }
}

/**
 * Continuous drag in ANIMATE mode (DESIGN.md §5.6): each pointermove re-keys
 * x/y at the playhead; commit() captures the after-state. One undo step per
 * drag, reverting pose and keyframes atomically (§5.3).
 */
export class AutoKeyMoveBoneCommand implements Command {
  readonly label = 'Auto-Key Move';
  private beforeX: TimelineSnapshot | null = null;
  private beforeY: TimelineSnapshot | null = null;
  private afterX: TimelineSnapshot | null = null;
  private afterY: TimelineSnapshot | null = null;

  constructor(
    private engine: EditorEngine,
    private boneId: string,
  ) {}

  open(): void {
    const anim = requireAnimation(this.engine);
    this.beforeX = snapshot(anim, this.boneId, 'x');
    this.beforeY = snapshot(anim, this.boneId, 'y');
  }

  update(x: number, y: number): void {
    const anim = requireAnimation(this.engine);
    const t = this.engine.currentTime;
    upsertKeyframe(anim, this.boneId, 'x', t, x);
    upsertKeyframe(anim, this.boneId, 'y', t, y);
    refreshDuration(anim);
  }

  commit(): void {
    const anim = requireAnimation(this.engine);
    this.afterX = snapshot(anim, this.boneId, 'x');
    this.afterY = snapshot(anim, this.boneId, 'y');
  }

  get changed(): boolean {
    return (
      this.beforeX !== null &&
      this.afterX !== null &&
      (JSON.stringify(this.beforeX.keyframes) !== JSON.stringify(this.afterX.keyframes) ||
        JSON.stringify(this.beforeY?.keyframes) !== JSON.stringify(this.afterY?.keyframes))
    );
  }

  private restorePair(x: TimelineSnapshot, y: TimelineSnapshot): void {
    const anim = requireAnimation(this.engine);
    restore(anim, this.boneId, 'x', x);
    restore(anim, this.boneId, 'y', y);
  }

  do(): void {
    if (this.afterX && this.afterY) this.restorePair(this.afterX, this.afterY);
  }

  undo(): void {
    if (this.beforeX && this.beforeY) this.restorePair(this.beforeX, this.beforeY);
  }
}

export class MoveKeyframeCommand implements Command {
  readonly label: string;
  private before: TimelineSnapshot;

  constructor(
    private engine: EditorEngine,
    private boneId: string,
    private property: BonePropertyName,
    private fromTime: number,
    private toTime: number,
  ) {
    if (fromTime === toTime) throw new Error('MoveKeyframeCommand: no-op move.');
    this.before = snapshot(requireAnimation(engine), boneId, property);
    this.label = `Move Key ${property}`;
  }

  do(): void {
    const anim = requireAnimation(this.engine);
    const tl = findTimeline(anim, this.boneId, this.property);
    if (!tl) return;
    const kf = tl.keyframes.find((k) => Math.abs(k.time - this.fromTime) < 1e-6);
    if (!kf) return;
    kf.time = Math.min(Math.max(this.toTime, 0), anim.duration);
    tl.keyframes.sort((a, b) => a.time - b.time);
  }

  undo(): void {
    restore(requireAnimation(this.engine), this.boneId, this.property, this.before);
  }
}

export class DeleteKeyframeCommand implements Command {
  readonly label: string;
  private before: TimelineSnapshot;

  constructor(
    private engine: EditorEngine,
    private boneId: string,
    private property: BonePropertyName,
    private time: number,
  ) {
    this.before = snapshot(requireAnimation(engine), boneId, property);
    this.label = `Delete Key ${property}`;
  }

  do(): void {
    const anim = requireAnimation(this.engine);
    const tl = findTimeline(anim, this.boneId, this.property);
    if (!tl) return;
    const at = tl.keyframes.findIndex((k) => Math.abs(k.time - this.time) < 1e-6);
    if (at >= 0) tl.keyframes.splice(at, 1);
  }

  undo(): void {
    restore(requireAnimation(this.engine), this.boneId, this.property, this.before);
  }
}

/** Keys every transform property of a bone at the playhead ("Key" button). */
export class KeyBoneTransformCommand implements Command {
  readonly label = 'Key Transform';
  private befores: { property: BonePropertyName; snap: TimelineSnapshot }[] = [];

  constructor(
    private engine: EditorEngine,
    private boneId: string,
  ) {}

  do(): void {
    const anim = requireAnimation(this.engine);
    const boneIndex = this.engine.skeleton.boneIndexMap.get(this.boneId);
    if (boneIndex === undefined) return;
    // Key the CURRENT displayed pose (mixer output at the playhead), not the
    // setup pose — in Animate mode these differ whenever timelines are active.
    const local = this.engine.skeleton.pose.bones[boneIndex]!.local;
    const t = this.engine.currentTime;
    if (this.befores.length === 0) {
      // First execution captures the before-state; redo reuses it.
      for (const p of PROPERTIES) this.befores.push({ property: p, snap: snapshot(anim, this.boneId, p) });
    }
    for (const p of PROPERTIES) upsertKeyframe(anim, this.boneId, p, t, local[p]);
    refreshDuration(anim);
  }

  undo(): void {
    const anim = requireAnimation(this.engine);
    for (const { property, snap } of this.befores) restore(anim, this.boneId, property, snap);
  }
}

const PROPERTIES: BonePropertyName[] = ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'shearX', 'shearY'];

// ------------------- slot color & draw order keyframes -------------------

function findSlotColorTimeline(anim: Animation, slotId: string): SlotColorTimeline | undefined {
  return anim.timelines.find((tl): tl is SlotColorTimeline => tl.kind === 'slotColor' && tl.slotId === slotId);
}

function findDrawOrderTimeline(anim: Animation): DrawOrderTimeline | undefined {
  return anim.timelines.find((tl): tl is DrawOrderTimeline => tl.kind === 'drawOrder');
}

interface SlotColorSnapshot {
  existed: boolean;
  timelineIndex: number;
  keyframes: ColorKeyframe[] | null;
}

interface DrawOrderSnapshot {
  existed: boolean;
  timelineIndex: number;
  keyframes: DrawOrderKeyframe[] | null;
}

function snapshotSlotColor(anim: Animation, slotId: string): SlotColorSnapshot {
  const tl = findSlotColorTimeline(anim, slotId);
  return tl
    ? { existed: true, timelineIndex: anim.timelines.indexOf(tl), keyframes: tl.keyframes.map((k) => ({ ...k, curve: { ...k.curve } })) }
    : { existed: false, timelineIndex: -1, keyframes: null };
}

function snapshotDrawOrder(anim: Animation): DrawOrderSnapshot {
  const tl = findDrawOrderTimeline(anim);
  return tl
    ? {
        existed: true,
        timelineIndex: anim.timelines.indexOf(tl),
        keyframes: tl.keyframes.map((k) => ({ ...k, curve: { ...k.curve }, slotOrder: [...k.slotOrder] })),
      }
    : { existed: false, timelineIndex: -1, keyframes: null };
}

function restoreSlotColor(anim: Animation, slotId: string, snap: SlotColorSnapshot): void {
  const tl = findSlotColorTimeline(anim, slotId);
  if (snap.existed) {
    const kfs = snap.keyframes!.map((k) => ({ ...k, curve: { ...k.curve } }));
    if (tl) tl.keyframes = kfs;
    else anim.timelines.splice(Math.min(snap.timelineIndex, anim.timelines.length), 0, { kind: 'slotColor', slotId, keyframes: kfs });
  } else if (tl) {
    anim.timelines.splice(anim.timelines.indexOf(tl), 1);
  }
}

function restoreDrawOrder(anim: Animation, snap: DrawOrderSnapshot): void {
  const tl = findDrawOrderTimeline(anim);
  if (snap.existed) {
    const kfs = snap.keyframes!.map((k) => ({ ...k, curve: { ...k.curve }, slotOrder: [...k.slotOrder] }));
    if (tl) tl.keyframes = kfs;
    else anim.timelines.splice(Math.min(snap.timelineIndex, anim.timelines.length), 0, { kind: 'drawOrder', keyframes: kfs });
  } else if (tl) {
    anim.timelines.splice(anim.timelines.indexOf(tl), 1);
  }
}

/** Inserts/replaces a slot color key at exactly `time` (sorted, linear curve). */
export function upsertSlotColorKeyframe(anim: Animation, slotId: string, time: number, value: number): void {
  let tl = findSlotColorTimeline(anim, slotId);
  if (!tl) {
    tl = { kind: 'slotColor', slotId, keyframes: [] };
    anim.timelines.push(tl);
  }
  const kfs = tl.keyframes;
  const at = kfs.findIndex((kf) => Math.abs(kf.time - time) < 1e-6);
  if (at >= 0) {
    kfs[at]!.value = value;
    return;
  }
  const insert = kfs.findIndex((kf) => kf.time > time);
  const kf: ColorKeyframe = { time, value, curve: defaultCurve() };
  if (insert === -1) kfs.push(kf);
  else kfs.splice(insert, 0, kf);
}

/**
 * Keys a slot's color at the playhead. Defaults to the slot's CURRENT pose
 * color (mixer output — what the user sees), so the key matches the viewport.
 */
export class KeySlotColorCommand implements Command {
  readonly label: string;
  private readonly before: SlotColorSnapshot;
  private readonly value: number;

  constructor(
    private engine: EditorEngine,
    private slotId: string,
    color?: number,
  ) {
    const anim = requireAnimation(engine);
    this.before = snapshotSlotColor(anim, slotId);
    const slotIndex = engine.skeleton.slotIndexMap.get(slotId);
    this.value = color ?? (slotIndex !== undefined ? engine.skeleton.pose.slots[slotIndex]!.color : 0xffffffff);
    this.label = 'Key Slot Color';
  }

  do(): void {
    const anim = requireAnimation(this.engine);
    upsertSlotColorKeyframe(anim, this.slotId, this.engine.currentTime, this.value);
    refreshDuration(anim);
  }

  undo(): void {
    restoreSlotColor(requireAnimation(this.engine), this.slotId, this.before);
  }
}

export class DeleteSlotColorKeyframeCommand implements Command {
  readonly label = 'Delete Slot Color Key';
  private readonly before: SlotColorSnapshot;

  constructor(
    private engine: EditorEngine,
    private slotId: string,
    private time: number,
  ) {
    this.before = snapshotSlotColor(requireAnimation(engine), slotId);
  }

  do(): void {
    const tl = findSlotColorTimeline(requireAnimation(this.engine), this.slotId);
    if (!tl) return;
    const at = tl.keyframes.findIndex((k) => Math.abs(k.time - this.time) < 1e-6);
    if (at >= 0) tl.keyframes.splice(at, 1);
  }

  undo(): void {
    restoreSlotColor(requireAnimation(this.engine), this.slotId, this.before);
  }
}

/**
 * Keys the CURRENT draw order (pose.slotOrder permutation) at the playhead as
 * a stepped keyframe. `explicitOrder` overrides the capture — the animate-mode
 * reorder flow passes the fresh identity order because pose.slotOrder is
 * still holding the previously APPLIED (timeline) permutation at that moment.
 */
export class KeyDrawOrderCommand implements Command {
  readonly label = 'Key Draw Order';
  private readonly before: DrawOrderSnapshot;
  private readonly slotOrder: number[];

  constructor(private engine: EditorEngine, explicitOrder?: number[]) {
    const anim = requireAnimation(engine);
    this.before = snapshotDrawOrder(anim);
    this.slotOrder = [...(explicitOrder ?? engine.skeleton.pose.slotOrder)];
  }

  do(): void {
    const anim = requireAnimation(this.engine);
    let tl = findDrawOrderTimeline(anim);
    if (!tl) {
      tl = { kind: 'drawOrder', keyframes: [] };
      anim.timelines.push(tl);
    }
    const kfs = tl.keyframes;
    const at = kfs.findIndex((kf) => Math.abs(kf.time - this.engine.currentTime) < 1e-6);
    const kf: DrawOrderKeyframe = { time: this.engine.currentTime, slotOrder: [...this.slotOrder], curve: steppedCurve() };
    if (at >= 0) kfs[at] = kf;
    else {
      const insert = kfs.findIndex((k) => k.time > this.engine.currentTime);
      if (insert === -1) kfs.push(kf);
      else kfs.splice(insert, 0, kf);
    }
    refreshDuration(anim);
  }

  undo(): void {
    restoreDrawOrder(requireAnimation(this.engine), this.before);
  }
}

export class DeleteDrawOrderKeyframeCommand implements Command {
  readonly label = 'Delete Draw Order Key';
  private readonly before: DrawOrderSnapshot;

  constructor(
    private engine: EditorEngine,
    private time: number,
  ) {
    this.before = snapshotDrawOrder(requireAnimation(engine));
  }

  do(): void {
    const tl = findDrawOrderTimeline(requireAnimation(this.engine));
    if (!tl) return;
    const at = tl.keyframes.findIndex((k) => Math.abs(k.time - this.time) < 1e-6);
    if (at >= 0) tl.keyframes.splice(at, 1);
  }

  undo(): void {
    restoreDrawOrder(requireAnimation(this.engine), this.before);
  }
}

// ------------------- deform keyframes (Phase 5) -------------------

function findDeformTimeline(anim: Animation, attachmentId: string): DeformTimeline | undefined {
  return anim.timelines.find((tl): tl is DeformTimeline => tl.kind === 'deform' && tl.attachmentId === attachmentId);
}

export interface DeformSnapshot {
  existed: boolean;
  timelineIndex: number;
  keyframes: DeformKeyframe[] | null;
}

function cloneDeformKeyframes(kfs: DeformKeyframe[]): DeformKeyframe[] {
  return kfs.map((k) => ({ ...k, curve: { ...k.curve }, offsets: k.offsets ? [...k.offsets] : null }));
}

function snapshotDeform(anim: Animation, attachmentId: string): DeformSnapshot {
  const tl = findDeformTimeline(anim, attachmentId);
  return tl
    ? { existed: true, timelineIndex: anim.timelines.indexOf(tl), keyframes: cloneDeformKeyframes(tl.keyframes) }
    : { existed: false, timelineIndex: -1, keyframes: null };
}

function restoreDeform(anim: Animation, attachmentId: string, snap: DeformSnapshot): void {
  const tl = findDeformTimeline(anim, attachmentId);
  if (snap.existed) {
    const kfs = cloneDeformKeyframes(snap.keyframes!);
    if (tl) tl.keyframes = kfs;
    else anim.timelines.splice(Math.min(snap.timelineIndex, anim.timelines.length), 0, { kind: 'deform', attachmentId, keyframes: kfs });
  } else if (tl) {
    anim.timelines.splice(anim.timelines.indexOf(tl), 1);
  }
}

/** Inserts/replaces a deform key at exactly `time` (sorted, linear curve). */
export function upsertDeformKeyframe(
  anim: Animation,
  attachmentId: string,
  time: number,
  offsets: number[] | null,
): void {
  if (!Number.isFinite(time) || time < 0 || (offsets !== null &&
      (!Array.isArray(offsets) || offsets.length < 6 || offsets.length % 2 !== 0 || offsets.some((value) => !Number.isFinite(value) || !Number.isFinite(Math.fround(value)))))) {
    throw new Error('Invalid Deform key: use finite nonnegative time and finite coordinate pairs.');
  }
  let tl = findDeformTimeline(anim, attachmentId);
  if (!tl) {
    tl = { kind: 'deform', attachmentId, keyframes: [] };
    anim.timelines.push(tl);
  }
  const kfs = tl.keyframes;
  const at = kfs.findIndex((kf) => Math.abs(kf.time - time) < 1e-6);
  if (at >= 0) {
    kfs[at]!.offsets = offsets === null ? null : [...offsets];
    return;
  }
  const kf: DeformKeyframe = { time, offsets: offsets === null ? null : [...offsets], curve: defaultCurve() };
  const insert = kfs.findIndex((k) => k.time > time);
  if (insert === -1) kfs.push(kf);
  else kfs.splice(insert, 0, kf);
}

/**
 * Continuous mesh-vertex drag in ANIMATE mode (§5.6): each pointermove re-keys
 * the attachment's FULL deform offsets at the playhead. The base offsets are
 * captured at grab time (the interpolated pose), so only the dragged vertex
 * moves relative to the grab — exactly like AutoKeyMoveBoneCommand for bones.
 */
export class AutoKeyDeformCommand implements Command {
  readonly label = 'Auto-Key Deform';
  private before: DeformSnapshot | null = null;
  private after: DeformSnapshot | null = null;
  /** Interpolated offsets at grab time — the drag's starting point. */
  private base: number[] | null = null;

  constructor(
    private engine: EditorEngine,
    private attachmentId: string,
  ) {}

  open(): void {
    const anim = requireAnimation(this.engine);
    this.before = snapshotDeform(anim, this.attachmentId);
    const state = this.engine.skeleton.pose.attachments.get(this.attachmentId);
    this.base = state ? [...state.deform] : null;
  }

  /** Writes bone-LOCAL vertex positions; offsets are vs the setup mesh. */
  update(vertexIndex: number, localX: number, localY: number): void {
    const a = this.engine.skeleton.data.attachments.find((x) => x.id === this.attachmentId);
    if (!a || a.type !== 'mesh' || !a.meshVertices || !this.base) return;
    const i = vertexIndex * 2;
    if (!Number.isInteger(vertexIndex) || vertexIndex < 0 || i + 1 >= this.base.length ||
        ![localX, localY].every((value) => Number.isFinite(value) && Number.isFinite(Math.fround(value)))) {
      throw new Error('Invalid Deform vertex or position.');
    }
    const offsets = [...this.base];
    offsets[i] = localX - a.meshVertices[i]!;
    offsets[i + 1] = localY - a.meshVertices[i + 1]!;
    const anim = requireAnimation(this.engine);
    const draft = { ...anim, timelines: structuredClone(anim.timelines.filter((timeline) => timeline.kind === 'deform' && timeline.attachmentId === this.attachmentId)) };
    upsertDeformKeyframe(draft, this.attachmentId, this.engine.currentTime, offsets);
    validateDeformTimelines(this.engine.skeleton.data, [draft]);
    upsertDeformKeyframe(anim, this.attachmentId, this.engine.currentTime, offsets);
    refreshDuration(anim);
  }

  commit(): void {
    this.after = snapshotDeform(requireAnimation(this.engine), this.attachmentId);
  }

  get changed(): boolean {
    return (
      this.after !== null &&
      this.before !== null &&
      JSON.stringify(this.before.keyframes) !== JSON.stringify(this.after.keyframes)
    );
  }

  do(): void {
    if (this.after) restoreDeform(requireAnimation(this.engine), this.attachmentId, this.after);
  }

  undo(): void {
    if (this.before) restoreDeform(requireAnimation(this.engine), this.attachmentId, this.before);
  }
}

export class DeleteDeformKeyframeCommand implements Command {
  readonly label = 'Delete Deform Key';
  private readonly before: DeformSnapshot;

  constructor(
    private engine: EditorEngine,
    private attachmentId: string,
    private time: number,
  ) {
    this.before = snapshotDeform(requireAnimation(engine), attachmentId);
  }

  do(): void {
    const tl = findDeformTimeline(requireAnimation(this.engine), this.attachmentId);
    if (!tl) return;
    const at = tl.keyframes.findIndex((k) => Math.abs(k.time - this.time) < 1e-6);
    if (at >= 0) tl.keyframes.splice(at, 1);
  }

  undo(): void {
    restoreDeform(requireAnimation(this.engine), this.attachmentId, this.before);
  }
}

// ------------------- event keyframes (Phase 7) -------------------

function findEventTimeline(anim: Animation): EventTimeline | undefined {
  return anim.timelines.find((tl): tl is EventTimeline => tl.kind === 'event');
}

interface EventSnapshot {
  existed: boolean;
  timelineIndex: number;
  keyframes: EventKeyframe[] | null;
}

function snapshotEvents(anim: Animation): EventSnapshot {
  const tl = findEventTimeline(anim);
  return tl
    ? { existed: true, timelineIndex: anim.timelines.indexOf(tl), keyframes: tl.keyframes.map((k) => ({ ...k, curve: { ...k.curve } })) }
    : { existed: false, timelineIndex: -1, keyframes: null };
}

function restoreEvents(anim: Animation, snap: EventSnapshot): void {
  const tl = findEventTimeline(anim);
  if (snap.existed) {
    const kfs = snap.keyframes!.map((k) => ({ ...k, curve: { ...k.curve } }));
    if (tl) tl.keyframes = kfs;
    else anim.timelines.splice(Math.min(snap.timelineIndex, anim.timelines.length), 0, { kind: 'event', keyframes: kfs });
  } else if (tl) {
    anim.timelines.splice(anim.timelines.indexOf(tl), 1);
  }
}

/** Keys an event (name + optional payload) at the playhead. */
export class KeyEventCommand implements Command {
  readonly label: string;
  private readonly before: EventSnapshot;

  constructor(
    private engine: EditorEngine,
    readonly eventName: string,
    private payload?: number | string,
  ) {
    this.before = snapshotEvents(requireAnimation(engine));
    this.label = `Key Event ${eventName}`;
  }

  do(): void {
    const anim = requireAnimation(this.engine);
    let tl = findEventTimeline(anim);
    if (!tl) {
      tl = { kind: 'event', keyframes: [] };
      anim.timelines.push(tl);
    }
    const kf: EventKeyframe = {
      time: this.engine.currentTime,
      eventName: this.eventName,
      ...(this.payload !== undefined ? { payload: this.payload } : {}),
      curve: steppedCurve(),
    };
    const at = tl.keyframes.findIndex((k) => Math.abs(k.time - kf.time) < 1e-6 && k.eventName === this.eventName);
    if (at >= 0) tl.keyframes[at] = kf;
    else {
      const insert = tl.keyframes.findIndex((k) => k.time > kf.time);
      if (insert === -1) tl.keyframes.push(kf);
      else tl.keyframes.splice(insert, 0, kf);
    }
    refreshDuration(anim);
  }

  undo(): void {
    restoreEvents(requireAnimation(this.engine), this.before);
  }
}

/** Deletes the event key at (time, name) — several events may share a time. */
export class DeleteEventKeyframeCommand implements Command {
  readonly label = 'Delete Event Key';
  private readonly before: EventSnapshot;

  constructor(
    private engine: EditorEngine,
    private time: number,
    private eventName: string,
  ) {
    this.before = snapshotEvents(requireAnimation(engine));
  }

  do(): void {
    const tl = findEventTimeline(requireAnimation(this.engine));
    if (!tl) return;
    const at = tl.keyframes.findIndex((k) => Math.abs(k.time - this.time) < 1e-6 && k.eventName === this.eventName);
    if (at >= 0) tl.keyframes.splice(at, 1);
  }

  undo(): void {
    restoreEvents(requireAnimation(this.engine), this.before);
  }
}

// ------------------- keyframe curves (Phase 7 QoL) -------------------

/** Curve presets for the dopesheet's selected keyframe. */
export const CURVE_PRESETS: { id: string; label: string; curve: Curve }[] = [
  { id: 'linear', label: 'linear', curve: { type: 'linear' } },
  { id: 'stepped', label: 'stepped', curve: { type: 'stepped' } },
  { id: 'ease-in', label: 'ease in', curve: { type: 'bezier', c1: 0.42, c2: 0, c3: 1, c4: 1 } },
  { id: 'ease-out', label: 'ease out', curve: { type: 'bezier', c1: 0, c2: 0, c3: 0.58, c4: 1 } },
  { id: 'ease-in-out', label: 'ease in-out', curve: { type: 'bezier', c1: 0.42, c2: 0, c3: 0.58, c4: 1 } },
];

/** Rewrites the curve leaving the selected keyframe (bone/slotColor/deform). */
export class SetKeyframeCurveCommand implements Command {
  readonly label = 'Set Curve';
  private before: Curve | null = null;

  constructor(
    private engine: EditorEngine,
    private sel: { kind: 'bone'; boneId: string; property: BonePropertyName; time: number }
      | { kind: 'slotColor'; slotId: string; time: number }
      | { kind: 'deform'; attachmentId: string; time: number },
    private curve: Curve,
  ) {}

  private find(): { curve: Curve } | null {
    const anim = requireAnimation(this.engine);
    if (this.sel.kind === 'bone') {
      const tl = findTimeline(anim, this.sel.boneId, this.sel.property);
      const kf = tl?.keyframes.find((k) => Math.abs(k.time - this.sel.time) < 1e-6);
      return kf ?? null;
    }
    if (this.sel.kind === 'slotColor') {
      const tl = findSlotColorTimeline(anim, this.sel.slotId);
      const kf = tl?.keyframes.find((k) => Math.abs(k.time - this.sel.time) < 1e-6);
      return kf ?? null;
    }
    const tl = findDeformTimeline(anim, this.sel.attachmentId);
    const kf = tl?.keyframes.find((k) => Math.abs(k.time - (this.sel as { time: number }).time) < 1e-6);
    return kf ?? null;
  }

  do(): void {
    const kf = this.find();
    if (!kf) return;
    if (this.sel.kind === 'deform') {
      const animation = requireAnimation(this.engine);
      const track = structuredClone(findDeformTimeline(animation, this.sel.attachmentId)!);
      const key = track.keyframes.find((item) => Math.abs(item.time - this.sel.time) < 1e-6)!;
      key.curve = structuredClone(this.curve);
      validateDeformTimelines(this.engine.skeleton.data, [{ ...animation, timelines: [track] }]);
    }
    if (this.before === null) this.before = { ...kf.curve };
    kf.curve = structuredClone(this.curve);
  }

  undo(): void {
    const kf = this.find();
    if (!kf || this.before === null) return;
    kf.curve = { ...this.before };
  }
}

/**
 * Captured deform timelines across ALL animations for one attachment — used by
 * mesh topology edits (add/remove vertex). A vertex-count change desyncs every
 * offsets array (per-vertex interleaved), so those keys are invalid: strip and
 * restore atomically with the topology change.
 */
export interface DeformTimelineCapture {
  animation: Animation;
  attachmentId: string;
  snapshot: DeformSnapshot;
}

/** Removes (and captures) every deform timeline targeting `attachmentId`. */
export function stripDeformTimelines(engine: EditorEngine, attachmentId: string): DeformTimelineCapture[] {
  const captures: DeformTimelineCapture[] = [];
  for (const anim of engine.document.animations) {
    const snap = snapshotDeform(anim, attachmentId);
    if (!snap.existed) continue;
    const tl = findDeformTimeline(anim, attachmentId);
    if (tl) anim.timelines.splice(anim.timelines.indexOf(tl), 1);
    captures.push({ animation: anim, attachmentId, snapshot: snap });
  }
  return captures;
}

export function restoreDeformTimelines(captures: DeformTimelineCapture[]): void {
  for (const { animation, attachmentId, snapshot } of captures) {
    restoreDeform(animation, attachmentId, snapshot);
  }
}
