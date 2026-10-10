import { describe, expect, it } from 'vitest';
import { RuntimePlayer } from '../../runtime/src/player';
import { serializeProject, deserializeProject } from '@limber/core';
import { EditorEngine } from '../src/engine/EditorEngine';
import { HistoryManager } from '../src/history/history';
import {
  AddSecondaryMotionCommand,
  EditSecondaryMotionCommand,
  RemoveSecondaryMotionCommand,
} from '../src/commands/secondaryMotionCommands';
import { AddIKConstraintCommand, MoveConstraintCommand } from '../src/commands/ikCommands';
import { AddTransformConstraintCommand } from '../src/commands/transformConstraintCommands';
import { RemoveBoneCommand } from '../src/commands/boneCommands';
function rig() {
  const e = new EditorEngine(),
    data = e.skeleton.data;
  data.bones = ['body', 'tail', 'tip', 'other'].map((id, i) => ({
    id,
    name: id,
    parentId: i === 1 ? 'body' : i === 2 ? 'tail' : null,
    length: 30,
    setupPose: {
      x: i === 0 ? 100 : 30,
      y: i === 0 ? 100 : 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      shearX: 0,
      shearY: 0,
    },
  }));
  e.loadDocument({
    skeleton: data,
    animations: [
      {
        name: 'turn',
        duration: 1,
        loop: false,
        timelines: [
          {
            kind: 'boneProperty',
            boneId: 'body',
            property: 'rotation',
            keyframes: [
              { time: 0, value: 0, curve: { type: 'linear' } },
              { time: 1, value: 1, curve: { type: 'linear' } },
            ],
          },
        ],
      },
    ],
    assetManifest: {},
  });
  e.tick(0);
  return e;
}
describe('secondary motion authoring and editor clock', () => {
  it('creates/edits presets with exact native history and restores source across repeated undo/redo', () => {
    const e = rig(),
      h = new HistoryManager(),
      before = structuredClone(e.document),
      c = new AddSecondaryMotionCommand(e, 'tail');
    h.execute(e.bindCommand(c));
    const after = structuredClone(e.document);
    expect(e.skeleton.data.secondaryConstraints?.[0]).toMatchObject({
      id: c.constraintId,
      preset: 'soft',
      frequency: 2,
      damping: 0.7,
      mix: 1,
    });
    for (let n = 0; n < 3; n++) {
      h.undo();
      expect(e.document).toEqual(before);
      h.redo();
      expect(e.document).toEqual(after);
    }
    h.execute(new EditSecondaryMotionCommand(e, c.constraintId, { preset: 'firm', mix: 0.5 }));
    expect(e.skeleton.data.secondaryConstraints?.[0]).toMatchObject({
      preset: 'firm',
      frequency: 6,
      damping: 1,
      mix: 0.5,
    });
    expect(deserializeProject(serializeProject(e.project))).toEqual(e.project);
  });
  it('inserts parents before existing child springs and later primary constraints before all springs', () => {
    const e = rig(),
      h = new HistoryManager(),
      tip = new AddSecondaryMotionCommand(e, 'tip'),
      tail = new AddSecondaryMotionCommand(e, 'tail');
    h.execute(tip);
    h.execute(tail);
    expect(e.skeleton.data.secondaryConstraints?.map((c) => [c.boneId, c.order])).toEqual([
      ['tail', 0],
      ['tip', 1],
    ]);
    const before = structuredClone(e.document);
    expect(() => h.execute(new MoveConstraintCommand(e, tip.constraintId, -1))).toThrow(/parent motion/);
    expect(e.document).toEqual(before);
    h.execute(new AddIKConstraintCommand(e, 'other'));
    h.execute(new AddTransformConstraintCommand(e, 'tip', 'other'));
    expect(e.skeleton.constraintOrder.map((e) => [e.kind, e.data.order])).toEqual([
      ['ik', 0],
      ['transform', 1],
      ['secondary', 2],
      ['secondary', 3],
    ]);
    const ordered = structuredClone(e.document);
    expect(() => h.execute(new MoveConstraintCommand(e, tail.constraintId, -1))).toThrow(/after all primary/);
    expect(e.document).toEqual(ordered);
  });
  it('rejects bad coefficients/duplicate/mode edits atomically and cleans bone references on deletion', () => {
    const e = rig(),
      h = new HistoryManager(),
      c = new AddSecondaryMotionCommand(e, 'tail');
    h.execute(c);
    e.tick(0);
    const before = structuredClone(e.document),
      pose = structuredClone(e.skeleton.pose);
    for (const command of [
      new EditSecondaryMotionCommand(e, c.constraintId, { frequency: 0 }),
      new EditSecondaryMotionCommand(e, c.constraintId, { damping: 3 }),
      new EditSecondaryMotionCommand(e, c.constraintId, { mix: NaN }),
      new AddSecondaryMotionCommand(e, 'tail'),
    ]) {
      expect(() => h.execute(command)).toThrow();
      expect(e.document).toEqual(before);
      expect(e.skeleton.pose).toEqual(pose);
    }
    e.mode = 'animate';
    expect(() => h.execute(new RemoveSecondaryMotionCommand(e, c.constraintId))).toThrow(/Setup/);
    e.mode = 'setup';
    h.execute(new RemoveBoneCommand(e, 'tail'));
    expect(e.skeleton.data.secondaryConstraints).toEqual([]);
    h.undo();
    expect(e.document).toEqual(before);
    h.execute(new RemoveSecondaryMotionCommand(e, c.constraintId));
    expect(e.skeleton.secondaryMotion).toBe(null);
    h.undo();
    expect(e.document).toEqual(before);
  });
  it('matches editor/runtime fixed-step matrices for different frame subdivisions and resets on pause/scrub', () => {
    const base = rig();
    new AddSecondaryMotionCommand(base, 'tail').do();
    const doc = structuredClone(base.document),
      runtime = new RuntimePlayer(structuredClone(doc));
    runtime.setAnimation('turn', { loop: false });
    for (let n = 0; n < 10; n++) runtime.update(0.1);
    const expected = runtime.getWorldTransforms().slice();
    for (const frames of [10, 60, 120, 240]) {
      const e = rig();
      e.loadDocument(structuredClone(doc));
      e.mode = 'animate';
      e.setAnimation('turn');
      e.play();
      for (let n = 0; n < frames; n++) e.tick(1000 / frames);
      expect(e.skeleton.pose.worldMatrices).toEqual(expected);
      expect(e.currentTime).toBe(1);
      e.pause();
      e.tick(0);
      const i = e.skeleton.boneIndexMap.get('tail')! * 6;
      expect(
        Math.atan2(e.skeleton.pose.worldMatrices[i + 1]!, e.skeleton.pose.worldMatrices[i]!),
      ).toBeCloseTo(1, 6);
      e.scrub(0.5);
      e.tick(0);
      expect(
        Math.atan2(e.skeleton.pose.worldMatrices[i + 1]!, e.skeleton.pose.worldMatrices[i]!),
      ).toBeCloseTo(0.5, 6);
      expect(e.lastEvents).toEqual([]);
      e.stop();
      e.tick(0);
      expect(e.currentTime).toBe(0);
      expect(Math.atan2(e.skeleton.pose.worldMatrices[i + 1]!, e.skeleton.pose.worldMatrices[i]!)).toBe(0);
    }
  });
  it('caps time after playback speed and resets new publication without carrying old inertia', () => {
    const e = rig();
    new AddSecondaryMotionCommand(e, 'tail').do();
    e.mode = 'animate';
    e.setAnimation('turn');
    e.playbackSpeed = 0.25;
    e.play();
    e.tick(200);
    expect(e.currentTime).toBe(0.05);
    e.pause();
    e.tick(0);
    e.mode = 'setup';
    new EditSecondaryMotionCommand(e, e.skeleton.data.secondaryConstraints![0]!.id, {
      preset: 'bouncy',
    }).do();
    e.mode = 'animate';
    e.play();
    e.tick(0);
    const i = e.skeleton.boneIndexMap.get('tail')! * 6;
    expect(Math.atan2(e.skeleton.pose.worldMatrices[i + 1]!, e.skeleton.pose.worldMatrices[i]!)).toBeCloseTo(
      0.05,
      6,
    );
  });
});
