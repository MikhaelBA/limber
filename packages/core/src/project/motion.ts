import { findKeyframeIndex, interpolateNumber } from '../animation/keyframes';
import type { Curve } from '../types/animation';
import type { Artboard, SceneTransform } from './model';

export const SCENE_PROPERTIES = [
  'x',
  'y',
  'rotation',
  'scaleX',
  'scaleY',
  'shearX',
  'shearY',
  'pivotX',
  'pivotY',
  'opacity',
] as const;
export type SceneProperty = (typeof SCENE_PROPERTIES)[number];
export interface SceneKey {
  id: string;
  time: number;
  value: number;
  curve: Curve;
}
export interface SceneTrack {
  id: string;
  nodeId: string;
  property: SceneProperty;
  keys: SceneKey[];
}
export interface SceneEvent {
  id: string;
  time: number;
  name: string;
  payload?: number | string;
}
export interface SceneClip {
  id: string;
  name: string;
  duration: number;
  loop: boolean;
  fps: number;
  tracks: SceneTrack[];
  events: SceneEvent[];
}
export interface SceneMotionPose {
  transforms: Record<string, SceneTransform>;
  opacity: Record<string, number>;
}

/** Pure sampling: setup values before the first key; the final key holds at the endpoint. */
export function sampleSceneClip(artboard: Artboard, clip: SceneClip, time: number): SceneMotionPose {
  if (!Number.isFinite(time)) throw new Error('Scene time must be finite.');
  const pose: SceneMotionPose = { transforms: {}, opacity: {} };
  const nodes = new Map(artboard.nodes.map((node) => [node.id, node]));
  const t = Math.max(0, Math.min(clip.duration, time));
  for (const track of clip.tracks) {
    const node = nodes.get(track.nodeId);
    if (!node || !track.keys.length || t < track.keys[0]!.time) continue;
    const index = findKeyframeIndex(track.keys, t);
    const value = interpolateNumber(track.keys[index]!, track.keys[index + 1] ?? null, t);
    if (track.property === 'opacity') pose.opacity[node.id] = Math.max(0, Math.min(1, value));
    else {
      const transform = pose.transforms[node.id] ?? { ...node.transform };
      transform[track.property] = value;
      pose.transforms[node.id] = transform;
    }
  }
  return pose;
}

export function applySceneMotion(artboard: Artboard, pose: SceneMotionPose): Artboard {
  return {
    ...artboard,
    nodes: artboard.nodes.map((node) =>
      pose.transforms[node.id] || pose.opacity[node.id] !== undefined
        ? {
            ...node,
            transform: pose.transforms[node.id] ?? node.transform,
            opacity: pose.opacity[node.id] ?? node.opacity,
          }
        : node,
    ),
  };
}

export interface FiredSceneEvent extends SceneEvent {
  clipId: string;
  cycle: number;
}

/** Portable deterministic forward clock. UI raf cadence is never part of the event contract. */
export class SceneClock {
  private elapsed = 0;
  private initial = true;
  playing = false;
  constructor(public clip: SceneClip) {}
  get time(): number {
    return this.clip.loop ? this.elapsed % this.clip.duration : Math.min(this.elapsed, this.clip.duration);
  }
  private scrubTime: number | null = null;
  get sampleTime(): number {
    return this.scrubTime ?? this.time;
  }
  play(): void {
    if (this.scrubTime !== null) {
      this.elapsed = this.scrubTime;
      this.scrubTime = null;
    }
    if (this.elapsed >= this.clip.duration && !this.clip.loop) {
      this.elapsed = 0;
      this.initial = true;
    }
    this.playing = true;
  }
  pause(): void {
    this.playing = false;
  }
  stop(): void {
    this.playing = false;
    this.elapsed = 0;
    this.scrubTime = null;
    this.initial = true;
  }
  scrub(time: number): void {
    if (!Number.isFinite(time)) throw new Error('Scene time must be finite.');
    this.playing = false;
    this.elapsed = Math.max(0, Math.min(this.clip.duration, time));
    this.scrubTime = this.elapsed;
    this.initial = this.elapsed === 0;
  }
  advance(seconds: number): FiredSceneEvent[] {
    if (!Number.isFinite(seconds) || seconds < 0)
      throw new Error('Scene delta must be finite and nonnegative.');
    if (!this.playing) return [];
    const duration = this.clip.duration;
    if (!(duration > 0)) throw new Error('Scene clip duration must be positive.');
    let end = this.clip.loop ? this.elapsed + seconds : Math.min(this.elapsed + seconds, duration);
    // Repeated fractional frame deltas must reach the same loop boundary as one whole step.
    const boundary = Math.round(end / duration) * duration;
    if (Math.abs(end - boundary) < 1e-10 * Math.max(1, duration)) end = boundary;
    const firstCycle = this.clip.loop ? Math.floor(this.elapsed / duration) : 0;
    const lastCycle = this.clip.loop ? Math.floor(end / duration) : 0;
    if (lastCycle - firstCycle > 1000)
      throw new Error('Advance scene playback in smaller steps (maximum 1000 loops per step).');
    const fired: { at: number; index: number; event: FiredSceneEvent }[] = [];
    for (let cycle = firstCycle; cycle <= lastCycle; cycle++) {
      this.clip.events.forEach((event, index) => {
        const at = cycle * duration + event.time;
        if ((at > this.elapsed + 1e-10 || (this.initial && at === 0)) && at <= end + 1e-10)
          fired.push({ at, index, event: { ...event, clipId: this.clip.id, cycle } });
      });
    }
    fired.sort((a, b) => a.at - b.at || a.event.cycle - b.event.cycle || a.index - b.index);
    this.elapsed = end;
    this.initial = false;
    this.scrubTime = null;
    if (!this.clip.loop && end === duration) this.playing = false;
    return fired.map((entry) => entry.event);
  }
}
