import type { Artboard } from '../project/model';
import { applySceneMotion, type SceneClip, type SceneMotionPose } from '../project/motion';
import { resolveLogicScenePose, blendLogicScenePoses } from './poseBlend';
import { LogicPlayback } from './LogicPlayback';
import type { LogicSnapshot } from './LogicMachine';
import { LogicEventSampler, type LogicFiredEvent } from './eventSampling';
export class SceneLogicPlayer extends LogicPlayback {
  private readonly board: Artboard;
  private readonly clips: Map<string, SceneClip>;
  private readonly samplers = new Map<string, LogicEventSampler>();
  private pose: SceneMotionPose;
  private outgoing: SceneMotionPose;
  constructor(source: Artboard) {
    if (!source.logic) throw new Error('Scene Logic playback needs an artboard graph.');
    const board = structuredClone(source),
      clips = new Map((board.clips ?? []).map((c) => [c.id, c]));
    super(board.logic!, new Map([...clips].map(([id, c]) => [id, { duration: c.duration }])));
    this.board = board;
    this.clips = clips;
    this.pose = resolveLogicScenePose(board, null, 0);
    this.outgoing = structuredClone(this.pose);
    for (const state of board.logic!.states)
      if (state.clip !== null) {
        const clip = clips.get(state.clip)!;
        let sampler = this.samplers.get(clip.id);
        if (!sampler) {
          sampler = new LogicEventSampler(
            clip.duration,
            clip.events.map((e) => ({ time: e.time, eventName: e.name, payload: e.payload })),
          );
          this.samplers.set(clip.id, sampler);
        }
        sampler.validateLoop(state.loop);
      }
    this.initialize();
  }
  protected sample(snapshot: LogicSnapshot, entered: boolean): void {
    if (entered) this.outgoing = structuredClone(this.pose);
    const destination = resolveLogicScenePose(
      this.board,
      snapshot.clip === null ? null : this.clips.get(snapshot.clip)!,
      snapshot.clipTime,
    );
    this.pose = snapshot.transition
      ? blendLogicScenePoses(this.outgoing, destination, snapshot.transition.progress)
      : destination;
  }
  protected evaluate(_advance: boolean, _entered: boolean): void {}
  protected collect(from: number, to: number, entered: boolean, snapshot: LogicSnapshot): LogicFiredEvent[] {
    if (snapshot.clip === null) return [];
    const clip = this.clips.get(snapshot.clip)!;
    return this.samplers.get(clip.id)!.collect(from, to, snapshot.loop, entered, clip.id, clip.name);
  }
  protected showSetup(): void {
    this.pose = resolveLogicScenePose(this.board, null, 0);
  }
  protected finishFrame(): void {}
  /** Read-only transient view; source assets and stored overrides are not changed. */
  getView(): Artboard {
    return applySceneMotion(this.board, this.pose);
  }
  getPose(): SceneMotionPose {
    return this.pose;
  }
}
