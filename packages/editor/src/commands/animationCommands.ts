import type { Animation, NumberKeyframe } from '@sprine/core';
import { defaultCurve } from '@sprine/core';
import type { EditorEngine } from '../engine/EditorEngine';
import type { Command } from '../history/history';

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
