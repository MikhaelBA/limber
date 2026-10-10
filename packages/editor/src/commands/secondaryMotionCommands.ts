import { uuid, orderedConstraints, type SecondaryConstraintData, type SkeletonData } from '@limber/core';
import type { EditorEngine } from '../engine/EditorEngine';
import { AtomicConstraintCommand } from './rigEdits';
export const secondaryPresets = {
  soft: { frequency: 2, damping: 0.7 },
  bouncy: { frequency: 3, damping: 0.3 },
  firm: { frequency: 6, damping: 1 },
} as const;
export class AddSecondaryMotionCommand extends AtomicConstraintCommand {
  readonly label = 'Add secondary motion';
  readonly constraintId = uuid();
  constructor(
    engine: EditorEngine,
    readonly boneId: string,
    readonly preset: SecondaryConstraintData['preset'] = 'soft',
  ) {
    super(engine);
  }
  protected edit(data: SkeletonData): void {
    if (!data.bones.some((b) => b.id === this.boneId))
      throw new Error('Select an existing bone for secondary motion.');
    if (data.secondaryConstraints?.some((c) => c.boneId === this.boneId))
      throw new Error('This bone already has secondary motion.');
    const byId = new Map(data.bones.map((b) => [b.id, b]));
    const descendants = (data.secondaryConstraints ?? []).filter((c) => {
      for (let b = byId.get(c.boneId); b; b = b.parentId ? byId.get(b.parentId) : undefined)
        if (b.id === this.boneId) return true;
      return false;
    });
    const order = descendants.length
      ? Math.min(...descendants.map((c) => c.order))
      : orderedConstraints(data).reduce((max, e) => Math.max(max, e.data.order), -1) + 1;
    for (const c of data.secondaryConstraints ?? []) if (c.order >= order) c.order++;
    (data.secondaryConstraints ??= []).push({
      id: this.constraintId,
      boneId: this.boneId,
      preset: this.preset,
      ...secondaryPresets[this.preset],
      mix: 1,
      maxAngle: Math.PI / 2,
      order,
    });
  }
}
type Patch = Partial<Pick<SecondaryConstraintData, 'preset' | 'frequency' | 'damping' | 'mix' | 'maxAngle'>>;
export class EditSecondaryMotionCommand extends AtomicConstraintCommand {
  readonly label = 'Edit secondary motion';
  private readonly patch: Patch;
  constructor(
    engine: EditorEngine,
    readonly constraintId: string,
    patch: Patch,
  ) {
    super(engine);
    this.patch = structuredClone(patch);
  }
  protected edit(data: SkeletonData): void {
    const c = data.secondaryConstraints?.find((c) => c.id === this.constraintId);
    if (!c) throw new Error('Secondary motion no longer exists.');
    if (this.patch.preset) Object.assign(c, secondaryPresets[this.patch.preset]);
    Object.assign(c, this.patch);
  }
}
export class RemoveSecondaryMotionCommand extends AtomicConstraintCommand {
  readonly label = 'Delete secondary motion';
  constructor(
    engine: EditorEngine,
    readonly constraintId: string,
  ) {
    super(engine);
  }
  protected edit(data: SkeletonData): void {
    if (!data.secondaryConstraints?.some((c) => c.id === this.constraintId))
      throw new Error('Secondary motion no longer exists.');
    data.secondaryConstraints = data.secondaryConstraints.filter((c) => c.id !== this.constraintId);
  }
}
