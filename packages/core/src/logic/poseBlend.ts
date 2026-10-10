import type { SkeletonPose } from '../types/pose';
import type { Artboard } from '../project/model';
import { sampleSceneClip, type SceneClip, type SceneMotionPose } from '../project/motion';
import { lerpColor } from '../animation/keyframes';
const fields = ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'shearX', 'shearY'] as const;
function alpha(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1)
    throw new Error('Logic blend strength must be finite in [0,1].');
}
/** Weighted form avoids overflowing the difference of opposite large finite endpoints. */
export function blendLogicNumber(from: number, to: number, mix: number): number {
  if (mix === 0) return from;
  if (mix === 1) return to;
  return from * (1 - mix) + to * mix;
}
export function blendLogicRotation(from: number, to: number, mix: number): number {
  if (mix === 0) return from;
  if (mix === 1) return to;
  return from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * mix;
}
/** Full setup-resolved channels; no stale properties can leak from a previous clip. */
export function resolveLogicScenePose(
  board: Artboard,
  clip: SceneClip | null,
  time: number,
): SceneMotionPose {
  const sampled = clip
    ? sampleSceneClip(board, clip, time)
    : ({ transforms: {}, opacity: {} } as SceneMotionPose);
  return {
    transforms: Object.fromEntries(
      board.nodes.map((n) => [n.id, { ...(sampled.transforms[n.id] ?? n.transform) }]),
    ),
    opacity: Object.fromEntries(board.nodes.map((n) => [n.id, sampled.opacity[n.id] ?? n.opacity])),
  };
}
/** Scene pose snapshots are metadata/view data. Inputs stay untouched. */
export function blendLogicScenePoses(
  from: SceneMotionPose,
  to: SceneMotionPose,
  mix: number,
): SceneMotionPose {
  alpha(mix);
  const transforms: SceneMotionPose['transforms'] = {},
    opacity: SceneMotionPose['opacity'] = {};
  if (Object.keys(from.transforms).length !== Object.keys(to.transforms).length)
    throw new Error('Logic scene poses must have matching node identities.');
  for (const [id, destination] of Object.entries(to.transforms)) {
    const source = from.transforms[id];
    if (!source || from.opacity[id] === undefined || to.opacity[id] === undefined)
      throw new Error('Logic scene poses must resolve every node channel.');
    const value = { ...destination };
    for (const key of [...fields, 'pivotX', 'pivotY'] as const)
      value[key] =
        key === 'rotation'
          ? blendLogicRotation(source[key], destination[key], mix)
          : blendLogicNumber(source[key], destination[key], mix);
    transforms[id] = value;
    opacity[id] = blendLogicNumber(from.opacity[id]!, to.opacity[id]!, mix);
  }
  return { transforms, opacity };
}
/** Pre-constraint animation snapshot; allocate once for a validated pose layout. */
export class RigLogicPoseBuffer {
  private readonly locals: Float64Array;
  private readonly colors: Uint32Array;
  private readonly deforms = new Map<string, { values: Float32Array; deformed: boolean }>();
  constructor(pose: SkeletonPose) {
    this.locals = new Float64Array(pose.bones.length * fields.length);
    this.colors = new Uint32Array(pose.slots.length);
    for (const [id, state] of pose.attachments)
      this.deforms.set(id, { values: new Float32Array(state.deform.length), deformed: false });
    this.capture(pose);
  }
  private check(pose: SkeletonPose): void {
    if (
      pose.bones.length * fields.length !== this.locals.length ||
      pose.slots.length !== this.colors.length ||
      pose.attachments.size !== this.deforms.size
    )
      throw new Error('Logic pose layout changed; rebuild its snapshot buffers.');
    for (const [id, state] of pose.attachments)
      if (this.deforms.get(id)?.values.length !== state.deform.length)
        throw new Error('Logic attachment layout changed; rebuild its snapshot buffers.');
  }
  capture(pose: SkeletonPose): void {
    this.check(pose);
    for (let i = 0; i < pose.bones.length; i++)
      for (let k = 0; k < fields.length; k++)
        this.locals[i * fields.length + k] = pose.bones[i]!.local[fields[k]!];
    for (let i = 0; i < pose.slots.length; i++) this.colors[i] = pose.slots[i]!.color;
    for (const [id, state] of pose.attachments) {
      const snapshot = this.deforms.get(id)!;
      snapshot.values.set(state.deform);
      snapshot.deformed = state.deformed;
    }
  }
  /** Blend continuous channels into the freshly sampled destination; discrete fields stay destination. */
  blendInto(pose: SkeletonPose, mix: number): void {
    alpha(mix);
    this.check(pose);
    if (mix === 1) return;
    for (let i = 0; i < pose.bones.length; i++) {
      const local = pose.bones[i]!.local;
      for (let k = 0; k < fields.length; k++) {
        const key = fields[k]!,
          source = this.locals[i * fields.length + k]!,
          destination = local[key];
        local[key] =
          key === 'rotation'
            ? blendLogicRotation(source, destination, mix)
            : blendLogicNumber(source, destination, mix);
      }
    }
    for (let i = 0; i < pose.slots.length; i++)
      pose.slots[i]!.color = lerpColor(this.colors[i]!, pose.slots[i]!.color, mix);
    for (const [id, state] of pose.attachments) {
      const snapshot = this.deforms.get(id)!;
      for (let k = 0; k < state.deform.length; k++)
        state.deform[k] = blendLogicNumber(snapshot.values[k]!, state.deform[k]!, mix);
      state.deformed = state.deformed || snapshot.deformed;
    }
  }
  /** Hold the previous blended animation pose, including discrete fields handled by the caller. */
  restoreContinuous(pose: SkeletonPose): void {
    this.blendInto(pose, 0);
  }
}
