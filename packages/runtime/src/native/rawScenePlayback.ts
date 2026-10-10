import {
  resolveLogicScenePose,
  blendLogicScenePoses,
  applySceneMotion,
  type Artboard,
  type SceneClip,
  type SceneMotionPose,
  type LogicFiredEvent,
} from '@limber/core';
import {
  RawPlaybackClock,
  type NativeAnimationOptions,
  type NativeQueuedAnimationOptions,
} from './RawPlaybackClock';

/** Scene poses use the exact raw clock/FIFO/event contract exercised by characters. */
export class RawScenePlayback {
  private readonly board: Artboard;
  private readonly track: RawPlaybackClock<SceneClip>;
  private pose: SceneMotionPose;
  private outgoing: SceneMotionPose;
  constructor(source: Artboard) {
    this.board = structuredClone(source);
    this.pose = resolveLogicScenePose(this.board, null, 0);
    this.outgoing = structuredClone(this.pose);
    this.track = new RawPlaybackClock(
      (this.board.clips ?? []).map((clip) => ({
        id: clip.id,
        name: clip.name,
        duration: clip.duration,
        loop: clip.loop,
        body: clip,
        events: clip.events.map((event) => ({
          time: event.time,
          eventName: event.name,
          payload: event.payload,
        })),
      })),
      {
        hold: () => {
          this.outgoing = structuredClone(this.pose);
        },
        sample: () => this.sample(),
        finish: () => {},
      },
    );
  }
  private sample(): void {
    const clip = this.track.currentClip;
    const destination = resolveLogicScenePose(this.board, clip?.body ?? null, this.track.time);
    this.pose =
      clip && this.track.blendProgress < 1
        ? blendLogicScenePoses(this.outgoing, destination, this.track.blendProgress)
        : destination;
  }
  get playing(): boolean {
    return this.track.playing;
  }
  get currentTick(): number {
    return this.track.currentTick;
  }
  get currentClip(): string | null {
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
  play(id?: string, options: NativeAnimationOptions = {}): void {
    this.track.play(id, options);
  }
  queueAnimation(id: string, options: NativeQueuedAnimationOptions = {}): void {
    this.track.queueAnimation(id, options);
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
  getView(): Artboard {
    return applySceneMotion(this.board, this.pose);
  }
  onEvent(listener: (event: LogicFiredEvent) => void): () => void {
    return this.track.onEvent(listener);
  }
}
