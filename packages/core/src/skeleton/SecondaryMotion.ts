import type { SecondaryConstraintData } from '../types/data';
import type { Skeleton } from './Skeleton';
import { advanceDampedSpring, type SpringState } from '../math/dampedSpring';
import { SECONDARY_STEP_SECONDS } from '../animation/FixedStepClock';
import { invertAffine } from '../math/affine';
import { solveFK } from './FKSolver';
interface MotionState extends SpringState {
  target: number;
  valid: boolean;
}
const shortest = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
/** Per-skeleton angular inertia; all allocation happens on structural publication. */
export class SecondaryMotion {
  initialized = false;
  readonly entries: readonly SecondaryConstraintData[];
  private readonly indices: Int32Array;
  private readonly states: MotionState[];
  private readonly targets: Float64Array;
  private readonly valid: Uint8Array;
  private readonly before: Float64Array;
  private readonly inverse = new Float64Array(6);
  constructor(entries: SecondaryConstraintData[], indices: Map<string, number>) {
    this.entries = [...entries].sort((a, b) => a.order - b.order);
    this.indices = new Int32Array(this.entries.map((c) => indices.get(c.boneId)!));
    this.states = this.entries.map(() => ({ value: 0, velocity: 0, target: 0, valid: false }));
    this.targets = new Float64Array(entries.length);
    this.valid = new Uint8Array(entries.length);
    this.before = new Float64Array(entries.length);
  }
  invalidate(): void {
    this.initialized = false;
  }
  rebase(skeleton: Skeleton): void {
    const wm = skeleton.pose.worldMatrices;
    for (let n = 0; n < this.entries.length; n++) {
      const o = this.indices[n]! * 6,
        state = this.states[n]!,
        x = wm[o]!,
        y = wm[o + 1]!;
      state.valid = Number.isFinite(x) && Number.isFinite(y) && Math.hypot(x, y) > 0;
      state.target = state.valid ? Math.atan2(y, x) : 0;
      state.value = state.target;
      state.velocity = 0;
    }
    this.initialized = true;
  }
  /** Pose on entry is freshly sampled primary output. Held renders do not integrate state. */
  evaluate(skeleton: Skeleton, advance: boolean): void {
    if (!this.initialized) this.rebase(skeleton);
    const wm = skeleton.pose.worldMatrices;
    skeleton.constraintWorldBackup.set(wm);
    for (let n = 0; n < this.entries.length; n++) {
      const i = this.indices[n]!,
        o = i * 6,
        x = wm[o]!,
        y = wm[o + 1]!;
      this.valid[n] = Number.isFinite(x) && Number.isFinite(y) && Math.hypot(x, y) > 0 ? 1 : 0;
      this.targets[n] = this.valid[n] ? Math.atan2(y, x) : 0;
      this.before[n] = skeleton.pose.bones[i]!.local.rotation;
    }
    for (let n = 0; n < this.entries.length; n++) {
      const c = this.entries[n]!,
        i = this.indices[n]!,
        state = this.states[n]!,
        local = skeleton.pose.bones[i]!.local;
      if (!this.valid[n]) {
        state.valid = false;
        continue;
      }
      const parent = skeleton.data.bones[i]!.parentId;
      if (parent !== null && !invertAffine(this.inverse, 0, wm, skeleton.boneIndexMap.get(parent)! * 6)) {
        state.valid = false;
        continue;
      }
      const ty = Math.tan(local.shearY),
        bx = (1 + Math.tan(local.shearX) * ty) * local.scaleX,
        by = ty * local.scaleX;
      if (!(Math.hypot(bx, by) > 0)) {
        state.valid = false;
        continue;
      }
      const target = state.valid
        ? state.target + shortest(this.targets[n]! - state.target)
        : this.targets[n]!;
      if (!state.valid) {
        state.target = target;
        state.value = target;
        state.velocity = 0;
        state.valid = true;
      }
      if (advance) {
        state.target = target;
        advanceDampedSpring(state, target, c.frequency, c.damping, SECONDARY_STEP_SECONDS);
        const deviation = state.value - target;
        if (Math.abs(deviation) > c.maxAngle) {
          state.value = target + Math.sign(deviation) * c.maxAngle;
          if (state.velocity * deviation > 0) state.velocity = 0;
        }
      }
      if (c.mix === 0) continue;
      const angle = target + (state.value - target) * c.mix,
        current = Math.atan2(wm[i * 6 + 1]!, wm[i * 6]!);
      if (Math.abs(shortest(angle - current)) < 1e-12) continue;
      let x = Math.cos(angle),
        y = Math.sin(angle);
      if (parent !== null) {
        const dx = this.inverse[0]! * x + this.inverse[2]! * y;
        y = this.inverse[1]! * x + this.inverse[3]! * y;
        x = dx;
      }
      const desired = Math.atan2(y, x) - Math.atan2(by, bx);
      local.rotation += shortest(desired - local.rotation);
      solveFK(skeleton.data, skeleton.boneIndexMap, skeleton.pose);
    }
    if (!wm.every(Number.isFinite)) {
      for (let n = 0; n < this.entries.length; n++)
        skeleton.pose.bones[this.indices[n]!]!.local.rotation = this.before[n]!;
      wm.set(skeleton.constraintWorldBackup);
      this.rebase(skeleton);
    }
  }
}
