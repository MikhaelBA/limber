import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  Skeleton,
  solveFK,
  projectFromLegacy,
  serializeProject,
  deserializeProject,
  SECONDARY_STEP_SECONDS,
  type SecondaryConstraintData,
  type Animation,
  type SkeletonData,
} from '../src/index';
import { RuntimePlayer } from '../../runtime/src/player';
import { makeBone, makeSkeletonData } from './helpers';
const spring = (patch: Partial<SecondaryConstraintData> = {}): SecondaryConstraintData => ({
  id: 'spring',
  boneId: 'bone',
  preset: 'soft',
  frequency: 1 / Math.PI,
  damping: 1,
  mix: 1,
  maxAngle: Math.PI,
  order: 0,
  ...patch,
});
function document() {
  const skeleton = makeSkeletonData([makeBone('bone', null)]);
  skeleton.secondaryConstraints = [spring()];
  const animations: Animation[] = [
    {
      name: 'step',
      duration: 1,
      loop: false,
      timelines: [
        {
          kind: 'boneProperty',
          boneId: 'bone',
          property: 'rotation',
          keyframes: [
            { time: 0, value: 0, curve: { type: 'stepped' } },
            { time: SECONDARY_STEP_SECONDS, value: 1, curve: { type: 'linear' } },
          ],
        },
      ],
    },
  ];
  return { skeleton, animations, assetManifest: {} };
}
const angle = (matrix: ArrayLike<number>, offset = 0) => Math.atan2(matrix[offset + 1]!, matrix[offset]!);
describe('sampled fixed-step secondary motion', () => {
  it('matches an independent critical spring step golden and independent world-angle mixing', () => {
    for (const mix of [0, 0.5, 1]) {
      const d = document();
      d.skeleton.secondaryConstraints![0]!.mix = mix;
      const p = new RuntimePlayer(d);
      p.setAnimation('step', { loop: false });
      p.update(0.1);
      const response = 1 - (1 + 0.2) * Math.exp(-0.2);
      expect(angle(p.getWorldTransforms())).toBeCloseTo(1 + (response - 1) * mix, 6);
      expect(p.time).toBe(0.1);
    }
  });
  it('samples animated inputs on fixed substeps with exact display-subdivision parity, including held subframe renders', () => {
    const d = document();
    d.animations[0]!.timelines = [
      {
        kind: 'boneProperty',
        boneId: 'bone',
        property: 'rotation',
        keyframes: [
          { time: 0, value: 0, curve: { type: 'linear' } },
          { time: 1, value: 1, curve: { type: 'linear' } },
        ],
      },
    ];
    let reference: Float32Array | undefined;
    for (const frames of [10, 60, 120, 144, 240, 1000]) {
      const p = new RuntimePlayer(structuredClone(d));
      p.setAnimation('step', { loop: false });
      for (let n = 0; n < frames; n++) p.update(1 / frames);
      if (!reference) reference = p.getWorldTransforms().slice();
      else expect(p.getWorldTransforms()).toEqual(reference);
      expect(p.time).toBe(1);
    }
  });
  it('aims an independently predicted world spring heading through 80 seeded signed/sheared hierarchies', () => {
    let seed = 782;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let n = 0; n < 80; n++) {
      const d = document();
      d.skeleton.bones.unshift(
        makeBone('parent', null, {
          rotation: random() * 5,
          scaleX: (random() < 0.5 ? -1 : 1) * (0.6 + random()),
          scaleY: 0.6 + random(),
          shearX: random() - 0.5,
          shearY: random() - 0.5,
        }),
      );
      d.skeleton.bones[1]!.parentId = 'parent';
      Object.assign(d.skeleton.bones[1]!.setupPose, {
        x: 10,
        y: 7,
        scaleX: (random() < 0.5 ? -1 : 1) * (0.6 + random()),
        scaleY: 1.3,
        shearX: 0.2,
        shearY: 0.3,
      });
      const s = new Skeleton(structuredClone(d.skeleton)),
        i = s.boneIndexMap.get('bone')! * 6;
      solveFK(s.data, s.boneIndexMap, s.pose);
      const a = angle(s.pose.worldMatrices, i),
        origin = Array.from(s.pose.worldMatrices.slice(i + 4, i + 6));
      s.pose.bones[s.boneIndexMap.get('bone')!]!.local.rotation = 1;
      solveFK(s.data, s.boneIndexMap, s.pose);
      const raw = angle(s.pose.worldMatrices, i),
        target = a + Math.atan2(Math.sin(raw - a), Math.cos(raw - a)),
        expected = target + (a - target) * (1 + 0.2) * Math.exp(-0.2);
      const p = new RuntimePlayer(d);
      p.setAnimation('step');
      p.update(0.1);
      expect(
        Math.abs(
          Math.atan2(
            Math.sin(angle(p.getWorldTransforms(), i) - expected),
            Math.cos(angle(p.getWorldTransforms(), i) - expected),
          ),
        ),
      ).toBeLessThan(0.00001);
      expect(Array.from(p.getWorldTransforms().slice(i + 4, i + 6))).toEqual(origin);
    }
  });
  it('samples parent/child goals before spring writes and enforces ancestor-before-descendant order', () => {
    const d = document();
    d.skeleton.bones.push(makeBone('child', 'bone', { x: 20 }));
    d.skeleton.secondaryConstraints!.push(spring({ id: 'child-spring', boneId: 'child', order: 1 }));
    d.animations[0]!.timelines.push({
      kind: 'boneProperty',
      boneId: 'child',
      property: 'rotation',
      keyframes: [
        { time: 0, value: 0, curve: { type: 'stepped' } },
        { time: SECONDARY_STEP_SECONDS, value: 1, curve: { type: 'linear' } },
      ],
    });
    const p = new RuntimePlayer(d);
    p.setAnimation('step');
    p.update(0.1);
    const response = 1 - (1 + 0.2) * Math.exp(-0.2);
    expect(angle(p.getWorldTransforms())).toBeCloseTo(response, 6);
    expect(angle(p.getWorldTransforms(), 6)).toBeCloseTo(2 * response, 6);
    d.skeleton.secondaryConstraints![0]!.order = 2;
    expect(() => new Skeleton(structuredClone(d.skeleton))).toThrow(/parent motion/);
  });
  it('clamps deflection and holds singular/collapsed sampled poses with finite recovery', () => {
    const d = document();
    d.skeleton.secondaryConstraints![0]!.maxAngle = 0.1;
    const p = new RuntimePlayer(d);
    p.setAnimation('step');
    p.update(0.1);
    expect(Math.abs(angle(p.getWorldTransforms()) - 1)).toBeLessThanOrEqual(0.100001);
    for (const mode of ['parent', 'bone']) {
      const bad = document();
      bad.skeleton.bones.unshift(makeBone('parent', null));
      bad.skeleton.bones[1]!.parentId = 'parent';
      const b = bad.skeleton.bones.find((b) => b.id === mode)!;
      b.setupPose.scaleY = 0;
      if (mode === 'bone') b.setupPose.scaleX = 0;
      const s = new Skeleton(bad.skeleton);
      solveFK(s.data, s.boneIndexMap, s.pose);
      s.secondaryMotion!.rebase(s);
      s.pose.bones[s.boneIndexMap.get('bone')!]!.local.rotation = 1;
      solveFK(s.data, s.boneIndexMap, s.pose);
      const before = structuredClone(s.pose.bones);
      s.secondaryMotion!.evaluate(s, true);
      expect(s.pose.bones).toEqual(before);
      expect(s.pose.worldMatrices.every(Number.isFinite)).toBe(true);
    }
  });
  it('reverts all secondary rotations and world output on Float32 overflow', () => {
    const d = document();
    d.skeleton.secondaryConstraints![0]!.maxAngle = Math.PI / 2;
    d.skeleton.bones.unshift(makeBone('parent', null, { scaleX: 1e38, scaleY: 1e30 }));
    const b = d.skeleton.bones[1]!;
    b.parentId = 'parent';
    b.setupPose = { x: 0, y: 0, rotation: Math.PI / 2, scaleX: 1000, scaleY: 0.001, shearX: 0, shearY: 0 };
    const s = new Skeleton(d.skeleton);
    solveFK(s.data, s.boneIndexMap, s.pose);
    s.secondaryMotion!.rebase(s);
    s.pose.bones[1]!.local.rotation = -Math.PI / 2;
    solveFK(s.data, s.boneIndexMap, s.pose);
    const rotations = structuredClone(s.pose.bones),
      wm = s.pose.worldMatrices.slice();
    s.secondaryMotion!.evaluate(s, true);
    expect(s.pose.bones).toEqual(rotations);
    expect(s.pose.worldMatrices).toEqual(wm);
    expect(s.secondaryMotion!.initialized).toBe(true);
    s.secondaryMotion!.evaluate(s, false);
    expect(s.pose.bones).toEqual(rotations);
    expect(s.pose.worldMatrices).toEqual(wm);
  });
  it('resets at clip switches/external teleports and keeps rejected clip selection atomic', () => {
    const d = document();
    d.animations.push({ name: 'idle', duration: 1, loop: false, timelines: [] });
    const p = new RuntimePlayer(structuredClone(d));
    p.setAnimation('step');
    p.update(0.1);
    p.setAnimation('idle');
    p.update(0);
    expect(angle(p.getWorldTransforms())).toBe(0);
    p.setAnimation('step');
    p.update(0.1);
    p.resetSecondaryMotion();
    p.update(0);
    expect(angle(p.getWorldTransforms())).toBeCloseTo(1, 6);
    const a = new RuntimePlayer(structuredClone(d)),
      b = new RuntimePlayer(structuredClone(d));
    for (const q of [a, b]) {
      q.setAnimation('step');
      q.update(0.1);
    }
    expect(() => a.setAnimation('missing')).toThrow();
    a.update(0.1);
    b.update(0.1);
    expect(a.getWorldTransforms()).toEqual(b.getWorldTransforms());
  });
  it('caps stalls and ignores invalid deltas without firing dropped-time events', () => {
    const d = document();
    d.animations[0]!.timelines.push({
      kind: 'event',
      keyframes: [
        { time: 0.05, eventName: 'early', curve: { type: 'stepped' } },
        { time: 0.2, eventName: 'late', curve: { type: 'stepped' } },
      ],
    });
    const p = new RuntimePlayer(d);
    p.setAnimation('step');
    p.update(10);
    expect(p.time).toBe(0.1);
    expect(p.events.map((e) => e.eventName)).toEqual(['early']);
    const before = p.getWorldTransforms().slice();
    for (const delta of [NaN, Infinity, -1, 0]) {
      p.update(delta);
      expect(p.time).toBe(0.1);
      expect(p.events).toEqual([]);
      expect(p.getWorldTransforms()).toEqual(before);
    }
  });
  it('preserves loop boundary events, suppresses frozen outgoing duplicates and resets queued clip inertia', () => {
    const d = document();
    d.animations[0]!.loop = true;
    d.animations[0]!.timelines.push({
      kind: 'event',
      keyframes: [
        { time: 1, eventName: 'end', curve: { type: 'stepped' } },
        { time: 0, eventName: 'start', curve: { type: 'stepped' } },
      ],
    });
    const p = new RuntimePlayer(d);
    p.setAnimation('step');
    const fired: string[] = [];
    p.onEvent((e) => fired.push(e.eventName));
    for (let n = 0; n < 10; n++) p.update(0.1);
    expect(p.time).toBeCloseTo(0, 12);
    expect(fired).toEqual(['end', 'start']);
    const cross = document();
    cross.animations[0]!.timelines.push({
      kind: 'event',
      keyframes: [{ time: 0.1, eventName: 'last-old', curve: { type: 'stepped' } }],
    });
    cross.animations.push({ name: 'idle', duration: 1, loop: false, timelines: [] });
    const q = new RuntimePlayer(cross),
      events: string[] = [];
    q.onEvent((e) => events.push(e.eventName));
    q.setAnimation('step');
    q.update(0.1);
    q.setAnimation('idle', { fadeDuration: 0.2 });
    q.update(0.1);
    q.update(0.1);
    expect(events).toEqual(['last-old']);
    q.setAnimation('step', { loop: false });
    q.addAnimation('idle');
    for (let n = 0; n < 10; n++) q.update(0.1);
    expect(q.time).toBe(0);
    expect(angle(q.getWorldTransforms())).toBe(0);
  });
  it('rejects invalid source strengths/coefficients/order/identities before publication and round trips native schema 9', () => {
    const mutations: ((d: SkeletonData) => void)[] = [
      (d) => {
        d.secondaryConstraints![0]!.mix = 2;
      },
      (d) => {
        d.secondaryConstraints![0]!.frequency = 0;
      },
      (d) => {
        d.secondaryConstraints![0]!.damping = 3;
      },
      (d) => {
        d.secondaryConstraints![0]!.maxAngle = 4;
      },
      (d) => {
        d.secondaryConstraints![0]!.boneId = 'missing';
      },
      (d) => {
        d.secondaryConstraints!.push(spring({ id: 'second', order: 1 }));
      },
      (d) => {
        d.ikConstraints.push({
          id: 'ik',
          bones: ['bone'],
          targetId: 'target',
          poleVectorId: null,
          bendDirection: 1,
          mix: 1,
          softness: 0,
          order: 1,
        });
        d.bones.push(makeBone('target', null, { x: 20 }));
      },
    ];
    for (const mutate of mutations) {
      const d = document();
      mutate(d.skeleton);
      expect(() => new Skeleton(d.skeleton)).toThrow();
    }
    const project = projectFromLegacy(document());
    expect(deserializeProject(serializeProject(project))).toEqual(project);
  });
  it('loads the actual editor-saved fixture and preserves source while replaying its parent/child motion', () => {
    const project = deserializeProject(readFileSync('fixtures/bbbproj-v9-secondary-motion.json', 'utf8'));
    const before = structuredClone(project);
    const rig = project.artboards[0]!.nodes[0]!;
    if (rig.type !== 'rig') throw new Error('Expected saved rig');
    expect(rig.skeleton.secondaryConstraints!.map((c) => c.boneId)).toEqual(['tail', 'tip']);
    expect(deserializeProject(serializeProject(project))).toEqual(project);
    const player = new RuntimePlayer({ skeleton: rig.skeleton, animations: rig.animations });
    player.setAnimation('Turn', { loop: false });
    for (let n = 0; n < 5; n++) player.update(0.1);
    const wm = player.getWorldTransforms();
    const body = Math.atan2(wm[1]!, wm[0]!);
    const tail = Math.atan2(wm[7]!, wm[6]!);
    expect(body).toBeCloseTo(0.5, 6);
    expect(tail).toBeLessThan(body);
    expect(wm.every(Number.isFinite)).toBe(true);
    player.resetSecondaryMotion();
    player.update(0);
    expect(Math.atan2(wm[7]!, wm[6]!)).toBeCloseTo(0.5, 6);
    expect(project).toEqual(before);
  });
});
