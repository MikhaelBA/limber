import type { PathConstraintData } from '../types/data';
import type { Skeleton } from './Skeleton';
import { invertAffine } from '../math/affine';
import { solveFK } from './FKSolver';
import type { PathSample } from './pathSampling';
const inverse = new Float64Array(6);
const sample: PathSample = { x: 0, y: 0, tangentX: 0, tangentY: 0 };
/** ADR 0021: position along world arc, tangent-aligned local +X, sampled basis retained. */
export function solvePathConstraint(skeleton: Skeleton, c: PathConstraintData): void {
  if (c.mixTranslation === 0 && c.mixRotation === 0) return;
  const sampler = skeleton.pathSamplers.get(c.pathId);
  if (!sampler) return;
  const owner = skeleton.boneIndexMap.get(sampler.path.boneId)! * 6;
  const wm = skeleton.pose.worldMatrices;
  sampler.updateMetric(wm, owner);
  const driver =
    c.driverId === null ? 0 : skeleton.pose.bones[skeleton.boneIndexMap.get(c.driverId)!]!.local.x / 100;
  const distance = (c.progress + driver) * sampler.length;
  for (let n = 0; n < c.bones.length; n++) {
    if (!sampler.sample(distance + n * c.spacing, wm, owner, sample)) continue;
    const index = skeleton.boneIndexMap.get(c.bones[n]!)!;
    const parent = skeleton.data.bones[index]!.parentId;
    let x = sample.x,
      y = sample.y,
      dx = sample.tangentX,
      dy = sample.tangentY;
    if (parent !== null) {
      if (!invertAffine(inverse, 0, wm, skeleton.boneIndexMap.get(parent)! * 6)) continue;
      x = inverse[0]! * sample.x + inverse[2]! * sample.y + inverse[4]!;
      y = inverse[1]! * sample.x + inverse[3]! * sample.y + inverse[5]!;
      dx = inverse[0]! * sample.tangentX + inverse[2]! * sample.tangentY;
      dy = inverse[1]! * sample.tangentX + inverse[3]! * sample.tangentY;
    }
    if (!Number.isFinite(Math.fround(x)) || !Number.isFinite(Math.fround(y))) continue;
    const local = skeleton.pose.bones[index]!.local;
    const ty = Math.tan(local.shearY),
      bx = (1 + Math.tan(local.shearX) * ty) * local.scaleX,
      by = ty * local.scaleX;
    if (c.mixRotation !== 0 && Math.hypot(dx, dy) > 0 && Math.hypot(bx, by) > 0) {
      const desired = Math.atan2(dy, dx) - Math.atan2(by, bx) + c.rotationOffset;
      const delta = desired - local.rotation;
      local.rotation += Math.atan2(Math.sin(delta), Math.cos(delta)) * c.mixRotation;
    }
    local.x += (x - local.x) * c.mixTranslation;
    local.y += (y - local.y) * c.mixTranslation;
    solveFK(skeleton.data, skeleton.boneIndexMap, skeleton.pose);
  }
}
