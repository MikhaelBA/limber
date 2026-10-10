import {
  Skeleton,
  resetPose,
  applyTimeline,
  solveFK,
  solveConstraints,
  updateSkinning,
  FixedStepClock,
  SECONDARY_STEP_SECONDS as STEP,
  RigLogicPoseBuffer,
  LogicEventSampler,
  type RigNode,
  type Animation,
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
interface Entry {
  clip: Animation;
  loop: boolean;
  tick: number;
  fadeDuration: number;
}
interface Queued {
  clip: Animation;
  loop: boolean;
  fadeDuration: number;
  delayTicks: number;
}

/** Native raw track: held pre-constraint crossfade, FIFO queue and integer accepted ticks. */
export class RawRigPlayback {
  readonly skeleton: Skeleton;
  private readonly clips: Map<string, Animation>;
  private readonly samplers = new Map<string, LogicEventSampler>();
  private readonly clock = new FixedStepClock();
  private readonly previous: RigLogicPoseBuffer;
  private readonly outgoing: RigLogicPoseBuffer;
  private entry: Entry | null = null;
  private readonly queue: Queued[] = [];
  private queueBoundary: number | null = null;
  private queueCompletion: number | null = null;
  private queueCycles: number | null = null;
  private skin: string;
  private playingValue = false;
  private ticks = 0;
  private epoch = 0;
  private advancing = false;
  private readonly listeners = new Set<(event: LogicFiredEvent) => void>();
  readonly events: LogicFiredEvent[] = [];

  constructor(
    source: RigNode,
    private readonly attachments: ReadonlyMap<string, string | null>,
  ) {
    this.skeleton = new Skeleton(structuredClone(source.skeleton));
    this.skin = source.skeleton.activeSkin;
    this.clips = new Map(structuredClone(source.animations).map((clip) => [clip.name, clip]));
    for (const clip of this.clips.values()) {
      nativeDurationTicks(clip.duration, 'Clip duration');
      const sampler = new LogicEventSampler(
        Math.max(clip.duration, STEP),
        clip.timelines.flatMap((t) => (t.kind === 'event' ? t.keyframes : [])),
      );
      sampler.validateLoop(clip.loop && clip.duration > 0);
      this.samplers.set(clip.name, sampler);
    }
    this.previous = new RigLogicPoseBuffer(this.skeleton.pose);
    this.outgoing = new RigLogicPoseBuffer(this.skeleton.pose);
    this.render(false, true);
    this.finishFrame();
  }
  get playing(): boolean {
    return this.playingValue;
  }
  get currentTick(): number {
    return this.ticks;
  }
  get currentAnimation(): string | null {
    return this.entry?.clip.name ?? null;
  }
  get queueLength(): number {
    return this.queue.length;
  }
  get time(): number {
    if (!this.entry) return 0;
    const { clip, loop, tick } = this.entry;
    if (this.queueCompletion !== null && tick >= this.queueCompletion) return clip.duration;
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

  private prepare(name: string, options: NativeQueuedAnimationOptions): Queued {
    const clip = this.clips.get(name);
    if (!clip) throw new Error(`Unknown native animation "${name}".`);
    if (options.loop !== undefined && typeof options.loop !== 'boolean')
      throw new Error('Loop must be boolean.');
    const fadeDuration = options.fadeDuration ?? 0,
      delay = options.delay ?? 0;
    nativeDurationTicks(fadeDuration, 'Fade duration');
    const delayTicks = nativeDurationTicks(delay, 'Queue delay');
    const loop = (options.loop ?? clip.loop) && clip.duration > 0;
    this.samplers.get(name)!.validateLoop(loop);
    validateNativeEventWork(
      clip.duration,
      clip.timelines.reduce((count, t) => count + (t.kind === 'event' ? t.keyframes.length : 0), 0),
      loop,
      null,
    );
    return { clip, loop, fadeDuration, delayTicks };
  }
  play(name?: string, options: NativeAnimationOptions = {}): void {
    if (name === undefined && this.playingValue) return;
    if (name !== undefined) {
      const prepared = this.prepare(name, options); // Entire request validates before changing playback.
      this.queue.length = 0;
      this.queueBoundary = null;
      this.queueCompletion = null;
      this.queueCycles = null;
      this.start(prepared);
    }
    this.playingValue = true;
    this.clock.reset();
    this.epoch++;
    this.events.length = 0;
  }
  queueAnimation(name: string, options: NativeQueuedAnimationOptions = {}): void {
    const prepared = this.prepare(name, options);
    if (this.queue.length >= 256) throw new Error('Native animation queue supports at most 256 entries.');
    if (!this.entry) {
      this.play(name, options);
      return;
    }
    const previous = this.queue.at(-1);
    // Preflight even future boundaries before mutating the FIFO.
    const future = this.boundaryFor(
      previous
        ? { clip: previous.clip, loop: previous.loop, tick: 0, fadeDuration: previous.fadeDuration }
        : this.entry,
      prepared,
    );
    this.queue.push(prepared);
    if (this.queueBoundary === null) this.installBoundary(future);
  }
  private boundaryFor(entry: Entry, next: Queued): { ready: number; end: number; cycles: number | null } {
    const cycle = entry.loop ? Math.floor(canonical((entry.tick * STEP) / entry.clip.duration)) + 1 : 1;
    const end = Math.max(1, nativeDurationTicks(cycle * entry.clip.duration, 'Queue boundary'));
    const boundary = Math.max(entry.tick, end) + next.delayTicks;
    if (!Number.isSafeInteger(boundary)) throw new Error('Queue boundary exceeds the safe fixed-step range.');
    return { ready: boundary, end, cycles: entry.loop ? cycle : null };
  }
  private installBoundary(boundary: { ready: number; end: number; cycles: number | null }): void {
    this.queueBoundary = boundary.ready;
    this.queueCompletion = boundary.end;
    this.queueCycles = boundary.cycles;
  }
  private start(prepared: Queued): void {
    // Restore the last animation result before primary/secondary constraints, then hold it.
    this.previous.restoreContinuous(this.skeleton.pose);
    this.outgoing.capture(this.skeleton.pose);
    this.entry = { clip: prepared.clip, loop: prepared.loop, fadeDuration: prepared.fadeDuration, tick: 0 };
    this.render(false, true);
    this.finishFrame();
  }
  pause(): void {
    if (!this.playingValue) return;
    this.playingValue = false;
    this.clock.reset();
    this.epoch++;
    this.events.length = 0;
    this.render(false, true);
    this.finishFrame();
  }
  stop(): void {
    this.playingValue = false;
    this.entry = null;
    this.queue.length = 0;
    this.queueBoundary = null;
    this.queueCompletion = null;
    this.queueCycles = null;
    this.clock.reset();
    this.ticks = 0;
    this.epoch++;
    this.events.length = 0;
    this.render(false, true);
    this.finishFrame();
  }
  setSkin(name: string): void {
    if (name !== '' && !this.skeleton.data.skins.some((s) => s.name === name))
      throw new Error(`Unknown skin "${name}".`);
    this.skin = name;
    this.render(false, false);
    this.finishFrame();
  }
  refreshAttachments(): void {
    this.render(false, false);
    this.finishFrame();
  }
  resetSecondaryMotion(): void {
    this.clock.reset();
    this.skeleton.secondaryMotion?.invalidate();
    this.render(false, true);
    this.finishFrame();
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
        if (this.entry && this.queueBoundary !== null && this.entry.tick >= this.queueBoundary) {
          this.start(this.queue.shift()!);
          this.queueBoundary = null;
          this.queueCompletion = null;
          this.queueCycles = null;
          if (this.queue.length) this.installBoundary(this.boundaryFor(this.entry!, this.queue[0]!));
        }
        const entry = this.entry,
          from = entry?.tick ?? 0;
        if (entry) {
          if (!Number.isSafeInteger(entry.tick + 1)) throw new Error('Native clip tick counter overflow.');
          entry.tick++;
        }
        this.ticks++;
        accepted++;
        this.render(true, false);
        const fired =
          entry && (this.queueCompletion === null || from < this.queueCompletion)
            ? this.samplers
                .get(entry.clip.name)!
                .collect(from, entry.tick, entry.loop, from === 0, entry.clip.name, entry.clip.name)
            : [];
        for (const event of fired) {
          if (this.queueCycles !== null && event.cycle >= this.queueCycles) continue;
          this.events.push(structuredClone(event));
          for (const listener of [...this.listeners]) {
            listener(structuredClone(event));
            if (this.epoch !== epoch) break;
          }
          if (this.epoch !== epoch) break;
        }
      }
      if (count === 0) this.render(false, false);
      return accepted;
    } finally {
      this.finishFrame();
      this.advancing = false;
    }
  }
  private render(advance: boolean, rebase: boolean): void {
    const { data, pose } = this.skeleton;
    resetPose(data, pose, this.skin);
    if (this.entry) {
      for (const timeline of this.entry.clip.timelines)
        if (timeline.kind !== 'event')
          applyTimeline(timeline, this.skeleton, this.time, this.time, 1, null, this.entry.clip.name);
      if (this.entry.fadeDuration > 0) this.outgoing.blendInto(pose, this.blendProgress);
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
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
