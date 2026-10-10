import {
  FixedStepClock,
  SECONDARY_STEP_SECONDS as STEP,
  LogicEventSampler,
  type LogicClipEvent,
  type LogicFiredEvent,
} from '@limber/core';
import { canonicalRuntimeInteger as canonical, nativeDurationTicks } from './timing';
import { validateNativeEventWork } from './eventWork';

export interface NativeAnimationOptions {
  loop?: boolean;
  fadeDuration?: number;
}
export interface NativeQueuedAnimationOptions extends NativeAnimationOptions {
  delay?: number;
}
export interface NativeRawClip<T> {
  id: string;
  name: string;
  duration: number;
  loop: boolean;
  body: T;
  events: LogicClipEvent[];
}
interface Entry<T> {
  clip: NativeRawClip<T>;
  loop: boolean;
  tick: number;
  fadeDuration: number;
}
interface Queued<T> {
  clip: NativeRawClip<T>;
  loop: boolean;
  fadeDuration: number;
  delayTicks: number;
}
interface Boundary {
  ready: number;
  end: number;
  cycles: number | null;
}
interface PoseHooks {
  hold(): void;
  sample(advance: boolean, rebase: boolean): void;
  finish(): void;
}

/** Shared raw scene/character clock. Pose sampling stays outside timing/event policy. */
export class RawPlaybackClock<T> {
  private readonly clips: Map<string, NativeRawClip<T>>;
  private readonly samplers = new Map<string, LogicEventSampler>();
  private readonly clock = new FixedStepClock();
  private entry: Entry<T> | null = null;
  private readonly queue: Queued<T>[] = [];
  private boundary: Boundary | null = null;
  private playingValue = false;
  private ticks = 0;
  private epoch = 0;
  private advancing = false;
  private readonly listeners = new Set<(event: LogicFiredEvent) => void>();
  readonly events: LogicFiredEvent[] = [];
  constructor(
    clips: NativeRawClip<T>[],
    private readonly pose: PoseHooks,
  ) {
    this.clips = new Map(clips.map((clip) => [clip.id, clip]));
    for (const clip of clips) {
      nativeDurationTicks(clip.duration, 'Clip duration');
      const sampler = new LogicEventSampler(Math.max(clip.duration, STEP), clip.events);
      sampler.validateLoop(clip.loop && clip.duration > 0);
      this.samplers.set(clip.id, sampler);
    }
  }
  get playing(): boolean {
    return this.playingValue;
  }
  get currentTick(): number {
    return this.ticks;
  }
  get currentClip(): NativeRawClip<T> | null {
    return this.entry?.clip ?? null;
  }
  get queueLength(): number {
    return this.queue.length;
  }
  get time(): number {
    if (!this.entry) return 0;
    const { clip, loop, tick } = this.entry;
    if (this.boundary && tick >= this.boundary.end) return clip.duration;
    if (!loop || clip.duration === 0) return Math.min(clip.duration, tick * STEP);
    const cycles = canonical((tick * STEP) / clip.duration);
    return (cycles - Math.floor(cycles)) * clip.duration;
  }
  get blendProgress(): number {
    return !this.entry || this.entry.fadeDuration === 0
      ? 1
      : Math.min(1, (this.entry.tick * STEP) / this.entry.fadeDuration);
  }
  get lastDiscardedSeconds(): number {
    return this.clock.lastDiscardedSeconds;
  }
  resetFraction(): void {
    this.clock.reset();
  }
  private prepare(id: string, options: NativeQueuedAnimationOptions): Queued<T> {
    const clip = this.clips.get(id);
    if (!clip) throw new Error(`Unknown native animation "${id}".`);
    if (options.loop !== undefined && typeof options.loop !== 'boolean')
      throw new Error('Loop must be boolean.');
    const fadeDuration = options.fadeDuration ?? 0,
      delay = options.delay ?? 0;
    nativeDurationTicks(fadeDuration, 'Fade duration');
    const delayTicks = nativeDurationTicks(delay, 'Queue delay'),
      loop = (options.loop ?? clip.loop) && clip.duration > 0;
    this.samplers.get(id)!.validateLoop(loop);
    validateNativeEventWork(clip.duration, clip.events.length, loop, null);
    return { clip, loop, fadeDuration, delayTicks };
  }
  play(id?: string, options: NativeAnimationOptions = {}): void {
    if (id === undefined && this.playingValue) return;
    if (id !== undefined) {
      const prepared = this.prepare(id, options);
      this.queue.length = 0;
      this.boundary = null;
      this.start(prepared);
    }
    this.playingValue = true;
    this.clock.reset();
    this.epoch++;
    this.events.length = 0;
  }
  queueAnimation(id: string, options: NativeQueuedAnimationOptions = {}): void {
    const prepared = this.prepare(id, options);
    if (this.queue.length >= 256) throw new Error('Native animation queue supports at most 256 entries.');
    if (!this.entry) {
      this.play(id, options);
      return;
    }
    const previous = this.queue.at(-1);
    const future = this.boundaryFor(
      previous
        ? { clip: previous.clip, loop: previous.loop, tick: 0, fadeDuration: previous.fadeDuration }
        : this.entry,
      prepared,
    );
    this.queue.push(prepared);
    if (this.boundary === null) this.boundary = future;
  }
  private boundaryFor(entry: Entry<T>, next: Queued<T>): Boundary {
    const cycle = entry.loop ? Math.floor(canonical((entry.tick * STEP) / entry.clip.duration)) + 1 : 1;
    const end = Math.max(1, nativeDurationTicks(cycle * entry.clip.duration, 'Queue boundary'));
    const ready = Math.max(entry.tick, end) + next.delayTicks;
    if (!Number.isSafeInteger(ready)) throw new Error('Queue boundary exceeds the safe fixed-step range.');
    return { ready, end, cycles: entry.loop ? cycle : null };
  }
  private start(prepared: Queued<T>): void {
    this.pose.hold();
    this.entry = { clip: prepared.clip, loop: prepared.loop, fadeDuration: prepared.fadeDuration, tick: 0 };
    this.pose.sample(false, true);
    this.pose.finish();
  }
  pause(): void {
    if (!this.playingValue) return;
    this.playingValue = false;
    this.clock.reset();
    this.epoch++;
    this.events.length = 0;
    this.pose.sample(false, true);
    this.pose.finish();
  }
  stop(): void {
    this.playingValue = false;
    this.entry = null;
    this.queue.length = 0;
    this.boundary = null;
    this.clock.reset();
    this.ticks = 0;
    this.epoch++;
    this.events.length = 0;
    this.pose.sample(false, true);
    this.pose.finish();
  }
  step(): number {
    if (this.advancing) throw new Error('Native playback step cannot be reentrant.');
    if (this.playingValue) throw new Error('Pause native playback before stepping.');
    this.clock.reset();
    this.playingValue = true;
    try {
      return this.update(STEP);
    } finally {
      this.playingValue = false;
      this.clock.reset();
    }
  }
  update(delta: number): number {
    if (this.advancing) throw new Error('Native playback update cannot be reentrant.');
    this.events.length = 0;
    if (!this.playingValue) return 0;
    const count = this.clock.consume(delta),
      epoch = this.epoch;
    let accepted = 0;
    this.advancing = true;
    try {
      for (let i = 0; i < count && this.playingValue && this.epoch === epoch; i++) {
        if (!Number.isSafeInteger(this.ticks + 1)) throw new Error('Native accepted tick counter overflow.');
        if (this.entry && this.boundary && this.entry.tick >= this.boundary.ready) {
          this.start(this.queue.shift()!);
          this.boundary = null;
          if (this.queue.length) this.boundary = this.boundaryFor(this.entry!, this.queue[0]!);
        }
        const entry = this.entry,
          from = entry?.tick ?? 0;
        if (entry) {
          if (!Number.isSafeInteger(entry.tick + 1)) throw new Error('Native clip tick counter overflow.');
          entry.tick++;
        }
        this.ticks++;
        accepted++;
        this.pose.sample(true, false);
        const fired =
          entry && (!this.boundary || from < this.boundary.end)
            ? this.samplers
                .get(entry.clip.id)!
                .collect(from, entry.tick, entry.loop, from === 0, entry.clip.id, entry.clip.name)
            : [];
        for (const event of fired) {
          if (this.boundary?.cycles != null && event.cycle >= this.boundary.cycles) continue;
          this.events.push(structuredClone(event));
          for (const listener of [...this.listeners]) {
            listener(structuredClone(event));
            if (this.epoch !== epoch) break;
          }
          if (this.epoch !== epoch) break;
        }
      }
      if (count === 0) this.pose.sample(false, false);
      return accepted;
    } finally {
      try {
        this.pose.finish();
      } finally {
        this.advancing = false;
      }
    }
  }
  onEvent(listener: (event: LogicFiredEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
