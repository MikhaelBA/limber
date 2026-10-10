import {
  Skeleton,
  resetPose,
  applyTimeline,
  solveFK,
  solveConstraints,
  updateSkinning,
  RigLogicPoseBuffer,
  type RigNode,
  type Animation,
  type LogicFiredEvent,
} from '@limber/core';
import {
  RawPlaybackClock,
  type NativeAnimationOptions,
  type NativeQueuedAnimationOptions,
} from './RawPlaybackClock';
export type { NativeAnimationOptions, NativeQueuedAnimationOptions } from './RawPlaybackClock';

/** Character pose adapter for the shared raw scene/rig timing policy. */
export class RawRigPlayback {
  readonly skeleton: Skeleton;
  private readonly track: RawPlaybackClock<Animation>;
  private readonly previous: RigLogicPoseBuffer;
  private readonly outgoing: RigLogicPoseBuffer;
  private skin: string;
  constructor(
    source: RigNode,
    private readonly attachments: ReadonlyMap<string, string | null>,
  ) {
    this.skeleton = new Skeleton(structuredClone(source.skeleton));
    this.skin = source.skeleton.activeSkin;
    this.previous = new RigLogicPoseBuffer(this.skeleton.pose);
    this.outgoing = new RigLogicPoseBuffer(this.skeleton.pose);
    this.track = new RawPlaybackClock(
      structuredClone(source.animations).map((clip) => ({
        id: clip.name,
        name: clip.name,
        duration: clip.duration,
        loop: clip.loop,
        body: clip,
        events: clip.timelines.flatMap((t) => (t.kind === 'event' ? t.keyframes : [])),
      })),
      {
        hold: () => {
          this.previous.restoreContinuous(this.skeleton.pose);
          this.outgoing.capture(this.skeleton.pose);
        },
        sample: (advance, rebase) => this.render(advance, rebase),
        finish: () => this.finishFrame(),
      },
    );
    this.render(false, true);
    this.finishFrame();
  }
  get playing(): boolean {
    return this.track.playing;
  }
  get currentTick(): number {
    return this.track.currentTick;
  }
  get currentAnimation(): string | null {
    return this.track.currentClip?.id ?? null;
  }
  get queueLength(): number {
    return this.track.queueLength;
  }
  get time(): number {
    return this.track.time;
  }
  get blendProgress(): number {
    return this.track.blendProgress;
  }
  get lastDiscardedSeconds(): number {
    return this.track.lastDiscardedSeconds;
  }
  get events(): LogicFiredEvent[] {
    return this.track.events;
  }
  play(name?: string, options: NativeAnimationOptions = {}): void {
    this.track.play(name, options);
  }
  queueAnimation(name: string, options: NativeQueuedAnimationOptions = {}): void {
    this.track.queueAnimation(name, options);
  }
  pause(): void {
    this.track.pause();
  }
  stop(): void {
    this.track.stop();
  }
  update(delta: number): number {
    return this.track.update(delta);
  }
  step(): number {
    return this.track.step();
  }
  setSkin(name: string): void {
    if (name !== '' && !this.skeleton.data.skins.some((s) => s.name === name))
      throw new Error('Unknown skin "' + name + '".');
    this.skin = name;
    this.render(false, false);
    this.finishFrame();
  }
  refreshAttachments(): void {
    this.render(false, false);
    this.finishFrame();
  }
  resetSecondaryMotion(): void {
    this.track.resetFraction();
    this.skeleton.secondaryMotion?.invalidate();
    this.render(false, true);
    this.finishFrame();
  }
  private render(advance: boolean, rebase: boolean): void {
    const { data, pose } = this.skeleton,
      clip = this.track.currentClip;
    resetPose(data, pose, this.skin);
    if (clip) {
      for (const timeline of clip.body.timelines)
        if (timeline.kind !== 'event')
          applyTimeline(timeline, this.skeleton, this.time, this.time, 1, null, clip.name);
      this.outgoing.blendInto(pose, this.blendProgress);
    }
    this.previous.capture(pose);
    solveFK(data, this.skeleton.boneIndexMap, pose);
    solveConstraints(this.skeleton);
    const motion = this.skeleton.secondaryMotion;
    if (motion) {
      if (rebase || !motion.initialized) motion.rebase(this.skeleton);
      motion.evaluate(this.skeleton, advance);
    }
  }
  private finishFrame(): void {
    for (const [slotId, attachmentId] of this.attachments)
      this.skeleton.pose.slots[this.skeleton.slotIndexMap.get(slotId)!]!.attachmentId = attachmentId;
    updateSkinning(this.skeleton);
  }
  onEvent(listener: (event: LogicFiredEvent) => void): () => void {
    return this.track.onEvent(listener);
  }
}
