/**
 * SkeletonPose — mutable runtime state (DESIGN.md §3.2).
 * Rewritten every frame. Never serialized.
 */
import type { Transform } from './data';

export interface BonePose {
  /** Local transform at time T. Reset from setupPose, then written by animations. */
  local: Transform;
  // NOTE: deliberately NO `world` field (DESIGN.md §1 principle 5). The world
  // transform of bone i lives ONLY in SkeletonPose.worldMatrices, slots
  // [i*6 .. i*6+5]. Decomposing a composed world transform under non-uniform
  // parent scale/shear is lossy — never do it.
}

export interface SlotPose {
  attachmentId: string | null;
  /** Packed RGBA uint32. Never parse "#RRGGBBAA" strings in the render loop. */
  color: number;
}

export interface SkeletonPose {
  /** Parallel to SkeletonData.bones — same topological index space. */
  bones: BonePose[];
  /** Indexed by slot id index (parallel to SkeletonData.slots). */
  slots: SlotPose[];
  /**
   * Current draw order: a permutation of slot indices. Draw-order timelines swap
   * this. (Draw order is an ordered array on the pose, NOT a z-number on each
   * slot — that is what makes animated reordering possible.)
   */
  slotOrder: number[];
  /**
   * Flat world matrices, 6 floats per bone: [a, b, c, d, tx, ty] where the
   * affine matrix is:
   *   | a c tx |
   *   | b d ty |
   * Length = bones.length * 6. Preallocated once per Skeleton instance;
   * reallocated only by Skeleton.rebuild() on structural changes.
   */
  worldMatrices: Float32Array;
}
