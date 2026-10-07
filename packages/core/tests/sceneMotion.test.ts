import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  deserializeProject,
  serializeProject,
  sampleSceneClip,
  applySceneMotion,
  SceneClock,
  type SceneClip,
} from '../src';

const json = readFileSync(new URL('../../../fixtures/bbbproj-v2-motion.json', import.meta.url), 'utf8');
function fixture() {
  const project = deserializeProject(json),
    artboard = project.artboards[0]!,
    clip = artboard.clips![0]!;
  return { project, artboard, clip };
}

describe('scene motion sampling and schema', () => {
  it('round-trips the immutable schema-2 fixture and samples multiple properties without mutating setup', () => {
    const { project, artboard, clip } = fixture();
    expect(project).toEqual({ ...JSON.parse(json), schemaVersion: 3 });
    const before = serializeProject(project),
      pose = sampleSceneClip(artboard, clip, 0.5);
    expect(pose.transforms['image-0']!.x).toBe(50);
    expect(pose.opacity['image-1']).toBeCloseTo(0.6);
    const view = applySceneMotion(artboard, pose);
    expect(view.nodes[0]!.transform.x).toBe(50);
    expect(view.nodes[1]!.opacity).toBeCloseTo(0.6);
    expect(serializeProject(project)).toBe(before);
    expect(sampleSceneClip(artboard, clip, 100).transforms['image-0']!.x).toBe(100);
  });
  it('retains setup before the first key and supports stepped, cubic and overshoot curves', () => {
    const { artboard, clip } = fixture();
    const track = clip.tracks[0]!;
    track.keys[0]!.time = 0.25;
    expect(sampleSceneClip(artboard, clip, 0.1).transforms['image-0']).toBeUndefined();
    track.keys[0]!.time = 0;
    track.keys[0]!.curve = { type: 'stepped' };
    expect(sampleSceneClip(artboard, clip, 0.9).transforms['image-0']!.x).toBe(0);
    track.keys[0]!.curve = { type: 'bezier', c1: 0.42, c2: 0, c3: 0.58, c4: 1 };
    expect(sampleSceneClip(artboard, clip, 0.25).transforms['image-0']!.x).toBeCloseTo(12.91619, 4);
    expect(sampleSceneClip(artboard, clip, 0.5).transforms['image-0']!.x).toBeCloseTo(50, 5);
    const opacity = clip.tracks[1]!;
    opacity.keys[0]!.value = 0;
    opacity.keys[1]!.value = 1;
    opacity.keys[0]!.curve = { type: 'bezier', c1: 0.3, c2: 3, c3: 0.7, c4: 3 };
    expect(sampleSceneClip(artboard, clip, 0.5).opacity['image-1']).toBe(1);
    expect(opacity.keys[0]!.curve.c2).toBe(3);
  });
  it('rejects missing targets, duplicate tracks/keys, unordered time, invalid curves and events', () => {
    const mutations: ((clip: SceneClip) => void)[] = [
      (clip) => {
        clip.tracks[0]!.nodeId = 'missing';
      },
      (clip) => {
        clip.tracks[1]!.nodeId = 'image-0';
        clip.tracks[1]!.property = 'x';
      },
      (clip) => {
        clip.tracks[0]!.keys[1]!.id = 'x0';
      },
      (clip) => {
        clip.tracks[0]!.keys[1]!.time = 0;
      },
      (clip) => {
        clip.tracks[0]!.keys[0]!.curve = { type: 'bezier', c1: 2, c2: 0, c3: 0.8, c4: 1 };
      },
      (clip) => {
        clip.duration = 0;
      },
      (clip) => {
        clip.events[1]!.time = 2;
      },
    ];
    for (const mutate of mutations) {
      const { project, clip } = fixture();
      mutate(clip);
      expect(() => serializeProject(project)).toThrow();
    }
  });
});

describe('deterministic scene playback clock', () => {
  it('reaches identical boundaries with thirty fractional frames and one second', () => {
    const { clip } = fixture();
    const a = new SceneClock(clip),
      b = new SceneClock(clip);
    a.play();
    b.play();
    expect(Array.from({ length: 30 }, () => a.advance(1 / 30)).flat()).toEqual(b.advance(1));
    expect(a.time).toBe(0);
  });
  it('emits initial zero once and end-before-start at exact loop boundaries', () => {
    const { clip } = fixture();
    const clock = new SceneClock(clip);
    clock.play();
    expect(clock.advance(0).map((e) => e.name)).toEqual(['start']);
    expect(clock.advance(0)).toEqual([]);
    expect(clock.advance(1).map((e) => [e.name, e.cycle])).toEqual([
      ['middle', 0],
      ['end', 0],
      ['start', 1],
    ]);
    expect(clock.time).toBe(0);
    expect(clock.advance(2.25).map((e) => [e.name, e.cycle])).toEqual([
      ['middle', 1],
      ['end', 1],
      ['start', 2],
      ['middle', 2],
      ['end', 2],
      ['start', 3],
    ]);
    expect(clock.time).toBe(0.25);
  });
  it('replays identical event order for large and split deltas, including same-time events', () => {
    const { clip } = fixture();
    clip.events.splice(2, 0, { id: 'other', name: 'other', time: 0.5 });
    const a = new SceneClock(clip),
      b = new SceneClock(clip);
    a.play();
    b.play();
    const one = a.advance(2.5);
    const split = Array.from({ length: 10 }, () => b.advance(0.25)).flat();
    expect(split).toEqual(one);
    expect(a.time).toBe(b.time);
    expect(one.slice(0, 3).map((e) => e.name)).toEqual(['start', 'middle', 'other']);
  });
  it('scrubs without events, keeps exact endpoints and stops non-loop playback', () => {
    const { clip } = fixture();
    clip.loop = false;
    const clock = new SceneClock(clip);
    clock.scrub(1);
    expect(clock.sampleTime).toBe(1);
    expect(clock.advance(1)).toEqual([]);
    clock.stop();
    clock.play();
    clock.advance(0.5);
    clock.pause();
    expect(clock.advance(2)).toEqual([]);
    expect(clock.time).toBe(0.5);
    clock.play();
    expect(clock.advance(2).map((e) => e.name)).toEqual(['end']);
    expect(clock.playing).toBe(false);
    expect(clock.time).toBe(1);
    clock.play();
    expect(clock.advance(0).map((e) => e.name)).toEqual(['start']);
    expect(() => clock.advance(Infinity)).toThrow();
    expect(() => clock.scrub(NaN)).toThrow();
  });
  it('rejects excessive loop steps without advancing the clock', () => {
    const clock = new SceneClock(fixture().clip);
    clock.play();
    expect(() => clock.advance(1002)).toThrow(/smaller steps/);
    expect(clock.time).toBe(0);
  });
});
