import type { SkeletonData } from '../types/data';
import type { SkeletonPose } from '../types/pose';
import { solveFK } from './FKSolver';

/**
 * Analytic IK (DESIGN.md §4.2 step 4 — runs AFTER FK, writes LOCAL rotations,
 * then re-runs FK so the world matrices are consistent when it returns).
 *
 * One or two bone chains, `bendDirection` picks the elbow side, `mix` blends
 * the solved rotations toward the pre-IK pose (shortest-arc), target = the
 * target bone's world ORIGIN. Chain lengths: L1 = current distance between the
 * two bones' origins (robust to the child not sitting exactly at length),
 * L2 = the second bone's `length` (its "IK reach").
 *
 * Assumes no shear and positive scale along the chain/parents (editor-typical
 * rigs). A negative-scale parent flips the effective bend direction — acceptable
 * for v1, documented here instead of silently compensating.
 *
 * Allocation-free. `softness`/`poleVectorId` are stored but not yet solved.
 */
export function solveIK(
  data: SkeletonData,
  boneIndexMap: Map<string, number>,
  pose: SkeletonPose,
): void {
  const wm = pose.worldMatrices;
  for (const c of data.ikConstraints) {
    const i1 = boneIndexMap.get(c.bones[0]!);
    const targetIndex = boneIndexMap.get(c.targetId);
    if (i1 === undefined || targetIndex === undefined) continue;
    const i2 = c.bones.length > 1 ? boneIndexMap.get(c.bones[1]!) : undefined;
    if (i2 === i1 || i2 === targetIndex || i1 === targetIndex) continue;

    const o1 = i1 * 6;
    const p1x = wm[o1 + 4]!;
    const p1y = wm[o1 + 5]!;
    const to = targetIndex * 6;
    const tx = wm[to + 4]!;
    const ty = wm[to + 5]!;

    let newRot1: number;
    let newRot2: number | null = null;

    if (i2 === undefined) {
      // 1-bone: point bone1's x-axis at the target.
      newRot1 = Math.atan2(ty - p1y, tx - p1x);
    } else {
      // 2-bone: classic law-of-cosines solve. p2 = joint (bone2's origin).
      const o2 = i2 * 6;
      const p2x = wm[o2 + 4]!;
      const p2y = wm[o2 + 5]!;
      const l1 = Math.hypot(p2x - p1x, p2y - p1y);
      const l2 = data.bones[i2]!.length;
      if (l1 < 1e-9 || l2 < 1e-9) continue;
      // Clamp into reachable annulus [|L1-L2|, L1+L2] — outside it, the chain
      // fully extends/contracts toward the target.
      const d = Math.min(l1 + l2 - 1e-9, Math.max(Math.abs(l1 - l2) + 1e-9, Math.hypot(tx - p1x, ty - p1y)));
      const a = Math.acos(clamp((l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2), -1, 1)); // joint interior
      const b = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1)); // at the root
      const r = Math.atan2(ty - p1y, tx - p1x);
      const s = c.bendDirection >= 0 ? 1 : -1;
      newRot1 = r + s * b;
      newRot2 = newRot1 - Math.PI + s * a;
    }

    const local1 = pose.bones[i1]!.local;
    local1.rotation = blendAngle(local1.rotation, worldToLocalAngle(data, boneIndexMap, pose, i1, newRot1), c.mix);
    if (i2 !== undefined && newRot2 !== null) {
      // b2's parent IS b1 (validated) — and b1's world angle is now `newRot1`,
      // NOT the stale pre-IK matrix. Local = θ2 − θ1 directly.
      const local2 = pose.bones[i2]!.local;
      local2.rotation = blendAngle(local2.rotation, newRot2 - newRot1, c.mix);
    }

    // Later constraints (and the skinning step) must see the solved chain.
    solveFK(data, boneIndexMap, pose);
  }
}

/** Local rotation = desired WORLD angle minus the parent's world x-axis angle. */
function worldToLocalAngle(
  data: SkeletonData,
  boneIndexMap: Map<string, number>,
  pose: SkeletonPose,
  boneIndex: number,
  worldAngle: number,
): number {
  const parentId = data.bones[boneIndex]!.parentId;
  if (parentId === null) return worldAngle;
  const p = (boneIndexMap.get(parentId) ?? -1) * 6;
  if (p < 0) return worldAngle;
  return worldAngle - Math.atan2(pose.worldMatrices[p + 1]!, pose.worldMatrices[p]!);
}

/** Shortest-arc blend from `from` toward `to` by alpha. */
function blendAngle(from: number, to: number, alpha: number): number {
  return from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * alpha;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
