import type { SkeletonData, Transform, TransformConstraintData } from '../types/data';
import type { SkeletonPose } from '../types/pose';
import { composeAffine, multiplyAffine, invertAffine, decomposeAffineInto } from '../math/affine';
import { solveFK } from './FKSolver';
const scratch = new Float64Array(30);
const current: Transform = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 };
const desired: Transform = { ...current };
const blend = (a: number, b: number, mix: number) => a + (b - a) * mix;
/** Selective target follow using ADR 0020's canonical affine component convention. */
export function solveTransformConstraint(
  data: SkeletonData,
  indices: Map<string, number>,
  pose: SkeletonPose,
  c: TransformConstraintData,
): void {
  if (c.mixTranslation === 0 && c.mixRotation === 0 && c.mixScale === 0 && c.mixShear === 0) return;
  const i = indices.get(c.boneId),
    target = indices.get(c.targetId);
  if (i === undefined || target === undefined) return;
  composeAffine(c.offset, scratch, 6);
  if (c.space === 'local') {
    composeAffine(pose.bones[target]!.local, scratch, 0);
    multiplyAffine(scratch, 12, scratch, 0, scratch, 6);
  } else {
    multiplyAffine(scratch, 12, pose.worldMatrices, target * 6, scratch, 6);
    const parent = data.bones[i]!.parentId,
      p = parent === null ? undefined : indices.get(parent);
    if (p !== undefined) {
      if (!invertAffine(scratch, 18, pose.worldMatrices, p * 6)) return;
      multiplyAffine(scratch, 12, scratch, 18, scratch, 12);
    }
  }
  for (let n = 12; n < 18; n++) if (!Number.isFinite(Math.fround(scratch[n]!))) return;
  const local = pose.bones[i]!.local;
  if (c.mixRotation !== 0 || c.mixScale !== 0 || c.mixShear !== 0) {
    composeAffine(local, scratch, 24);
    if (!decomposeAffineInto(scratch, 24, current) || !decomposeAffineInto(scratch, 12, desired)) return;
    const difference = desired.rotation - current.rotation;
    local.rotation =
      current.rotation + Math.atan2(Math.sin(difference), Math.cos(difference)) * c.mixRotation;
    local.scaleX = blend(current.scaleX, desired.scaleX, c.mixScale);
    local.scaleY = blend(current.scaleY, desired.scaleY, c.mixScale);
    local.shearX = Math.atan(blend(Math.tan(current.shearX), Math.tan(desired.shearX), c.mixShear));
    local.shearY = 0;
  }
  local.x = blend(local.x, scratch[16]!, c.mixTranslation);
  local.y = blend(local.y, scratch[17]!, c.mixTranslation);
  solveFK(data, indices, pose);
}
