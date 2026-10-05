import { describe, expect, it } from 'vitest';
import { EditorEngine } from '../src/engine/EditorEngine';
import { HistoryManager, type Command } from '../src/history/history';
import {
  AddBoneCommand,
  MoveBoneCommand,
  RemoveBoneCommand,
  ReparentBoneCommand,
  SetBonePropsCommand,
  isAncestor,
  wouldCreateCycle,
} from '../src/commands/boneCommands';

function setup(engine: EditorEngine, id: string, parentId: string | null, pose: Partial<{x:number;y:number;rotation:number}>) {
  const data = engine.skeleton.data;
  data.bones.push({
    id, name: id, parentId, length: 40,
    setupPose: { x: pose.x ?? 0, y: pose.y ?? 0, rotation: pose.rotation ?? 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 },
  });
  engine.skeleton.rebuild();
}

describe('AddBoneCommand', () => {
  it('adds, rebuilds, and generates unique names', () => {
    const engine = new EditorEngine();
    const a = new AddBoneCommand(engine, null, { x: 1, y: 2 });
    const b = new AddBoneCommand(engine, a.boneId, { x: 0, y: 0 });
    a.do(); b.do();
    const bones = engine.skeleton.data.bones;
    expect(bones).toHaveLength(3); // default root + 2
    expect(bones.find((x) => x.id === a.boneId)!.name).toBe('bone');
    expect(bones.find((x) => x.id === b.boneId)!.name).toBe('bone2');
    expect(bones.find((x) => x.id === b.boneId)!.parentId).toBe(a.boneId);
    // Topologically valid after the structural change.
    expect(() => engine.skeleton.rebuild()).not.toThrow();
    b.undo(); a.undo();
    expect(engine.skeleton.data.bones).toHaveLength(1);
  });
});

describe('MoveBoneCommand (continuous)', () => {
  it('open → update → commit records one before/after pair', () => {
    const engine = new EditorEngine();
    const rootId = engine.skeleton.data.bones[0]!.id;
    const cmd = new MoveBoneCommand(engine, rootId);
    cmd.open();
    expect(cmd.changed).toBe(false); // No movement yet.
    cmd.update(7, -3);
    cmd.commit();
    expect(cmd.changed).toBe(true);
    expect(engine.skeleton.data.bones[0]!.setupPose.x).toBe(7);
    cmd.undo();
    expect(engine.skeleton.data.bones[0]!.setupPose.x).toBe(0);
    cmd.do();
    expect(engine.skeleton.data.bones[0]!.setupPose.x).toBe(7);
  });

  it('reports unchanged when the drag never moved', () => {
    const engine = new EditorEngine();
    const rootId = engine.skeleton.data.bones[0]!.id;
    const cmd = new MoveBoneCommand(engine, rootId);
    cmd.open();
    cmd.update(0, 0);
    cmd.commit();
    expect(cmd.changed).toBe(false);
  });
});

describe('ReparentBoneCommand (world-preserving)', () => {
  it('re-expresses the setup pose so the world transform is unchanged', () => {
    const engine = new EditorEngine();
    const rootId = engine.skeleton.data.bones[0]!.id;
    const a = new AddBoneCommand(engine, null, { x: 100, y: 0 });
    const b = new AddBoneCommand(engine, null, { x: 0, y: 0 });
    a.do(); b.do();

    const before = worldOf(engine, b.boneId);
    new ReparentBoneCommand(engine, b.boneId, a.boneId).do();

    const boneB = engine.skeleton.data.bones.find((x) => x.id === b.boneId)!;
    expect(boneB.parentId).toBe(a.boneId);
    expect(boneB.setupPose.x).toBeCloseTo(-100, 5);
    expect(boneB.setupPose.y).toBeCloseTo(0, 5);
    expect(worldOf(engine, b.boneId).tx).toBeCloseTo(before.tx, 5);
    expect(worldOf(engine, b.boneId).ty).toBeCloseTo(before.ty, 5);
  });

  it('undo restores the original parent and setup pose', () => {
    const engine = new EditorEngine();
    const a = new AddBoneCommand(engine, null, { x: 100, y: 0 });
    const b = new AddBoneCommand(engine, null, { x: 0, y: 0 });
    a.do(); b.do();
    const cmd = new ReparentBoneCommand(engine, b.boneId, a.boneId);
    cmd.do();
    cmd.undo();
    const boneB = engine.skeleton.data.bones.find((x) => x.id === b.boneId)!;
    expect(boneB.parentId).toBeNull();
    expect(boneB.setupPose.x).toBeCloseTo(0, 5);
    expect(boneB.setupPose.y).toBeCloseTo(0, 5);
  });
});

describe('RemoveBoneCommand', () => {
  it('flattens children to the removed bone\'s parent, preserving world transforms', () => {
    const engine = new EditorEngine();
    const rootId = engine.skeleton.data.bones[0]!.id;
    // root at (10,0) rotated 90°; child at local (5,0) ⇒ child world (10,5) rotated 90°.
    const root = engine.skeleton.data.bones[0]!;
    root.setupPose.x = 10;
    root.setupPose.rotation = Math.PI / 2;
    setup(engine, 'child', rootId, { x: 5, y: 0 });

    const cmd = new RemoveBoneCommand(engine, rootId);
    cmd.do();

    const bones = engine.skeleton.data.bones;
    expect(bones).toHaveLength(1);
    const child = bones.find((x) => x.name === 'child')!;
    expect(child.parentId).toBeNull();
    expect(child.setupPose.x).toBeCloseTo(10, 5);
    expect(child.setupPose.y).toBeCloseTo(5, 5);
    expect(child.setupPose.rotation).toBeCloseTo(Math.PI / 2, 5);

    cmd.undo();
    expect(engine.skeleton.data.bones).toHaveLength(2);
    const restoredChild = engine.skeleton.data.bones.find((x) => x.name === 'child')!;
    expect(restoredChild.parentId).toBe(rootId);
    expect(restoredChild.setupPose.x).toBe(5);
    expect(engine.skeleton.data.bones.find((x) => x.id === rootId)!.setupPose.rotation).toBeCloseTo(Math.PI / 2, 5);
  });
});

describe('SetBonePropsCommand', () => {
  it('applies and reverts a full snapshot', () => {
    const engine = new EditorEngine();
    const rootId = engine.skeleton.data.bones[0]!.id;
    const bone = engine.skeleton.data.bones[0]!;
    const before = { name: bone.name, length: bone.length, setup: { ...bone.setupPose } };
    const after = { name: 'torso', length: 120, setup: { ...bone.setupPose, rotation: Math.PI / 4, y: 3 } };
    const cmd = new SetBonePropsCommand(engine, rootId, before, after);
    cmd.do();
    expect(bone.name).toBe('torso');
    expect(bone.length).toBe(120);
    expect(bone.setupPose.rotation).toBeCloseTo(Math.PI / 4, 6);
    cmd.undo();
    expect(bone.name).toBe('root');
    expect(bone.setupPose.rotation).toBe(0);
  });
});

describe('cycle guards', () => {
  it('detects ancestors and invalid reparent targets', () => {
    const engine = new EditorEngine();
    const rootId = engine.skeleton.data.bones[0]!.id;
    setup(engine, 'mid', rootId, {});
    setup(engine, 'leaf', 'mid', {});
    const data = engine.skeleton.data;
    expect(isAncestor(data, rootId, 'leaf')).toBe(true);
    expect(isAncestor(data, 'leaf', rootId)).toBe(false);
    expect(wouldCreateCycle(data, 'mid', 'leaf')).toBe(true);
    expect(wouldCreateCycle(data, 'leaf', 'mid')).toBe(false);
    expect(wouldCreateCycle(data, 'mid', null)).toBe(false);
  });
});

describe('HistoryManager', () => {
  function counterCmd(label: string, log: string[], impl: { do(): void; undo(): void }): Command {
    return { label, do: impl.do, undo: impl.undo };
  }

  it('execute/undo/redo in order and reports availability', () => {
    const h = new HistoryManager();
    const log: string[] = [];
    const a = counterCmd('a', log, { do: () => log.push('do-a'), undo: () => log.push('undo-a') });
    const b = counterCmd('b', log, { do: () => log.push('do-b'), undo: () => log.push('undo-b') });

    h.execute(a);
    h.execute(b);
    expect(h.canUndo).toBe(true);
    expect(log).toEqual(['do-a', 'do-b']);

    h.undo();
    h.undo();
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(true);
    expect(log).toEqual(['do-a', 'do-b', 'undo-b', 'undo-a']);

    h.redo();
    expect(log).toEqual(['do-a', 'do-b', 'undo-b', 'undo-a', 'do-a']);
  });

  it('a new execute truncates the redo branch', () => {
    const h = new HistoryManager();
    const log: string[] = [];
    h.execute(counterCmd('a', log, { do: () => log.push('a'), undo: () => log.push('~a') }));
    h.undo();
    h.execute(counterCmd('c', log, { do: () => log.push('c'), undo: () => log.push('~c') }));
    expect(h.canRedo).toBe(false);
    expect(h.redo()).toBe(false);
  });

  it('clear resets both stacks', () => {
    const h = new HistoryManager();
    h.execute(counterCmd('x', [], { do: () => {}, undo: () => {} }));
    h.clear();
    expect(h.canUndo).toBe(false);
    expect(h.undo()).toBe(false);
  });
});

/** Helper: setup-pose world translation of a bone, via a fresh FK solve. */
function worldOf(engine: EditorEngine, boneId: string): { tx: number; ty: number } {
  const worlds = engine.solveSetupWorlds();
  const idx = engine.skeleton.boneIndexMap.get(boneId)!;
  return { tx: worlds[idx * 6 + 4]!, ty: worlds[idx * 6 + 5]! };
}
