import { describe, expect, it } from 'vitest';
import { EditorEngine } from '../src/engine/EditorEngine';
import { AddBoneCommand } from '../src/commands/boneCommands';
import {
  AddIKConstraintCommand,
  RemoveIKConstraintCommand,
  SetIKPropsCommand,
} from '../src/commands/ikCommands';

/** root(0,0) → upper(local 80,0, len 50) → lower(local 60,0, len 50). */
function rig() {
  const engine = new EditorEngine();
  const rootId = engine.skeleton.data.bones[0]!.id;
  const upper = new AddBoneCommand(engine, rootId, { x: 80, y: 0 });
  upper.do();
  const lower = new AddBoneCommand(engine, upper.boneId, { x: 60, y: 0 });
  lower.do();
  return { engine, rootId, upperId: upper.boneId, lowerId: lower.boneId };
}

const worldTipOf = (engine: EditorEngine, boneId: string): [number, number] => {
  const idx = engine.skeleton.boneIndexMap.get(boneId)!;
  const o = idx * 6;
  const wm = engine.skeleton.pose.worldMatrices;
  const len = engine.skeleton.data.bones[idx]!.length;
  return [wm[o]! * len + wm[o + 4]!, wm[o + 1]! * len + wm[o + 5]!];
};

describe('AddIKConstraintCommand', () => {
  it('creates a 2-bone chain + target at the tip; the chain reaches it after tick', () => {
    const { engine, upperId, lowerId } = rig();
    const bonesBefore = engine.skeleton.data.bones.length;
    const cmd = new AddIKConstraintCommand(engine, lowerId);
    cmd.do();

    const ik = engine.skeleton.data.ikConstraints;
    expect(ik).toHaveLength(1);
    expect(ik[0]!.bones).toEqual([upperId, lowerId]);
    expect(ik[0]!.targetId).toBe(cmd.targetBoneId);
    expect(ik[0]!.mix).toBe(1);
    expect(engine.skeleton.data.bones).toHaveLength(bonesBefore + 1);
    const target = engine.skeleton.data.bones.find((b) => b.id === cmd.targetBoneId)!;
    expect(target.parentId).toBe(engine.skeleton.data.bones.find((b) => b.id === upperId)!.parentId);
    // Target at the chain tip's SETUP world position: lower world origin
    // (80+60, 0) + length 50 → (190, 0) — a straight, fully-extended chain.
    expect(target.setupPose.x).toBeCloseTo(190, 6);
    expect(target.setupPose.y).toBeCloseTo(0, 6);

    // Engine pipeline: FK → IK → skinning — the lower bone's tip reaches the target.
    engine.tick(0);
    let [tipX, tipY] = worldTipOf(engine, lowerId);
    expect(tipX).toBeCloseTo(190, 3);
    expect(tipY).toBeCloseTo(0, 3);

    // Move the target (non-trivial bend): the tip must follow through the solver.
    target.setupPose.x = 120;
    target.setupPose.y = 40;
    engine.skeleton.rebuild();
    engine.tick(0);
    [tipX, tipY] = worldTipOf(engine, lowerId);
    expect(tipX).toBeCloseTo(120, 3);
    expect(tipY).toBeCloseTo(40, 3);

    cmd.undo();
    expect(engine.skeleton.data.ikConstraints).toHaveLength(0);
    expect(engine.skeleton.data.bones).toHaveLength(bonesBefore);
    cmd.do();
    expect(engine.skeleton.data.ikConstraints).toHaveLength(1);
  });

  it('a root bone gets a 1-bone chain', () => {
    const engine = new EditorEngine();
    const rootId = engine.skeleton.data.bones[0]!.id;
    const cmd = new AddIKConstraintCommand(engine, rootId);
    cmd.do();
    expect(engine.skeleton.data.ikConstraints[0]!.bones).toEqual([rootId]);
  });

  it('uniquifies target names across repeated adds', () => {
    const { engine, lowerId } = rig();
    const a = new AddIKConstraintCommand(engine, lowerId);
    a.do();
    const b = new AddIKConstraintCommand(engine, lowerId);
    b.do();
    const names = engine.skeleton.data.bones.filter((x) => x.id === a.targetBoneId || x.id === b.targetBoneId).map((x) => x.name);
    expect(new Set(names).size).toBe(2);
  });
});

describe('SetIKPropsCommand / RemoveIKConstraintCommand', () => {
  it('edits mix/bend/target with undo; remove keeps the target bone', () => {
    const { engine, rootId, lowerId } = rig();
    const add = new AddIKConstraintCommand(engine, lowerId);
    add.do();
    const ikId = add.constraintId;

    const mix = new SetIKPropsCommand(engine, ikId, { mix: 0.25 });
    mix.do();
    expect(engine.skeleton.data.ikConstraints[0]!.mix).toBe(0.25);
    mix.undo();
    expect(engine.skeleton.data.ikConstraints[0]!.mix).toBe(1);

    const bend = new SetIKPropsCommand(engine, ikId, { bendDirection: -1 });
    bend.do();
    expect(engine.skeleton.data.ikConstraints[0]!.bendDirection).toBe(-1);
    bend.undo();
    expect(engine.skeleton.data.ikConstraints[0]!.bendDirection).toBe(1);

    const target = new SetIKPropsCommand(engine, ikId, { targetId: rootId });
    target.do();
    expect(engine.skeleton.data.ikConstraints[0]!.targetId).toBe(rootId);
    target.undo();
    expect(engine.skeleton.data.ikConstraints[0]!.targetId).toBe(add.targetBoneId);

    const bonesWithTarget = engine.skeleton.data.bones.length;
    const rm = new RemoveIKConstraintCommand(engine, ikId);
    rm.do();
    expect(engine.skeleton.data.ikConstraints).toHaveLength(0);
    expect(engine.skeleton.data.bones).toHaveLength(bonesWithTarget); // target stays
    rm.undo();
    expect(engine.skeleton.data.ikConstraints).toHaveLength(1);
  });
});
