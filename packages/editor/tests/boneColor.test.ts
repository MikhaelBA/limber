import { describe, it, expect } from 'vitest';
import { Skeleton, serializeProject, deserializeProject, activeRigNode } from '@limber/core';
import { EditorEngine } from '../src/engine/EditorEngine';
import { SetBoneColorCommand } from '../src/commands/boneCommands';
import { HistoryManager } from '../src/history/history';

describe('bone guide colors', () => {
  it('persists color without changing transforms and restores absence through reset and history', () => {
    const engine = new EditorEngine(),
      history = new HistoryManager();
    const bone = engine.skeleton.data.bones[0]!;
    const original = structuredClone(engine.project);
    history.execute(new SetBoneColorCommand(engine, bone.id, 0x8a4eff));
    const colored = structuredClone(engine.project);
    expect(bone.setupPose).toEqual(activeRigNode(original)!.skeleton.bones[0]!.setupPose);
    expect(
      activeRigNode(deserializeProject(serializeProject(engine.project)))!.skeleton.bones[0]!.color,
    ).toBe(0x8a4eff);
    history.execute(new SetBoneColorCommand(engine, bone.id, undefined));
    expect(engine.project).toEqual(original);
    history.undo();
    expect(engine.project).toEqual(colored);
    history.undo();
    expect(engine.project).toEqual(original);
    history.redo();
    expect(engine.project).toEqual(colored);
  });
  it('rejects malformed RGB values in commands and loaded skeletons without mutation', () => {
    const engine = new EditorEngine(),
      bone = engine.skeleton.data.bones[0]!;
    const before = structuredClone(engine.project);
    for (const color of [-1, 0x1000000, 1.5, NaN, Infinity]) {
      expect(() => new SetBoneColorCommand(engine, bone.id, color)).toThrow(/RGB/);
      const data = structuredClone(engine.skeleton.data);
      data.bones[0]!.color = color;
      expect(() => new Skeleton(data)).toThrow(/RGB/);
    }
    expect(engine.project).toEqual(before);
  });
});
