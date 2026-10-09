import type { SkeletonData } from '../types/data';
import type { SkeletonPose } from '../types/pose';
import { solveFK } from './FKSolver';
import { trigAngles, trigRoots } from './trigRoots';

const candidates = new Float64Array(10);
const arc = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));
const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));

/** Ordered affine IK. In the chain parent's space:
 * endpoint = R(r1) A1 (childTranslation + R(r2) A2 (length2,0)).
 * A = ShearX ShearY Scale. Solve radius before direction: affine A1 produces
 * an offset ellipse and a quartic in tan(r2/2). Conformal chains use circles.
 * Only rotations are written; scales/shears/translations/lengths are preserved.
 */
export function solveIK(data: SkeletonData, boneIndexMap: Map<string, number>, pose: SkeletonPose): void {
  const wm = pose.worldMatrices;
  for (const constraint of data.ikConstraints) {
    if (constraint.mix === 0) continue;
    const i1 = boneIndexMap.get(constraint.bones[0]!),
      ti = boneIndexMap.get(constraint.targetId);
    if (i1 === undefined || ti === undefined) continue;
    const i2 = constraint.bones.length === 2 ? boneIndexMap.get(constraint.bones[1]!) : undefined;
    const local1 = pose.bones[i1]!.local,
      local2 = i2 === undefined ? null : pose.bones[i2]!.local;
    const parentId = data.bones[i1]!.parentId;
    const pi = parentId === null ? undefined : boneIndexMap.get(parentId);
    const po = (pi ?? 0) * 6,
      o = i1 * 6,
      to = ti * 6;
    const pa = pi === undefined ? 1 : wm[po]!,
      pb = pi === undefined ? 0 : wm[po + 1]!;
    const pc = pi === undefined ? 0 : wm[po + 2]!,
      pd = pi === undefined ? 1 : wm[po + 3]!;
    const determinant = pa * pd - pb * pc,
      parentNorm = Math.max(Math.abs(pa), Math.abs(pb), Math.abs(pc), Math.abs(pd));
    // Collapsed/near-singular parents have no reliable inverse: hold sampled pose.
    if (!Number.isFinite(determinant) || Math.abs(determinant) <= parentNorm * parentNorm * 1e-12) continue;
    const dx = wm[to + 4]! - wm[o + 4]!,
      dy = wm[to + 5]! - wm[o + 5]!;
    const tx = (pd * dx - pc * dy) / determinant,
      ty = (-pb * dx + pa * dy) / determinant;
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) continue;
    const hx = Math.tan(local1.shearX),
      hy = Math.tan(local1.shearY);
    const a = (1 + hx * hy) * local1.scaleX,
      b = hy * local1.scaleX;
    const c = hx * local1.scaleY,
      d = local1.scaleY;
    let solved1 = local1.rotation,
      solved2 = local2?.rotation ?? 0;
    if (!local2 || i2 === undefined) {
      if (data.bones[i1]!.length === 0 || Math.hypot(tx, ty) < 1e-12 || Math.hypot(a, b) < 1e-12) continue;
      solved1 = Math.atan2(ty, tx) - Math.atan2(b, a);
    } else {
      const vx = local2.x,
        vy = local2.y;
      const wx =
        (1 + Math.tan(local2.shearX) * Math.tan(local2.shearY)) * local2.scaleX * data.bones[i2]!.length;
      const wy = Math.tan(local2.shearY) * local2.scaleX * data.bones[i2]!.length;
      const radius = Math.hypot(wx, wy),
        beta = Math.atan2(wy, wx);
      const ux = a * vx + c * vy,
        uy = b * vx + d * vy;
      if (radius < 1e-12) {
        // Zero lower reach reduces to aiming the joint, keeping lower rotation.
        if (Math.hypot(ux, uy) < 1e-12 || Math.hypot(tx, ty) < 1e-12) continue;
        solved1 = Math.atan2(ty, tx) - Math.atan2(uy, ux);
      } else {
        const scale = Math.max(
          Math.abs(ux),
          Math.abs(uy),
          Math.abs(a * radius),
          Math.abs(b * radius),
          Math.abs(c * radius),
          Math.abs(d * radius),
        );
        if (!Number.isFinite(scale) || scale < 1e-12) continue;
        const ex = ux / scale,
          ey = uy / scale,
          ax = (a * radius) / scale,
          ay = (b * radius) / scale;
        const cx = (c * radius) / scale,
          cy = (d * radius) / scale;
        const aa = ax * ax + ay * ay,
          cc = cx * cx + cy * cy;
        const constant = ex * ex + ey * ey + (aa + cc) / 2;
        const cosine = 2 * (ex * ax + ey * ay),
          sine = 2 * (ex * cx + ey * cy);
        const cosine2 = (aa - cc) / 2,
          sine2 = ax * cx + ay * cy;
        let minimum: number,
          maximum: number,
          count = 0;
        const conformal =
          Math.abs(aa - cc) <= 1e-12 * Math.max(aa, cc) && Math.abs(sine2) <= 1e-12 * Math.max(aa, cc);
        if (conformal) {
          const first = Math.hypot(ex, ey),
            second = Math.sqrt(aa);
          minimum = Math.abs(first - second);
          maximum = first + second;
        } else {
          minimum = Infinity;
          maximum = 0;
          const extrema = trigRoots(0, sine, -cosine, 2 * sine2, -2 * cosine2);
          for (let i = -1; i < extrema; i++) {
            const angle = i < 0 ? 0 : trigAngles[i]!;
            const length = Math.hypot(
              ex + ax * Math.cos(angle) + cx * Math.sin(angle),
              ey + ay * Math.cos(angle) + cy * Math.sin(angle),
            );
            minimum = Math.min(minimum, length);
            maximum = Math.max(maximum, length);
          }
        }
        let distance = Math.hypot(tx, ty) / scale;
        const soft = Math.min(constraint.softness / scale, maximum - minimum);
        if (soft > 0 && distance > maximum - soft)
          distance = maximum - soft * Math.exp(-(distance - (maximum - soft)) / soft);
        distance = clamp(distance, minimum, maximum);
        if (conformal) {
          const amplitude = Math.hypot(cosine, sine);
          if (amplitude < 1e-14) candidates[count++] = local2.rotation + beta;
          else {
            const phase = Math.atan2(sine, cosine),
              angle = Math.acos(clamp((distance * distance - constant) / amplitude, -1, 1));
            candidates[count++] = phase + angle;
            candidates[count++] = phase - angle;
          }
        } else {
          count = trigRoots(constant - distance * distance, cosine, sine, cosine2, sine2);
          for (let i = 0; i < count; i++) candidates[i] = trigAngles[i]!;
        }
        let side: number = constraint.bendDirection;
        if (constraint.poleVectorId !== null) {
          const pole = boneIndexMap.get(constraint.poleVectorId);
          if (pole !== undefined) {
            const px = wm[pole * 6 + 4]! - wm[o + 4]!,
              py = wm[pole * 6 + 5]! - wm[o + 5]!;
            const cross = dx * py - dy * px;
            if (Math.abs(cross) > 1e-10 * Math.max(1, Math.hypot(dx, dy) * Math.hypot(px, py)))
              side = cross < 0 ? -1 : 1;
          }
        }
        let best = Infinity;
        for (let i = 0; i < count; i++) {
          const angle = candidates[i]!,
            qx = ex + ax * Math.cos(angle) + cx * Math.sin(angle),
            qy = ey + ay * Math.cos(angle) + cy * Math.sin(angle);
          const r1 = distance < 1e-10 ? local1.rotation : Math.atan2(ty, tx) - Math.atan2(qy, qx);
          const r2 = angle - beta,
            cr = Math.cos(r1),
            sr = Math.sin(r1);
          const jx = cr * ux - sr * uy,
            jy = sr * ux + cr * uy;
          const cross = dx * (pb * jx + pd * jy) - dy * (pa * jx + pc * jy);
          const tolerance =
            1e-9 * Math.max(1, Math.hypot(dx, dy) * Math.hypot(pa * jx + pc * jy, pb * jx + pd * jy));
          const wrongSide = cross * side < -tolerance;
          const score =
            (wrongSide ? 100 : 0) + arc(r1 - local1.rotation) ** 2 + arc(r2 - local2.rotation) ** 2;
          if (score < best) {
            best = score;
            solved1 = r1;
            solved2 = r2;
          }
        }
        if (!Number.isFinite(best)) continue;
      }
    }
    if (!Number.isFinite(solved1) || !Number.isFinite(solved2)) continue;
    local1.rotation += arc(solved1 - local1.rotation) * constraint.mix;
    if (local2) local2.rotation += arc(solved2 - local2.rotation) * constraint.mix;
    solveFK(data, boneIndexMap, pose);
  }
}
