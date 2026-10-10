import type { BoneData, SkeletonData, Transform } from '@limber/core';
import { uuid } from '@limber/core';
import type { EditorEngine } from '../engine/EditorEngine';
import type { Command } from '../history/history';
import { decomposeAffine, worldToLocalAffine } from '../math/matrix';
import { applyRigSnapshot, captureRig, editRig, prepareRigEdit, type RigSnapshot } from './rigEdits';
import { removeSlotReferences } from './slotCommands';

function cloneTransform(t: Transform): Transform {
  return {
    x: t.x,
    y: t.y,
    rotation: t.rotation,
    scaleX: t.scaleX,
    scaleY: t.scaleY,
    shearX: t.shearX,
    shearY: t.shearY,
  };
}

function uniqueBoneName(data: SkeletonData, base: string): string {
  const names = new Set(data.bones.map((b) => b.name));
  let name = base;
  let i = 2;
  while (names.has(name)) name = base + i++;
  return name;
}

/** True if `ancestorId` is `boneId`'s ancestor (or equal). Walks parentId links. */
export function isAncestor(data: SkeletonData, ancestorId: string, boneId: string): boolean {
  const byId = new Map(data.bones.map((b) => [b.id, b]));
  let cursor: BoneData | undefined = byId.get(boneId);
  while (cursor) {
    if (cursor.id === ancestorId) return true;
    cursor = cursor.parentId === null ? undefined : byId.get(cursor.parentId);
  }
  return false;
}

/** A reparent is invalid when it would create a cycle: onto itself or its own subtree. */
export function wouldCreateCycle(data: SkeletonData, boneId: string, newParentId: string | null): boolean {
  return newParentId !== null && isAncestor(data, boneId, newParentId);
}

/**
 * The world-preserving setup pose `boneId` would need under `newParentId`
 * (null = root): re-expresses the bone's setup world matrix in the new parent's
 * space, then uses the same affine convention as the FK solver.
 */
function reparentedSetup(engine: EditorEngine, boneId: string, newParentId: string | null): Transform {
  const sk = engine.skeleton;
  const worlds = engine.solveSetupWorlds();
  const bi = sk.boneIndexMap.get(boneId);
  if (bi === undefined) throw new Error(`Bone "${boneId}" not found.`);
  const w = new Float64Array(6);
  for (let k = 0; k < 6; k++) w[k] = worlds[bi * 6 + k]!;
  if (newParentId === null) {
    return decomposeAffine(w[0]!, w[1]!, w[2]!, w[3]!, w[4]!, w[5]!);
  }
  const pi = sk.boneIndexMap.get(newParentId);
  if (pi === undefined) throw new Error(`Parent bone "${newParentId}" not found.`);
  const p = new Float64Array(6);
  for (let k = 0; k < 6; k++) p[k] = worlds[pi * 6 + k]!;
  const l = new Float64Array(6);
  worldToLocalAffine(p, w, l);
  return decomposeAffine(l[0]!, l[1]!, l[2]!, l[3]!, l[4]!, l[5]!);
}

export class AddBoneCommand implements Command {
  readonly boneId: string;
  private readonly bone: BoneData;
  private named = false;
  private _label = 'Add Bone';

  /**
   * Spine create-tool semantics: a plain CLICK drops a default bone (length 50);
   * a DRAG sets the bone's rotation and length from the drag vector.
   */
  constructor(
    private engine: EditorEngine,
    parentId: string | null,
    local: { x: number; y: number },
    opts: { rotation?: number; length?: number } = {},
  ) {
    this.boneId = uuid();
    this.bone = {
      id: this.boneId,
      name: 'bone', // Placeholder — the unique name is chosen at first do().
      parentId,
      length: opts.length ?? 50,
      setupPose: {
        x: local.x,
        y: local.y,
        rotation: opts.rotation ?? 0,
        scaleX: 1,
        scaleY: 1,
        shearX: 0,
        shearY: 0,
      },
    };
  }

  /** Assigned on first do() so commands constructed together don't collide on names. */
  get label(): string {
    return this._label;
  }

  do(): void {
    if (!this.named) {
      this.bone.name = uniqueBoneName(this.engine.skeleton.data, 'bone');
      this._label = `Add Bone ${this.bone.name}`;
      this.named = true;
    }
    editRig(this.engine, (data) => {
      data.bones.push(structuredClone(this.bone));
    });
  }

  undo(): void {
    editRig(this.engine, (data) => {
      data.bones = data.bones.filter((b) => b.id !== this.bone.id);
    });
  }
}

/**
 * Continuous drag command (DESIGN.md §5.3): open() at pointerdown captures the
 * before-state, update() mutates the live document per pointermove (no history
 * involvement), commit() at pointerup finalizes. store.execute(cmd) afterwards
 * pushes ONE history entry — do() merely re-applies the after-state.
 */
export class MoveBoneCommand implements Command {
  readonly label = 'Move Bone';
  private before: { x: number; y: number } | null = null;
  private after: { x: number; y: number } | null = null;

  constructor(
    private engine: EditorEngine,
    private boneId: string,
  ) {}

  /** False when the drag never actually moved the bone — caller skips execute(). */
  get changed(): boolean {
    return (
      this.before !== null &&
      this.after !== null &&
      (this.before.x !== this.after.x || this.before.y !== this.after.y)
    );
  }

  open(): void {
    const setup = this.bone().setupPose;
    this.before = { x: setup.x, y: setup.y };
  }

  update(x: number, y: number): void {
    const setup = this.bone().setupPose;
    setup.x = x;
    setup.y = y;
  }

  commit(): void {
    const setup = this.bone().setupPose;
    this.after = { x: setup.x, y: setup.y };
  }

  do(): void {
    if (!this.after) return;
    const setup = this.bone().setupPose;
    setup.x = this.after.x;
    setup.y = this.after.y;
  }

  undo(): void {
    if (!this.before) return;
    const setup = this.bone().setupPose;
    setup.x = this.before.x;
    setup.y = this.before.y;
  }

  private bone(): BoneData {
    const bone = this.engine.skeleton.data.bones.find((b) => b.id === this.boneId);
    if (!bone) throw new Error(`MoveBoneCommand: bone "${this.boneId}" no longer exists.`);
    return bone;
  }
}

/**
 * SETUP-mode continuous drag over chosen Transform properties (rotate/scale/
 * shear tools, spine-tools semantics): open() at pointerdown, set() per move,
 * commit() at pointerup; ONE undo step per drag.
 */
export class DragBoneTransformCommand implements Command {
  readonly label: string;
  private before: Partial<Transform> | null = null;
  private after: Partial<Transform> | null = null;

  constructor(
    private engine: EditorEngine,
    private boneId: string,
    private props: ('rotation' | 'scaleX' | 'scaleY' | 'shearX' | 'shearY')[],
  ) {
    this.label = `Edit Bone (${props.join('/')})`;
  }

  get changed(): boolean {
    return (
      this.before !== null &&
      this.after !== null &&
      JSON.stringify(this.before) !== JSON.stringify(this.after)
    );
  }

  open(): void {
    this.before = this.pick();
  }

  set(prop: 'rotation' | 'scaleX' | 'scaleY' | 'shearX' | 'shearY', value: number): void {
    this.bone().setupPose[prop] = value;
  }

  commit(): void {
    this.after = this.pick();
  }

  do(): void {
    if (this.after) this.apply(this.after);
  }

  undo(): void {
    if (this.before) this.apply(this.before);
  }

  private pick(): Partial<Transform> {
    const out: Partial<Transform> = {};
    for (const p of this.props) out[p] = this.bone().setupPose[p];
    return out;
  }

  private apply(snap: Partial<Transform>): void {
    const setup = this.bone().setupPose;
    for (const p of this.props) {
      const v = snap[p];
      if (v !== undefined) setup[p] = v;
    }
  }

  private bone(): BoneData {
    const bone = this.engine.skeleton.data.bones.find((b) => b.id === this.boneId);
    if (!bone) throw new Error(`DragBoneTransformCommand: bone "${this.boneId}" no longer exists.`);
    return bone;
  }
}

/** SETUP-mode continuous bone-length drag (grabbing the tip, spine-tools). */
export class DragBoneLengthCommand implements Command {
  readonly label = 'Edit Bone Length';
  private before: number | null = null;
  private after: number | null = null;

  constructor(
    private engine: EditorEngine,
    private boneId: string,
  ) {}

  get changed(): boolean {
    return this.before !== null && this.after !== null && this.before !== this.after;
  }

  open(): void {
    this.before = this.bone().length;
  }

  set(length: number): void {
    this.bone().length = Math.max(1, length);
  }

  commit(): void {
    this.after = this.bone().length;
  }

  do(): void {
    if (this.after !== null) this.bone().length = this.after;
  }

  undo(): void {
    if (this.before !== null) this.bone().length = this.before;
  }

  private bone(): BoneData {
    const bone = this.engine.skeleton.data.bones.find((b) => b.id === this.boneId);
    if (!bone) throw new Error(`DragBoneLengthCommand: bone "${this.boneId}" no longer exists.`);
    return bone;
  }
}

/**
 * World-preserving reparent: the bone keeps its on-screen position/orientation;
 * its setup pose is re-expressed under the new parent.
 */
export class ReparentBoneCommand implements Command {
  readonly label: string;
  private readonly boneId: string;
  private readonly target: { parentId: string | null; setup: Transform };
  private before: RigSnapshot | null = null;
  private after: RigSnapshot | null = null;

  constructor(
    private engine: EditorEngine,
    boneId: string,
    newParentId: string | null,
  ) {
    const bone = this.bone(boneId);
    if (wouldCreateCycle(engine.skeleton.data, boneId, newParentId)) {
      throw new Error('Cannot reparent a bone to itself or its descendants.');
    }
    this.boneId = boneId;
    this.target = { parentId: newParentId, setup: reparentedSetup(engine, boneId, newParentId) };
    this.label = `Reparent ${bone.name}`;
  }

  do(): void {
    if (this.after) {
      applyRigSnapshot(this.engine, this.after);
      return;
    }
    const before = captureRig(this.engine);
    const after = prepareRigEdit(this.engine, (data) => {
      const bone = data.bones.find((b) => b.id === this.boneId);
      if (!bone) throw new Error(`Bone "${this.boneId}" no longer exists.`);
      bone.parentId = this.target.parentId;
      bone.setupPose = cloneTransform(this.target.setup);
    });
    applyRigSnapshot(this.engine, after);
    this.before = before;
    this.after = after;
  }

  undo(): void {
    if (this.before) applyRigSnapshot(this.engine, this.before);
  }

  private bone(id: string): BoneData {
    const bone = this.engine.skeleton.data.bones.find((b) => b.id === id);
    if (!bone) throw new Error(`ReparentBoneCommand: bone "${id}" no longer exists.`);
    return bone;
  }
}

/**
 * Removes a bone, flattening its children up to its parent with world-preserving
 * re-expression. IK constraints referencing the bone are removed (captured for
 * undo); slots bound to it are re-pointed to the parent — or removed with it
 * when the bone was a root.
 */
export class RemoveBoneCommand implements Command {
  readonly label: string;
  private readonly boneId: string;
  private before: RigSnapshot | null = null;
  private after: RigSnapshot | null = null;

  constructor(
    private engine: EditorEngine,
    boneId: string,
  ) {
    const bone = engine.skeleton.data.bones.find((b) => b.id === boneId);
    if (!bone) throw new Error(`RemoveBoneCommand: bone "${boneId}" not found.`);
    this.boneId = boneId;
    this.label = `Delete ${bone.name}`;
  }

  do(): void {
    if (this.after) {
      applyRigSnapshot(this.engine, this.after);
      return;
    }
    const data = this.engine.skeleton.data;
    const target = data.bones.find((b) => b.id === this.boneId);
    if (!target) throw new Error(`Bone "${this.boneId}" no longer exists.`);
    const newParentId = target.parentId;

    const boneIndex = this.engine.skeleton.boneIndexMap.get(this.boneId)!;
    for (const attachment of data.attachments) {
      const weights = attachment.weights ?? [];
      for (let p = 0; p < weights.length;) {
        const count = weights[p++]!;
        for (let k = 0; k < count; k++, p += 2) {
          if (weights[p] === boneIndex) {
            throw new Error(
              `Rebind or remove weighted attachment "${attachment.name}" before deleting this bone.`,
            );
          }
        }
      }
    }

    // Capture + compute BEFORE mutating (reparentedSetup reads current worlds).
    const children = data.bones.filter((b) => b.parentId === this.boneId);
    const moves = children.map((c) => ({ id: c.id, setup: reparentedSetup(this.engine, c.id, newParentId) }));
    const before = captureRig(this.engine);
    const after = prepareRigEdit(this.engine, (proposed, animations) => {
      for (const move of moves) {
        const child = proposed.bones.find((b) => b.id === move.id)!;
        child.parentId = newParentId;
        child.setupPose = cloneTransform(move.setup);
      }
      proposed.ikConstraints = proposed.ikConstraints.filter(
        (c) => !c.bones.includes(this.boneId) && c.targetId !== this.boneId && c.poleVectorId !== this.boneId,
      );
      if (proposed.transformConstraints)
        proposed.transformConstraints = proposed.transformConstraints.filter(
          (c) => c.boneId !== this.boneId && c.targetId !== this.boneId,
        );
      if (proposed.paths) proposed.paths = proposed.paths.filter((p) => p.boneId !== this.boneId);
      if (proposed.secondaryConstraints)
        proposed.secondaryConstraints = proposed.secondaryConstraints.filter((c) => c.boneId !== this.boneId);
      if (proposed.pathConstraints)
        proposed.pathConstraints = proposed.pathConstraints.filter(
          (c) =>
            !c.bones.includes(this.boneId) &&
            c.driverId !== this.boneId &&
            proposed.paths?.some((p) => p.id === c.pathId),
        );
      for (const slot of proposed.slots.filter((s) => s.boneId === this.boneId)) {
        if (newParentId === null) removeSlotReferences(proposed, animations, slot.id);
        else slot.boneId = newParentId;
      }
      for (const animation of animations) {
        animation.timelines = animation.timelines.filter(
          (tl) => tl.kind !== 'boneProperty' || tl.boneId !== this.boneId,
        );
      }
      proposed.bones = proposed.bones.filter((bone) => bone.id !== this.boneId);
      for (const attachment of proposed.attachments) {
        if (attachment.boneBindings) {
          attachment.boneBindings = attachment.boneBindings.filter(
            (binding) => binding.boneId !== this.boneId,
          );
          if (!attachment.boneBindings.length) delete attachment.boneBindings;
        }
      }
      if (proposed.markers)
        proposed.markers = proposed.markers.filter((marker) => marker.boneId !== this.boneId);
    });
    applyRigSnapshot(this.engine, after);
    this.before = before;
    this.after = after;
  }

  undo(): void {
    if (this.before) applyRigSnapshot(this.engine, this.before);
  }
}

/** Full snapshot edit of a bone's editable fields (name, length, setup pose). */
export interface BonePropsSnapshot {
  name: string;
  length: number;
  setup: Transform;
}

export class SetBonePropsCommand implements Command {
  readonly label: string;

  constructor(
    private engine: EditorEngine,
    private boneId: string,
    private before: BonePropsSnapshot,
    private after: BonePropsSnapshot,
  ) {
    this.label = `Edit ${after.name || before.name}`;
  }

  do(): void {
    this.apply(this.after);
  }

  undo(): void {
    this.apply(this.before);
  }

  private apply(snap: BonePropsSnapshot): void {
    const bone = this.engine.skeleton.data.bones.find((b) => b.id === this.boneId);
    if (!bone) throw new Error(`SetBonePropsCommand: bone "${this.boneId}" no longer exists.`);
    bone.name = snap.name;
    bone.length = snap.length;
    bone.setupPose = cloneTransform(snap.setup);
  }
}
