import { describe, expect, it } from 'vitest';
import {
  AnimationState,
  Skeleton,
  solveFK,
  solveBezier,
  findKeyframeIndex,
  interpolateNumber,
  lerpColor,
  type Animation,
  type BonePropertyTimeline,
  type NumberKeyframe,
} from '@sprine/core';
import { makeBone, makeSkeletonData } from './helpers';

function kf(time: number, value: number, curve: NumberKeyframe['curve'] = { type: 'linear' }): NumberKeyframe {
  return { time, value, curve };
}

function rotAnim(boneId: string, keys: NumberKeyframe[], opts: Partial<Animation> = {}): Animation {
  const tl: BonePropertyTimeline = { kind: 'boneProperty', boneId, property: 'rotation', keyframes: keys };
  return { name: 'test', duration: 1, loop: true, timelines: [tl], ...opts };
}

function oneBoneSkeleton() {
  const sk = new Skeleton(makeSkeletonData([makeBone('root', null, { rotation: 0 })]));
  solveFK(sk.data, sk.boneIndexMap, sk.pose);
  return sk;
}

describe('solveBezier', () => {
  it('hits the endpoints exactly', () => {
    const curve = { type: 'bezier' as const, c1: 0.3, c2: 0, c3: 0.7, c4: 1 };
    expect(solveBezier(curve, 0)).toBe(0);
    expect(solveBezier(curve, 1)).toBe(1);
  });

  it('is symmetric for a symmetric curve', () => {
    const curve = { type: 'bezier' as const, c1: 0.25, c2: 0.1, c3: 0.75, c4: 0.9 };
    const a = solveBezier(curve, 0.3);
    const b = solveBezier(curve, 0.7);
    expect(a).toBeCloseTo(1 - b, 4);
  });

  it('produces overshoot when cy leaves [0,1] (bounce eases)', () => {
    const curve = { type: 'bezier' as const, c1: 0.3, c2: 1.6, c3: 0.7, c4: 1.6 };
    const y = solveBezier(curve, 0.5);
    expect(y).toBeGreaterThan(1);
  });

  it('reduces to linear when control points sit on the diagonal', () => {
    const curve = { type: 'bezier' as const, c1: 1 / 3, c2: 1 / 3, c3: 2 / 3, c4: 2 / 3 };
    expect(solveBezier(curve, 0.25)).toBeCloseTo(0.25, 3);
    expect(solveBezier(curve, 0.8)).toBeCloseTo(0.8, 3);
  });
});

describe('keyframe search & interpolation', () => {
  const keys = [kf(0, 0), kf(0.5, 10), kf(1, 20)];

  it('finds the last keyframe at or before t', () => {
    expect(findKeyframeIndex(keys, -1)).toBe(0);
    expect(findKeyframeIndex(keys, 0)).toBe(0);
    expect(findKeyframeIndex(keys, 0.4)).toBe(0);
    expect(findKeyframeIndex(keys, 0.5)).toBe(1);
    expect(findKeyframeIndex(keys, 0.99)).toBe(1);
    expect(findKeyframeIndex(keys, 5)).toBe(2);
  });

  it('interpolates linearly between keys', () => {
    expect(interpolateNumber(keys[0]!, keys[1]!, 0.25)).toBeCloseTo(5, 6);
    expect(interpolateNumber(keys[1]!, keys[2]!, 0.75)).toBeCloseTo(15, 6);
  });

  it('holds values on stepped curves and past the last key', () => {
    const stepped = [kf(0, 1, { type: 'stepped' }), kf(1, 9)];
    expect(interpolateNumber(stepped[0]!, stepped[1]!, 0.999)).toBe(1);
    expect(interpolateNumber(keys[2]!, null, 2)).toBe(20);
  });
});

describe('lerpColor', () => {
  it('lerps each RGBA channel (0xRRGGBBAA packing)', () => {
    const a = 0x000000ff;
    const b = 0xffffffff;
    const mid = lerpColor(a, b, 0.5);
    expect((mid >>> 24) & 0xff).toBe(128);
    expect((mid >>> 16) & 0xff).toBe(128);
    expect((mid >>> 8) & 0xff).toBe(128);
    expect(mid & 0xff).toBe(255);
    expect(lerpColor(a, b, 0)).toBe(a);
    expect(lerpColor(a, b, 1)).toBe(b);
  });
});

describe('AnimationState', () => {
  it('advances time and loops within duration', () => {
    const st = new AnimationState();
    st.setAnimation(rotAnim('root', [kf(0, 0), kf(1, 360)]), { loop: true });
    st.update(0.75);
    expect(st.time).toBeCloseTo(0.75, 6);
    st.update(0.5);
    expect(st.time).toBeCloseTo(0.25, 6); // Wrapped.
  });

  it('clamps at duration when not looping and fires the queued next', () => {
    const st = new AnimationState();
    const first = rotAnim('root', [kf(0, 0), kf(1, 10)], { loop: false });
    const second = rotAnim('root', [kf(0, 100)], { name: 'second', loop: true });
    st.setAnimation(first, { loop: false });
    st.addAnimation(second, { fadeDuration: 0 });
    st.update(1.5);
    expect(st.currentAnimationName).toBe('second');
    expect(st.time).toBeCloseTo(0.5, 6);
  });

  it('scrub positions without advancing and without events', () => {
    const st = new AnimationState();
    st.setAnimation(rotAnim('root', [kf(0, 0), kf(1, 5)]));
    st.scrub(0.4);
    expect(st.time).toBeCloseTo(0.4, 6);
    st.scrub(99); // Clamped to duration.
    expect(st.time).toBeCloseTo(1, 6);
  });

  it('applies interpolated values onto the pose', () => {
    const sk = oneBoneSkeleton();
    const st = new AnimationState();
    st.setAnimation(rotAnim('root', [kf(0, 0), kf(1, Math.PI)]));
    st.scrub(0.5);
    st.apply(sk);
    expect(sk.pose.bones[0]!.local.rotation).toBeCloseTo(Math.PI / 2, 5);
  });

  it('keeps the setup value before the first keyframe', () => {
    const sk = oneBoneSkeleton();
    sk.pose.bones[0]!.local.rotation = 0; // Setup is 0.
    const st = new AnimationState();
    st.setAnimation(rotAnim('root', [kf(0.5, 1), kf(1, 2)]));
    st.scrub(0.25);
    st.apply(sk);
    expect(sk.pose.bones[0]!.local.rotation).toBe(0);
  });

  it('crossfades between two animations by weight', () => {
    const sk = oneBoneSkeleton();
    const st = new AnimationState();
    const from = rotAnim('root', [kf(0, 0)], { name: 'from' });
    const to = rotAnim('root', [kf(0, Math.PI)], { name: 'to' });
    st.setAnimation(from);
    st.setAnimation(to, { fadeDuration: 1 });
    st.update(0.5); // Halfway through the fade.
    st.apply(sk);
    expect(sk.pose.bones[0]!.local.rotation).toBeCloseTo(Math.PI / 2, 3);
  });

  it('fires events on crossing keyframe times, including across a loop seam', () => {
    const sk = oneBoneSkeleton();
    const st = new AnimationState();
    const anim: Animation = {
      name: 'ev',
      duration: 1,
      loop: true,
      timelines: [
        {
          kind: 'event',
          keyframes: [
            { time: 0.2, curve: { type: 'stepped' }, eventName: 'a' },
            { time: 0.8, curve: { type: 'stepped' }, eventName: 'b' },
          ],
        },
      ],
    };
    st.setAnimation(anim);
    st.update(0.3);
    let events = st.apply(sk);
    expect(events.map((e) => e.eventName)).toEqual(['a']);

    // 0.3 → 1.0 wraps to 0.1: crosses b (after 0.3) and nothing after wrap.
    st.update(0.8);
    events = st.apply(sk);
    expect(events.map((e) => e.eventName)).toEqual(['b']);
  });
});
