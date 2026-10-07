import {
  applySceneMotion,
  sampleSceneClip,
  SceneClock,
  type Artboard,
  type FiredSceneEvent,
  type SceneMotionPose,
} from '@limber/core';

/** Transient editor session: structural notifications are separate from frame callbacks. */
export class SceneMotionSession {
  enabled = false;
  autoKey = false;
  private boardId = '';
  clock: SceneClock | null = null;
  recentEvents: FiredSceneEvent[] = [];
  private draft: SceneMotionPose = { transforms: {}, opacity: {} };
  private changes = new Set<() => void>();
  private frames = new Set<() => void>();
  constructor(private getArtboard: () => Artboard) {}
  get clip() {
    return this.clock?.clip ?? null;
  }
  get time() {
    return this.clock?.sampleTime ?? 0;
  }
  get playing() {
    return this.clock?.playing ?? false;
  }
  subscribe(callback: () => void) {
    this.changes.add(callback);
    return () => {
      this.changes.delete(callback);
    };
  }
  onFrame(callback: () => void) {
    this.frames.add(callback);
    return () => {
      this.frames.delete(callback);
    };
  }
  private changed() {
    for (const callback of this.changes) callback();
    this.frame();
  }
  private frame() {
    for (const callback of this.frames) callback();
  }
  refresh(): void {
    const board = this.getArtboard();
    if (board.id !== this.boardId) {
      this.boardId = board.id;
      this.clock = null;
      this.enabled = false;
      this.recentEvents = [];
      this.draft = { transforms: {}, opacity: {} };
      this.changed();
      return;
    }
    if (this.clock) {
      const clip = board.clips?.find((clip) => clip.id === this.clock!.clip.id);
      if (!clip) {
        this.clock = null;
        this.enabled = false;
      } else this.clock.clip = clip;
    }
    this.changed();
  }
  select(id: string): void {
    const clip = this.getArtboard().clips?.find((clip) => clip.id === id);
    if (!clip) throw new Error('Scene clip no longer exists.');
    this.boardId = this.getArtboard().id;
    this.clock = new SceneClock(clip);
    this.draft = { transforms: {}, opacity: {} };
    this.enabled = true;
    this.recentEvents = [];
    this.changed();
  }
  setEnabled(enabled: boolean): void {
    this.enabled = enabled && !!this.clock;
    if (!enabled) {
      this.clock?.pause();
      this.draft = { transforms: {}, opacity: {} };
    }
    this.changed();
  }
  setAutoKey(value: boolean): void {
    this.autoKey = value;
    this.changed();
  }
  scrub(time: number): void {
    this.draft = { transforms: {}, opacity: {} };
    this.clock?.scrub(time);
    this.changed();
  }
  setDraft(pose: SceneMotionPose): void {
    this.clock?.pause();
    this.draft = {
      transforms: { ...this.draft.transforms, ...pose.transforms },
      opacity: { ...this.draft.opacity, ...pose.opacity },
    };
    this.changed();
  }
  clearDraft(): void {
    this.draft = { transforms: {}, opacity: {} };
    this.changed();
  }
  play(): void {
    if (!this.clock) return;
    this.draft = { transforms: {}, opacity: {} };
    this.enabled = true;
    this.clock.play();
    this.changed();
  }
  pause(): void {
    this.clock?.pause();
    this.changed();
  }
  stop(): void {
    this.clock?.stop();
    this.draft = { transforms: {}, opacity: {} };
    this.recentEvents = [];
    this.changed();
  }
  advance(seconds: number): void {
    if (!this.enabled || !this.clock?.playing) return;
    const events = this.clock.advance(Math.min(seconds, 0.1));
    if (events.length) this.recentEvents = [...this.recentEvents, ...events].slice(-12);
    this.frame();
    if (!this.clock.playing) for (const callback of this.changes) callback();
  }
  pose(): SceneMotionPose {
    if (!this.enabled || !this.clock) return { transforms: {}, opacity: {} };
    const pose = sampleSceneClip(this.getArtboard(), this.clock.clip, this.time);
    return {
      transforms: { ...pose.transforms, ...this.draft.transforms },
      opacity: { ...pose.opacity, ...this.draft.opacity },
    };
  }
  view(): Artboard {
    return applySceneMotion(this.getArtboard(), this.pose());
  }
}
