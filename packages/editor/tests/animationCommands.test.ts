import { describe, expect, it } from 'vitest';
import type { Timeline } from '@limber/core';
import { EditorEngine } from '../src/engine/EditorEngine';
import {
  AddAnimationCommand,
  AutoKeyMoveBoneCommand,
  DeleteKeyframeCommand,
  KeyBoneTransformCommand,
  MoveKeyframeCommand,
  DeleteEventKeyframeCommand,
  KeyEventCommand,
  SetAnimationMetaCommand,
  SetKeyframeCommand,
  SetKeyframeCurveCommand,
  upsertKeyframe,
} from '../src/commands/animationCommands';

function bootWithAnimation() {
  const engine = new EditorEngine();
  const cmd = new AddAnimationCommand(engine);
  cmd.do();
  engine.setAnimation(cmd.name);
  engine.mode = 'animate';
  const boneId = engine.skeleton.data.bones[0]!.id;
  return { engine, animName: cmd.name, boneId };
}

function timelineOf(engine: EditorEngine, boneId: string, property: 'x' | 'y') {
  const anim = engine.currentAnimation!;
  return anim.timelines.find(
    (tl): tl is Extract<Timeline, { kind: 'boneProperty' }> =>
      tl.kind === 'boneProperty' && tl.boneId === boneId && tl.property === property,
  );
}

describe('upsertKeyframe', () => {
  it('inserts sorted and replaces same-time keys', () => {
    const { engine, boneId } = bootWithAnimation();
    const anim = engine.currentAnimation!;
    upsertKeyframe(anim, boneId, 'x', 0.5, 10);
    upsertKeyframe(anim, boneId, 'x', 0.1, 2);
    upsertKeyframe(anim, boneId, 'x', 0.9, 20);
    let tl = timelineOf(engine, boneId, 'x')!;
    expect(tl.keyframes.map((k) => k.time)).toEqual([0.1, 0.5, 0.9]);
    upsertKeyframe(anim, boneId, 'x', 0.5, 99); // Replace, not duplicate.
    tl = timelineOf(engine, boneId, 'x')!;
    expect(tl.keyframes).toHaveLength(3);
    expect(tl.keyframes[1]!.value).toBe(99);
  });
});

describe('AddAnimationCommand / RemoveAnimationCommand', () => {
  it('creates unique names and cleans up the active selection', () => {
    const engine = new EditorEngine();
    const a = new AddAnimationCommand(engine);
    const b = new AddAnimationCommand(engine);
    a.do();
    b.do();
    expect(engine.document.animations.map((x) => x.name)).toEqual([a.name, b.name]);
    expect(b.name).not.toBe(a.name);
    engine.setAnimation(b.name);
    b.undo();
    expect(engine.activeAnimationName).toBeNull();
    b.do();
    expect(engine.document.animations).toHaveLength(2);
  });
});

describe('SetKeyframeCommand', () => {
  it('keys a property at the playhead and reverts atomically', () => {
    const { engine, boneId } = bootWithAnimation();
    engine.scrub(0.4);
    const cmd = new SetKeyframeCommand(engine, boneId, 'rotation', 0.4, 1.25);
    cmd.do();
    const tl = engine.currentAnimation!.timelines.find(
      (t): t is Extract<Timeline, { kind: 'boneProperty' }> =>
        t.kind === 'boneProperty' && t.property === 'rotation',
    )!;
    expect(tl.keyframes).toHaveLength(1);
    expect(tl.keyframes[0]!.value).toBeCloseTo(1.25, 6);
    cmd.undo();
    expect(
      engine.currentAnimation!.timelines.find((t) => t.kind === 'boneProperty' && t.property === 'rotation'),
    ).toBeUndefined();
  });
});

describe('AutoKeyMoveBoneCommand', () => {
  it('one drag = x+y keys; undo reverts both', () => {
    const { engine, boneId } = bootWithAnimation();
    engine.scrub(0.2);
    const cmd = new AutoKeyMoveBoneCommand(engine, boneId);
    cmd.open();
    cmd.update(3, 4);
    cmd.commit();
    expect(cmd.changed).toBe(true);

    let tx = timelineOf(engine, boneId, 'x')!;
    let ty = timelineOf(engine, boneId, 'y')!;
    expect(tx.keyframes[0]!.value).toBe(3);
    expect(ty.keyframes[0]!.value).toBe(4);

    cmd.undo();
    expect(timelineOf(engine, boneId, 'x')).toBeUndefined();
    expect(timelineOf(engine, boneId, 'y')).toBeUndefined();

    cmd.do();
    tx = timelineOf(engine, boneId, 'x')!;
    ty = timelineOf(engine, boneId, 'y')!;
    expect(tx.keyframes[0]!.value).toBe(3);
    expect(ty.keyframes[0]!.value).toBe(4);
  });

  it('reports unchanged when the drag never keyed anything new', () => {
    const { engine, boneId } = bootWithAnimation();
    engine.scrub(0.5);
    const cmd = new AutoKeyMoveBoneCommand(engine, boneId);
    cmd.open();
    cmd.commit();
    expect(cmd.changed).toBe(false);
  });
});

describe('MoveKeyframeCommand / DeleteKeyframeCommand', () => {
  it('moves a key in time (clamped, sorted) and restores on undo', () => {
    const { engine, boneId } = bootWithAnimation();
    upsertKeyframe(engine.currentAnimation!, boneId, 'x', 0.2, 1);
    upsertKeyframe(engine.currentAnimation!, boneId, 'x', 0.6, 2);
    const cmd = new MoveKeyframeCommand(engine, boneId, 'x', 0.2, 0.4);
    cmd.do();
    let tl = timelineOf(engine, boneId, 'x')!;
    expect(tl.keyframes.map((k) => k.time)).toEqual([0.4, 0.6]);
    cmd.undo();
    tl = timelineOf(engine, boneId, 'x')!;
    expect(tl.keyframes.map((k) => k.time)).toEqual([0.2, 0.6]);
  });

  it('deletes exactly one key', () => {
    const { engine, boneId } = bootWithAnimation();
    upsertKeyframe(engine.currentAnimation!, boneId, 'x', 0.2, 1);
    upsertKeyframe(engine.currentAnimation!, boneId, 'x', 0.6, 2);
    const cmd = new DeleteKeyframeCommand(engine, boneId, 'x', 0.2);
    cmd.do();
    expect(timelineOf(engine, boneId, 'x')!.keyframes).toHaveLength(1);
    cmd.undo();
    expect(timelineOf(engine, boneId, 'x')!.keyframes).toHaveLength(2);
  });
});

describe('KeyBoneTransformCommand', () => {
  it('keys all seven transform properties of the current pose', () => {
    const { engine, boneId } = bootWithAnimation();
    engine.scrub(0.3);
    const cmd = new KeyBoneTransformCommand(engine, boneId);
    cmd.do();
    const anim = engine.currentAnimation!;
    const props = anim.timelines
      .filter((tl): tl is Extract<Timeline, { kind: 'boneProperty' }> => tl.kind === 'boneProperty' && tl.boneId === boneId)
      .map((tl) => tl.property);
    expect(props.sort()).toEqual(['rotation', 'scaleX', 'scaleY', 'shearX', 'shearY', 'x', 'y']);
    cmd.undo();
    expect(anim.timelines).toHaveLength(0);
  });
});

describe('SetAnimationMetaCommand', () => {
  it('renames, retunes loop/duration, and keeps engine selection in sync', () => {
    const { engine, animName } = bootWithAnimation();
    const cmd = new SetAnimationMetaCommand(engine, animName, { newName: 'walk', loop: false, duration: 2.5 });
    cmd.do();
    const anim = engine.document.animations[0]!;
    expect(anim.name).toBe('walk');
    expect(anim.loop).toBe(false);
    expect(anim.duration).toBeCloseTo(2.5, 6);
    expect(engine.activeAnimationName).toBe('walk');
    cmd.undo();
    expect(engine.document.animations[0]!.name).toBe(animName);
    expect(engine.activeAnimationName).toBe(animName);
  });
});

describe('EditorEngine animation pipeline', () => {
  it('tick in animate mode drives the pose from the mixer; setup mode ignores it', () => {
    const { engine, boneId } = bootWithAnimation();
    upsertKeyframe(engine.currentAnimation!, boneId, 'rotation', 0, 0);
    upsertKeyframe(engine.currentAnimation!, boneId, 'rotation', 1, Math.PI);
    engine.scrub(0.5);
    engine.tick(16);
    expect(engine.skeleton.pose.bones[0]!.local.rotation).toBeCloseTo(Math.PI / 2, 4);

    engine.mode = 'setup';
    engine.tick(16);
    expect(engine.skeleton.pose.bones[0]!.local.rotation).toBe(0); // Reset to setup.
  });

  it('playing advances the clock through tick (delta capped at 100ms)', () => {
    const { engine } = bootWithAnimation();
    engine.play();
    for (let i = 0; i < 5; i++) engine.tick(100); // 0.5s total.
    expect(engine.currentTime).toBeCloseTo(0.5, 4);
    for (let i = 0; i < 20; i++) engine.tick(100); // Loops within duration 1.5.
    expect(engine.currentTime).toBeLessThan(1.5);
  });
});

describe('events & curves (Phase 7)', () => {
  it('KeyEventCommand keys at the playhead, replaces same name+time, undo removes', () => {
    const { engine } = bootWithAnimation();
    engine.scrub(0.5);
    const cmd = new KeyEventCommand(engine, 'footstep', 2);
    cmd.do();
    const tl = engine.currentAnimation!.timelines[0]!;
    expect(tl.kind).toBe('event');
    expect(tl.keyframes[0]).toMatchObject({ time: 0.5, eventName: 'footstep', payload: 2 });
    new KeyEventCommand(engine, 'footstep', 9).do(); // Same time+name → replace.
    expect((tl as { keyframes: unknown[] }).keyframes).toHaveLength(1);
    cmd.undo(); // Reverts to the ORIGINAL (no timeline at all).
    expect(engine.currentAnimation!.timelines).toHaveLength(0);
  });

  it('DeleteEventKeyframeCommand removes one (time, name) pair', () => {
    const { engine } = bootWithAnimation();
    new KeyEventCommand(engine, 'a').do();
    engine.scrub(0.4);
    new KeyEventCommand(engine, 'b').do();
    const del = new DeleteEventKeyframeCommand(engine, 0.4, 'b');
    del.do();
    const tl = engine.currentAnimation!.timelines[0] as { keyframes: { eventName: string }[] };
    expect(tl.keyframes.map((k) => k.eventName)).toEqual(['a']);
    del.undo();
    expect(tl.keyframes.map((k) => k.eventName)).toEqual(['a', 'b']);
  });

  it('SetKeyframeCurveCommand rewrites the selected keyframe curve (undoable)', () => {
    const { engine, boneId } = bootWithAnimation();
    upsertKeyframe(engine.currentAnimation!, boneId, 'x', 0, 0);
    upsertKeyframe(engine.currentAnimation!, boneId, 'x', 1, 10);
    const cmd = new SetKeyframeCurveCommand(
      engine,
      { kind: 'bone', boneId, property: 'x', time: 0 },
      { type: 'bezier', c1: 0.42, c2: 0, c3: 0.58, c4: 1 },
    );
    cmd.do();
    const tl = timelineOf(engine, boneId, 'x')!;
    expect(tl.keyframes[0]!.curve).toEqual({ type: 'bezier', c1: 0.42, c2: 0, c3: 0.58, c4: 1 });
    cmd.undo();
    expect(tl.keyframes[0]!.curve.type).toBe('linear');
  });
});
