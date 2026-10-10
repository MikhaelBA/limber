import type { Skeleton } from '../skeleton/Skeleton';
import type { Animation } from '../types/animation';
import type { EventFrame } from '../types/events';
import { applyTimeline } from './applyTimeline';

export interface TrackOptions {
  loop?: boolean;
  /** Crossfade length in seconds; 0 = instant switch. */
  fadeDuration?: number;
}

interface QueueEntry {
  animation: Animation;
  loop: boolean;
  fadeDuration: number;
  /** Seconds to wait after the current track completes. */
  delay: number;
}

interface TrackEntry {
  animation: Animation;
  loop: boolean;
  time: number;
  prevTime: number;
  timeRemainder: number;
  /** 0 while fading in; 1 once complete (or immediately for fadeDuration 0). */
  fadeElapsed: number;
  fadeDuration: number;
  /** Fading-out previous track — removed when its weight reaches 0. */
  outgoing: boolean;
  queue: QueueEntry | null;
  queueDelayLeft: number;
}

/**
 * Animation mixing state machine (DESIGN.md §4.4).
 *
 * Designed for MULTIPLE simultaneous tracks with weights from day one: an
 * outgoing track (crossfading out) and the current track (crossfading in) are
 * both applied; `applyTimeline` composes them because the pose is reset to
 * setup before every apply. The editor drives a single track through the same
 * path; the runtime gets crossfade/queue for free.
 */
export class AnimationState {
  private current: TrackEntry | null = null;
  private outgoing: TrackEntry | null = null;
  private readonly outEvents: EventFrame[] = [];

  /** Reusable event buffer — drained by getEvents() after apply(). */
  apply(skeleton: Skeleton): EventFrame[] {
    this.outEvents.length = 0;
    if (this.outgoing) {
      const w = this.outgoingWeight();
      if (w > 0) {
        for (const tl of this.outgoing.animation.timelines) {
          applyTimeline(
            tl,
            skeleton,
            this.outgoing.time,
            this.outgoing.prevTime,
            w,
            this.outEvents,
            this.outgoing.animation.name,
          );
        }
      }
    }
    const cur = this.current;
    if (cur) {
      const w = this.currentWeight();
      for (const tl of cur.animation.timelines) {
        applyTimeline(tl, skeleton, cur.time, cur.prevTime, w, this.outEvents, cur.animation.name);
      }
    }
    return this.outEvents;
  }

  setAnimation(animation: Animation, opts?: TrackOptions): void {
    const fade = Math.max(0, opts?.fadeDuration ?? 0);
    if (this.current) {
      if (fade > 0) {
        this.current.outgoing = true;
        this.current.prevTime = this.current.time;
        this.current.fadeElapsed = 0;
        this.current.fadeDuration = fade;
        this.outgoing = this.current;
      }
      this.current = null;
    }
    this.current = makeEntry(animation, opts?.loop ?? animation.loop, fade);
  }

  /** Queues the next animation to start when the current track completes. */
  addAnimation(animation: Animation, opts?: TrackOptions & { delay?: number }): void {
    if (!this.current) {
      this.setAnimation(animation, opts);
      return;
    }
    this.current.queue = {
      animation,
      loop: opts?.loop ?? animation.loop,
      fadeDuration: Math.max(0, opts?.fadeDuration ?? 0),
      delay: Math.max(0, opts?.delay ?? 0),
    };
    this.current.queueDelayLeft = this.current.queue.delay;
  }

  /** Jumps to a time without firing events (editor scrubbing / paused preview). */
  scrub(time: number): void {
    if (!this.current) return;
    const t = clamp(time, 0, this.current.animation.duration);
    this.current.time = t;
    this.current.prevTime = t;
    this.current.timeRemainder = 0;
  }

  /** Advances time, fades, looping, and the queue. Call once per frame. */
  update(dt: number): void {
    if (this.outgoing) {
      this.outgoing.prevTime = this.outgoing.time;
      this.outgoing.fadeElapsed += dt;
      if (this.outgoingWeight() <= 0) this.outgoing = null;
    }

    const cur = this.current;
    if (!cur) return;
    cur.prevTime = cur.time;
    const increment = dt - cur.timeRemainder,
      total = cur.time + increment;
    cur.timeRemainder = total - cur.time - increment;
    cur.time = total;
    cur.fadeElapsed += dt;

    const dur = cur.animation.duration;
    if (cur.loop && dur > 0) {
      if (cur.time >= dur) cur.time %= dur; // prevTime keeps the pre-wrap value → events fire across the seam.
    } else if (cur.time >= dur) {
      const leftover = cur.time - dur;
      cur.time = dur;
      if (cur.queue && cur.queue.delay <= 0) {
        const q = cur.queue;
        cur.queue = null;
        this.setAnimation(q.animation, { loop: q.loop, fadeDuration: q.fadeDuration });
        // Carry the remainder into the queued track so playback stays seamless.
        if (this.current && leftover > 0) {
          this.current.time = leftover;
          this.current.prevTime = leftover;
        }
      }
    }

    // Delay countdown for a queued entry (parked-at-end case).
    if (cur.queue && cur.time >= cur.animation.duration && !cur.loop) {
      cur.queueDelayLeft -= dt;
      if (cur.queueDelayLeft <= 0) {
        const q = cur.queue;
        cur.queue = null;
        this.setAnimation(q.animation, { loop: q.loop, fadeDuration: q.fadeDuration });
      }
    }
  }

  clear(): void {
    this.current = null;
    this.outgoing = null;
  }

  get hasCurrent(): boolean {
    return this.current !== null;
  }

  get time(): number {
    return this.current?.time ?? 0;
  }

  get duration(): number {
    return this.current?.animation.duration ?? 0;
  }

  get currentAnimationName(): string | null {
    return this.current?.animation.name ?? null;
  }

  currentWeight(): number {
    const cur = this.current;
    if (!cur) return 0;
    return cur.fadeDuration > 0 ? Math.min(1, cur.fadeElapsed / cur.fadeDuration) : 1;
  }

  private outgoingWeight(): number {
    const out = this.outgoing;
    if (!out) return 0;
    return out.fadeDuration > 0 ? Math.max(0, 1 - out.fadeElapsed / out.fadeDuration) : 0;
  }
}

function makeEntry(animation: Animation, loop: boolean, fadeDuration: number): TrackEntry {
  return {
    animation,
    loop,
    time: 0,
    prevTime: 0,
    timeRemainder: 0,
    fadeElapsed: fadeDuration > 0 ? 0 : Number.POSITIVE_INFINITY,
    fadeDuration,
    outgoing: false,
    queue: null,
    queueDelayLeft: 0,
  };
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
