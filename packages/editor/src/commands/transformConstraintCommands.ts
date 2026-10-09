import {
  uuid,
  Skeleton,
  solveFK,
  solveConstraints,
  composeAffine,
  multiplyAffine,
  invertAffine,
  decomposeAffineInto,
  orderedConstraints,
  type SkeletonData,
  type Transform,
  type TransformConstraintData,
} from '@limber/core';
import type { EditorEngine } from '../engine/EditorEngine';
import { AtomicConstraintCommand } from './rigEdits';
export const identityOffset = (): Transform => ({
  x: 0,
  y: 0,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  shearX: 0,
  shearY: 0,
});
export class AddTransformConstraintCommand extends AtomicConstraintCommand {
  readonly label = 'Follow transform';
  readonly constraintId = uuid();
  constructor(
    engine: EditorEngine,
    readonly boneId: string,
    readonly targetId: string,
    readonly maintainOffset = true,
    readonly space: 'world' | 'local' = 'world',
  ) {
    super(engine);
  }
  protected edit(data: SkeletonData): void {
    const sk = new Skeleton(structuredClone(data));
    solveFK(sk.data, sk.boneIndexMap, sk.pose);
    solveConstraints(sk);
    const i = sk.boneIndexMap.get(this.boneId),
      target = sk.boneIndexMap.get(this.targetId);
    if (i === undefined || target === undefined)
      throw new Error('Select an existing bone and follow target.');
    const offset = identityOffset();
    if (this.maintainOffset) {
      const m = new Float64Array(24);
      if (this.space === 'world') {
        if (!invertAffine(m, 0, sk.pose.worldMatrices, target * 6))
          throw new Error('Cannot preserve an offset from a singular target.');
        multiplyAffine(m, 12, m, 0, sk.pose.worldMatrices, i * 6);
      } else {
        composeAffine(sk.pose.bones[target]!.local, m, 6);
        composeAffine(sk.pose.bones[i]!.local, m, 18);
        if (!invertAffine(m, 0, m, 6)) throw new Error('Cannot preserve an offset from a singular target.');
        multiplyAffine(m, 12, m, 0, m, 18);
      }
      if (!decomposeAffineInto(m, 12, offset))
        throw new Error('Cannot preserve an offset from a collapsed bone.');
    }
    (data.transformConstraints ??= []).push({
      id: this.constraintId,
      boneId: this.boneId,
      targetId: this.targetId,
      space: this.space,
      offset,
      mixTranslation: 1,
      mixRotation: 1,
      mixScale: 1,
      mixShear: 1,
      order: orderedConstraints(data).reduce((max, c) => Math.max(max, c.data.order), -1) + 1,
    });
  }
}
export type TransformConstraintPatch = Partial<
  Pick<
    TransformConstraintData,
    'targetId' | 'space' | 'mixTranslation' | 'mixRotation' | 'mixScale' | 'mixShear'
  >
> & { offset?: Partial<Transform> };
export class EditTransformConstraintCommand extends AtomicConstraintCommand {
  readonly label = 'Edit transform follow';
  private patch: TransformConstraintPatch;
  constructor(
    engine: EditorEngine,
    readonly constraintId: string,
    patch: TransformConstraintPatch,
  ) {
    super(engine);
    this.patch = structuredClone(patch);
  }
  protected edit(data: SkeletonData): void {
    const c = data.transformConstraints?.find((c) => c.id === this.constraintId);
    if (!c) throw new Error('Transform constraint no longer exists.');
    const { offset, ...values } = this.patch;
    Object.assign(c, values);
    if (offset) Object.assign(c.offset, offset);
  }
}
export class RemoveTransformConstraintCommand extends AtomicConstraintCommand {
  readonly label = 'Delete transform follow';
  constructor(
    engine: EditorEngine,
    readonly constraintId: string,
  ) {
    super(engine);
  }
  protected edit(data: SkeletonData): void {
    if (!data.transformConstraints?.some((c) => c.id === this.constraintId))
      throw new Error('Transform constraint no longer exists.');
    data.transformConstraints = data.transformConstraints.filter((c) => c.id !== this.constraintId);
  }
}
