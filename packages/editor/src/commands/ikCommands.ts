import { uuid, type BoneData, type IKConstraintData, type SkeletonData } from '@limber/core';
import type { EditorEngine } from '../engine/EditorEngine';
import type { Command } from '../history/history';
import { inverseTransformPoint } from '../math/matrix';
import { applyRigSnapshot, captureRig, prepareRigEdit, type RigSnapshot } from './rigEdits';

/** IK authoring validates a detached rig; failure preserves data, pose and redo. */
abstract class AtomicIKCommand implements Command {
  abstract readonly label: string;
  private before: RigSnapshot | null = null;
  private after: RigSnapshot | null = null;
  constructor(protected engine: EditorEngine) {}
  protected abstract edit(data: SkeletonData): void;
  do(): void {
    if (this.after) {
      applyRigSnapshot(this.engine, this.after);
      return;
    }
    if (this.engine.mode !== 'setup') throw new Error('Switch to Setup to edit IK constraints.');
    const before = captureRig(this.engine);
    const after = prepareRigEdit(this.engine, (data) => this.edit(data));
    applyRigSnapshot(this.engine, after);
    this.before = before;
    this.after = after;
  }
  undo(): void {
    if (this.before) applyRigSnapshot(this.engine, this.before);
  }
}

function uniqueName(data: SkeletonData, base: string): string {
  const names = new Set(data.bones.map((bone) => bone.name));
  let name = base,
    suffix = 2;
  while (names.has(name)) name = base + suffix++;
  return name;
}
function targetBone(
  engine: EditorEngine,
  id: string,
  name: string,
  endId: string,
  parentId: string | null,
  tip: boolean,
): BoneData {
  const bone = engine.skeleton.data.bones.find((b) => b.id === endId);
  if (!bone) throw new Error('The selected IK bone no longer exists.');
  const wm = engine.solveSetupWorlds(),
    o = engine.skeleton.boneIndexMap.get(endId)! * 6;
  const reach = tip ? bone.length : 0;
  let x = wm[o]! * reach + wm[o + 4]!,
    y = wm[o + 1]! * reach + wm[o + 5]!;
  if (parentId !== null) {
    const p = engine.skeleton.boneIndexMap.get(parentId)! * 6;
    const det = wm[p]! * wm[p + 3]! - wm[p + 1]! * wm[p + 2]!;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-12)
      throw new Error('Cannot create an IK target under a zero-scale parent.');
    const out = { x: 0, y: 0 };
    inverseTransformPoint(wm, p / 6, x, y, out);
    x = out.x;
    y = out.y;
  }
  return {
    id,
    name,
    parentId,
    length: 8,
    setupPose: { x, y, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 },
  };
}
function constraint(
  data: SkeletonData,
  id: string,
  chain: string[],
  targetId: string,
  bendDirection: 1 | -1 = 1,
): IKConstraintData {
  return {
    id,
    bones: chain,
    targetId,
    poleVectorId: null,
    bendDirection,
    mix: 1,
    softness: 0,
    order: data.ikConstraints.reduce((max, c) => Math.max(max, c.order), -1) + 1,
  };
}

/** Advanced IK: selected lower bone + parent, with a target at the selected tip. */
export class AddIKConstraintCommand extends AtomicIKCommand {
  readonly label = 'Add IK';
  readonly constraintId = uuid();
  readonly targetBoneId = uuid();
  constructor(
    engine: EditorEngine,
    readonly boneId: string,
  ) {
    super(engine);
  }
  protected edit(data: SkeletonData): void {
    const end = data.bones.find((b) => b.id === this.boneId);
    if (!end) throw new Error('The selected IK bone no longer exists.');
    const chain = end.parentId ? [end.parentId, end.id] : [end.id];
    const parentId = data.bones.find((b) => b.id === chain[0])!.parentId;
    data.bones.push(
      targetBone(this.engine, this.targetBoneId, uniqueName(data, end.name + '-ik'), end.id, parentId, true),
    );
    data.ikConstraints.push(constraint(data, this.constraintId, chain, this.targetBoneId));
  }
}

/** Pins the selected hand/foot pivot by controlling its two ancestor limb bones. */
export class PinLimbCommand extends AtomicIKCommand {
  readonly constraintId = uuid();
  readonly targetBoneId = uuid();
  readonly label: string;
  constructor(
    engine: EditorEngine,
    readonly endpointId: string,
    readonly kind: 'hand' | 'foot',
  ) {
    super(engine);
    this.label = kind === 'hand' ? 'Pin Hand' : 'Pin Foot';
  }
  protected edit(data: SkeletonData): void {
    const byId = new Map(data.bones.map((b) => [b.id, b]));
    const endpoint = byId.get(this.endpointId);
    const lower = endpoint?.parentId ? byId.get(endpoint.parentId) : undefined;
    const upper = lower?.parentId ? byId.get(lower.parentId) : undefined;
    if (!endpoint || !lower || !upper)
      throw new Error('Select a hand/foot bone with two limb bones above it.');
    if (data.ikConstraints.some((c) => c.bones.includes(upper.id) || c.bones.includes(lower.id)))
      throw new Error('This limb already has IK. Edit its target or delete its constraint before pinning.');
    const tolerance = Math.max(1, lower.length) * 1e-5;
    if (
      lower.length <= 1e-6 ||
      lower.setupPose.x <= 1e-6 ||
      Math.abs(lower.setupPose.y) > tolerance ||
      Math.abs(endpoint.setupPose.x - lower.length) > tolerance ||
      Math.abs(endpoint.setupPose.y) > tolerance
    )
      throw new Error('Place the hand/foot pivot at the lower limb tip (+X), with a nonzero aligned limb.');
    const wm = this.engine.solveSetupWorlds(),
      u = this.engine.skeleton.boneIndexMap.get(upper.id)! * 6;
    const l = this.engine.skeleton.boneIndexMap.get(lower.id)! * 6;
    const e = this.engine.skeleton.boneIndexMap.get(endpoint.id)! * 6;
    // Pins promise an independently movable endpoint, requiring an invertible
    // chain and parent. Advanced IK may still author deterministic collapsed rigs.
    for (const id of [upper.id, lower.id, upper.parentId]) {
      if (id === null) continue;
      const o = this.engine.skeleton.boneIndexMap.get(id)! * 6;
      const norm = Math.max(
        Math.abs(wm[o]!),
        Math.abs(wm[o + 1]!),
        Math.abs(wm[o + 2]!),
        Math.abs(wm[o + 3]!),
      );
      if (Math.abs(wm[o]! * wm[o + 3]! - wm[o + 1]! * wm[o + 2]!) <= norm * norm * 1e-12)
        throw new Error('Cannot pin a collapsed or near-singular limb/parent. Restore a nonzero scale.');
    }
    let cross =
      (wm[e + 4]! - wm[u + 4]!) * (wm[l + 5]! - wm[u + 5]!) -
      (wm[e + 5]! - wm[u + 5]!) * (wm[l + 4]! - wm[u + 4]!);
    // A straight setup has no elbow side. Prefer away from the body without
    // guessing anatomical roles from bone names or relying on a screen axis.
    if (Math.abs(cross) < 1e-6 && upper.parentId) {
      const p = this.engine.skeleton.boneIndexMap.get(upper.parentId)! * 6;
      cross =
        (wm[e + 4]! - wm[u + 4]!) * (wm[u + 5]! - wm[p + 5]!) -
        (wm[e + 5]! - wm[u + 5]!) * (wm[u + 4]! - wm[p + 4]!);
    }
    data.bones.push(
      targetBone(
        this.engine,
        this.targetBoneId,
        uniqueName(data, `${this.label} ${endpoint.name}`),
        endpoint.id,
        null,
        false,
      ),
    );
    data.ikConstraints.push(
      constraint(data, this.constraintId, [upper.id, lower.id], this.targetBoneId, cross < -1e-6 ? -1 : 1),
    );
  }
}

/** Removing IK keeps its target: artwork, markers and tracks may still use it. */
export class RemoveIKConstraintCommand extends AtomicIKCommand {
  readonly label = 'Delete IK';
  constructor(
    engine: EditorEngine,
    readonly constraintId: string,
  ) {
    super(engine);
  }
  protected edit(data: SkeletonData): void {
    if (!data.ikConstraints.some((c) => c.id === this.constraintId))
      throw new Error('IK constraint no longer exists.');
    data.ikConstraints = data.ikConstraints.filter((c) => c.id !== this.constraintId);
  }
}

export interface IKPropsPatch {
  mix?: number;
  bendDirection?: 1 | -1;
  targetId?: string;
  order?: number;
  poleVectorId?: string | null;
  softness?: number;
}
export class SetIKPropsCommand extends AtomicIKCommand {
  readonly label = 'Edit IK';
  private readonly patch: IKPropsPatch;
  constructor(
    engine: EditorEngine,
    readonly constraintId: string,
    patch: IKPropsPatch,
  ) {
    super(engine);
    this.patch = { ...patch };
  }
  protected edit(data: SkeletonData): void {
    const c = data.ikConstraints.find((c) => c.id === this.constraintId);
    if (!c) throw new Error('IK constraint no longer exists.');
    for (const key of ['mix', 'bendDirection', 'targetId', 'order', 'poleVectorId', 'softness'] as const)
      if (this.patch[key] !== undefined) Object.assign(c, { [key]: this.patch[key] });
  }
}

/** Swap adjacent serialized priorities; dependency validation can reject the move. */
export class MoveIKConstraintCommand extends AtomicIKCommand {
  readonly label = 'Reorder IK';
  constructor(
    engine: EditorEngine,
    readonly constraintId: string,
    readonly direction: -1 | 1,
  ) {
    super(engine);
  }
  protected edit(data: SkeletonData): void {
    const list = data.ikConstraints,
      index = list.findIndex((c) => c.id === this.constraintId);
    if (index < 0) throw new Error('IK constraint no longer exists.');
    const other = list[index + this.direction];
    if (!other) throw new Error('IK constraint is already at the end of the order.');
    [list[index]!.order, other.order] = [other.order, list[index]!.order];
  }
}
