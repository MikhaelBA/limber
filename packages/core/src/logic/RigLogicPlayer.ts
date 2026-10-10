import type { RigNode } from '../project/model';
import type { Animation } from '../types/animation';
import { Skeleton } from '../skeleton/Skeleton';
import { resetPose } from '../skeleton/pose';
import { solveFK } from '../skeleton/FKSolver';
import { solveConstraints } from '../skeleton/constraints';
import { updateSkinning } from '../skeleton/skinning';
import { validateDeformTimelines } from '../animation/validateDeforms';
import { applyTimeline } from '../animation/applyTimeline';
import { validateAnimationEvents } from '../animation/eventPayload';
import { RigLogicPoseBuffer } from './poseBlend';
import { LogicPlayback } from './LogicPlayback';
import type { LogicSnapshot } from './LogicMachine';
import { LogicEventSampler, type LogicFiredEvent } from './eventSampling';
/** Full posing pipeline driven by the shared deterministic graph. */
export class RigLogicPlayer extends LogicPlayback {
  readonly skeleton: Skeleton;
  private readonly data: Skeleton['data'];
  private readonly publishedBones: Skeleton['pose']['bones'];
  private skin: string;
  private readonly clips: Map<string, Animation>;
  private readonly samplers = new Map<string, LogicEventSampler>();
  private readonly previous: RigLogicPoseBuffer;
  private readonly outgoing: RigLogicPoseBuffer;
  constructor(source: RigNode, target?: Skeleton) {
    if (!source.logic) throw new Error('Rig Logic playback needs a rig graph.');
    if (source.logic.bindings?.length)
      throw new Error('Scene exposure bindings belong to the artboard Logic graph.');
    const clips = structuredClone(source.animations),
      skeleton = target ?? new Skeleton(structuredClone(source.skeleton));
    if (target && source.skeleton !== target.data)
      throw new Error("Injected Logic skeleton must use the rig owner's published source.");
    validateDeformTimelines(skeleton.data, clips);
    validateAnimationEvents(clips);
    super(source.logic, new Map(clips.map((c) => [c.name, { duration: c.duration }])));
    this.skeleton = skeleton;
    this.data = skeleton.data;
    this.publishedBones = skeleton.pose.bones;
    this.skin = skeleton.data.activeSkin;
    this.clips = new Map(clips.map((c) => [c.name, c]));
    this.previous = new RigLogicPoseBuffer(skeleton.pose);
    this.outgoing = new RigLogicPoseBuffer(skeleton.pose);
    for (const state of source.logic.states)
      if (state.clip !== null) {
        const clip = this.clips.get(state.clip)!;
        let sampler = this.samplers.get(clip.name);
        if (!sampler) {
          sampler = new LogicEventSampler(
            clip.duration,
            clip.timelines.flatMap((t) =>
              t.kind === 'event'
                ? t.keyframes.map((e) => ({ time: e.time, eventName: e.eventName, payload: e.payload }))
                : [],
            ),
          );
          this.samplers.set(clip.name, sampler);
        }
        sampler.validateLoop(state.loop);
      }
    this.initialize();
  }
  protected sample(snapshot: LogicSnapshot, entered: boolean): void {
    this.assertPublication();
    const pose = this.skeleton.pose;
    if (entered) {
      this.previous.restoreContinuous(pose);
      this.outgoing.capture(pose);
    }
    resetPose(this.data, pose, this.skin);
    if (snapshot.clip !== null)
      for (const timeline of this.clips.get(snapshot.clip)!.timelines)
        if (timeline.kind !== 'event')
          applyTimeline(
            timeline,
            this.skeleton,
            snapshot.clipTime,
            snapshot.clipTime,
            1,
            null,
            snapshot.clip,
          );
    if (snapshot.transition) this.outgoing.blendInto(pose, snapshot.transition.progress);
    this.previous.capture(pose);
  }
  private assertPublication(): void {
    if (this.skeleton.pose.bones !== this.publishedBones)
      throw new Error('Rig source was republished; rebuild Logic playback.');
  }
  protected evaluate(advance: boolean, entered: boolean): void {
    solveFK(this.data, this.skeleton.boneIndexMap, this.skeleton.pose);
    solveConstraints(this.skeleton);
    const motion = this.skeleton.secondaryMotion;
    if (motion) {
      if (entered || !motion.initialized) motion.rebase(this.skeleton);
      motion.evaluate(this.skeleton, advance);
    }
  }
  protected collect(from: number, to: number, entered: boolean, snapshot: LogicSnapshot): LogicFiredEvent[] {
    return snapshot.clip === null
      ? []
      : this.samplers
          .get(snapshot.clip)!
          .collect(from, to, snapshot.loop, entered, snapshot.clip, snapshot.clip);
  }
  protected showSetup(): void {
    this.assertPublication();
    resetPose(this.data, this.skeleton.pose, this.skin);
    this.previous.capture(this.skeleton.pose);
    solveFK(this.data, this.skeleton.boneIndexMap, this.skeleton.pose);
    solveConstraints(this.skeleton);
    this.skeleton.secondaryMotion?.rebase(this.skeleton);
  }
  protected finishFrame(): void {
    updateSkinning(this.skeleton);
  }
  /** Rebase inertia after an external teleport, without changing the graph. */
  resetSecondaryMotion(): void {
    this.skeleton.secondaryMotion?.invalidate();
  }
  setSkin(name: string): void {
    if (name !== '' && !this.data.skins.some((s) => s.name === name))
      throw new Error(`Unknown skin "${name}".`);
    this.assertPublication();
    this.skin = name;
    if (this.machine.enabled) {
      this.sample(this.machine.snapshot(), false);
      this.evaluate(false, false);
    } else this.showSetup();
    this.finishFrame();
  }
  getWorldTransforms(): Float32Array {
    return this.skeleton.pose.worldMatrices;
  }
  getDeformedVertices(id: string): Float32Array {
    const state = this.skeleton.pose.attachments.get(id);
    if (!state) throw new Error(`Unknown attachment "${id}".`);
    return state.verts;
  }
}
