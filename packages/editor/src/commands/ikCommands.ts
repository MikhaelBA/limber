import type { BoneData, IKConstraintData } from '@limber/core';
import { uuid } from '@limber/core';
import type { EditorEngine } from '../engine/EditorEngine';
import type { Command } from '../history/history';
import { inverseTransformPoint } from '../math/matrix';

/**
 * Creates an IK constraint controlling `boneId` (plus its parent — the classic
 * 2-bone chain; a root bone gets a 1-bone chain) AND a target bone placed at
 * the chain tip's current SETUP world position, parented into the chain root's
 * parent so it lives in the same space. One undo removes both.
 */
export class AddIKConstraintCommand implements Command {
  readonly constraintId = uuid();
  readonly targetBoneId = uuid();
  private _label = 'Add IK';
  private named = false;
  private readonly constraint: IKConstraintData;
  private readonly chain: string[];
  private targetBone: BoneData | null = null;

  constructor(
    private engine: EditorEngine,
    readonly boneId: string,
  ) {
    const data = engine.skeleton.data;
    const end = data.bones.find((b) => b.id === boneId);
    if (!end) throw new Error(`AddIKConstraintCommand: bone "${boneId}" not found.`);
    this.chain = end.parentId ? [end.parentId, boneId] : [boneId];
    this.constraint = {
      id: this.constraintId,
      bones: [...this.chain],
      targetId: this.targetBoneId,
      poleVectorId: null,
      bendDirection: 1,
      mix: 1,
      softness: 0,
      order: 0, // Assigned (max+1) at first do().
    };
  }

  get label(): string {
    return this._label;
  }

  do(): void {
    const data = this.engine.skeleton.data;
    if (!this.named) {
      const end = data.bones.find((b) => b.id === this.boneId)!;
      const base = `${end.name}-ik`;
      const names = new Set(data.bones.map((b) => b.name));
      let unique = base;
      let i = 2;
      while (names.has(unique)) unique = base + i++;
      this.constraint.order = data.ikConstraints.reduce((m, c) => Math.max(m, c.order), -1) + 1;
      this._label = `Add IK ${base}`;
      this.named = true;
      this.makeTargetBone(unique);
    }
    data.bones.push(this.targetBone!);
    data.ikConstraints.push(this.constraint);
    this.engine.skeleton.rebuild();
  }

  undo(): void {
    const data = this.engine.skeleton.data;
    data.bones = data.bones.filter((b) => b.id !== this.targetBoneId);
    data.ikConstraints = data.ikConstraints.filter((c) => c.id !== this.constraintId);
    this.engine.skeleton.rebuild();
  }

  /** Target at the chain tip's SETUP world position, in the chain root's parent space. */
  private makeTargetBone(name: string): void {
    const sk = this.engine.skeleton;
    const data = sk.data;
    const end = data.bones.find((b) => b.id === this.boneId)!;
    const endIdx = sk.boneIndexMap.get(this.boneId)!;
    const worlds = this.engine.solveSetupWorlds();
    const o = endIdx * 6;
    const tipX = worlds[o]! * end.length + worlds[o + 4]!;
    const tipY = worlds[o + 1]! * end.length + worlds[o + 5]!;
    const parentId = data.bones.find((b) => b.id === this.chain[0])?.parentId ?? null;
    let x = tipX;
    let y = tipY;
    if (parentId !== null) {
      const out = { x: 0, y: 0 };
      inverseTransformPoint(worlds, sk.boneIndexMap.get(parentId)!, tipX, tipY, out);
      x = out.x;
      y = out.y;
    }
    this.targetBone = {
      id: this.targetBoneId,
      name,
      parentId,
      length: 8, // A small gizmo stub — the target is a handle, not a limb.
      setupPose: { x, y, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 },
    };
  }
}

/** Removes one IK constraint (the target bone stays — it may be keyed/used). */
export class RemoveIKConstraintCommand implements Command {
  readonly label = 'Delete IK';
  private snap: IKConstraintData | null = null;

  constructor(
    private engine: EditorEngine,
    readonly constraintId: string,
  ) {
    const c = engine.skeleton.data.ikConstraints.find((x) => x.id === constraintId);
    if (!c) throw new Error(`RemoveIKConstraintCommand: constraint "${constraintId}" not found.`);
  }

  do(): void {
    const data = this.engine.skeleton.data;
    const c = data.ikConstraints.find((x) => x.id === this.constraintId);
    if (!c) return;
    this.snap = { ...c, bones: [...c.bones] };
    data.ikConstraints = data.ikConstraints.filter((x) => x.id !== this.constraintId);
    this.engine.skeleton.rebuild();
  }

  undo(): void {
    if (!this.snap) return;
    this.engine.skeleton.data.ikConstraints.push({ ...this.snap, bones: [...this.snap.bones] });
    this.snap = null;
    this.engine.skeleton.rebuild();
  }
}

export interface IKPropsPatch {
  mix?: number;
  bendDirection?: 1 | -1;
  targetId?: string;
}

/** Edits mix / bendDirection / target of one IK constraint (undoable). */
export class SetIKPropsCommand implements Command {
  readonly label = 'Edit IK';
  private readonly before: Required<Pick<IKConstraintData, 'mix' | 'bendDirection' | 'targetId'>>;
  private readonly after: Required<Pick<IKConstraintData, 'mix' | 'bendDirection' | 'targetId'>>;

  constructor(
    private engine: EditorEngine,
    readonly constraintId: string,
    patch: IKPropsPatch,
  ) {
    const c = engine.skeleton.data.ikConstraints.find((x) => x.id === constraintId);
    if (!c) throw new Error(`SetIKPropsCommand: constraint "${constraintId}" not found.`);
    this.before = { mix: c.mix, bendDirection: c.bendDirection, targetId: c.targetId };
    this.after = {
      mix: patch.mix !== undefined ? Math.min(1, Math.max(0, patch.mix)) : c.mix,
      bendDirection: patch.bendDirection ?? c.bendDirection,
      targetId: patch.targetId ?? c.targetId,
    };
  }

  do(): void {
    this.apply(this.after);
  }

  undo(): void {
    this.apply(this.before);
  }

  private apply(v: Required<Pick<IKConstraintData, 'mix' | 'bendDirection' | 'targetId'>>): void {
    const c = this.engine.skeleton.data.ikConstraints.find((x) => x.id === this.constraintId);
    if (!c) return;
    const structural = v.targetId !== c.targetId;
    c.mix = v.mix;
    c.bendDirection = v.bendDirection;
    c.targetId = v.targetId;
    if (structural) this.engine.skeleton.rebuild();
  }
}
