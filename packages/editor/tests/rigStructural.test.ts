import { describe, expect, it } from 'vitest';
import { type BoneData, type Transform, serializeProject, deserializeProject } from '@limber/core';
import { EditorEngine } from '../src/engine/EditorEngine';
import { HistoryManager } from '../src/history/history';
import { AddBoneCommand, RemoveBoneCommand, ReparentBoneCommand } from '../src/commands/boneCommands';
import { AddAnimationCommand, SetAnimationMetaCommand } from '../src/commands/animationCommands';
import { AddSlotCommand } from '../src/commands/slotCommands';

function bone(id: string, parentId: string | null, pose: Partial<Transform> = {}): BoneData {
  return {
    id,
    name: id,
    parentId,
    length: 30,
    setupPose: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0, ...pose },
  };
}
function world(engine: EditorEngine, id: string): number[] {
  const offset = engine.skeleton.boneIndexMap.get(id)! * 6;
  return Array.from(engine.solveSetupWorlds().slice(offset, offset + 6));
}
function weighted(engine: EditorEngine, boneId: string): void {
  engine.skeleton.data.attachments.push({
    id: 'weighted',
    name: 'weighted',
    type: 'region',
    textureId: '',
    vertices: [0, 0, 1, 0, 1, 1, 0, 1],
    uvs: [0, 0, 1, 0, 1, 1, 0, 1],
    weights: Array.from({ length: 4 }, () => [1, engine.skeleton.boneIndexMap.get(boneId)!, 1]).flat(),
  });
  engine.skeleton.rebuild();
}

describe('transactional bone structure', () => {
  it('preserves all affine columns under reflected/sheared parents and restores weight indices and order', () => {
    const engine = new EditorEngine();
    const data = engine.skeleton.data;
    data.bones = [
      bone('a', null, {
        x: 33,
        y: -21,
        rotation: 0.61,
        scaleX: -1.3,
        scaleY: 0.72,
        shearX: 0.28,
        shearY: -0.17,
      }),
      bone('child', 'a', {
        x: 19,
        y: 8,
        rotation: -0.73,
        scaleX: 0.8,
        scaleY: -1.6,
        shearX: -0.21,
        shearY: 0.14,
      }),
      bone('b', null, {
        x: -14,
        y: 17,
        rotation: -0.29,
        scaleX: 2.1,
        scaleY: -0.9,
        shearX: -0.31,
        shearY: 0.23,
      }),
    ];
    engine.skeleton.rebuild();
    weighted(engine, 'child');
    const matrix = world(engine, 'child');
    const before = structuredClone(engine.document);
    const history = new HistoryManager();
    history.execute(new ReparentBoneCommand(engine, 'child', 'b'));
    world(engine, 'child').forEach((value, index) => expect(value).toBeCloseTo(matrix[index]!, 4));
    expect(data.attachments[0]!.weights![1]).toBe(engine.skeleton.boneIndexMap.get('child'));
    const after = structuredClone(engine.document);
    history.undo();
    expect(engine.document).toEqual(before);
    history.redo();
    expect(engine.document).toEqual(after);
    history.undo();
    const childWorld = world(engine, 'child');
    history.execute(new RemoveBoneCommand(engine, 'a'));
    world(engine, 'child').forEach((value, index) => expect(value).toBeCloseTo(childWorld[index]!, 4));
    expect(data.attachments[0]!.weights![1]).toBe(engine.skeleton.boneIndexMap.get('child'));
    history.undo();
    expect(engine.document).toEqual(before);
  });

  it('removes root slot/skin/clip/animation/IK references and restores exact source through repeated undo', () => {
    const engine = new EditorEngine();
    const data = engine.skeleton.data;
    data.bones = [bone('root', null), bone('child', 'root', { x: 20 }), bone('other', null)];
    engine.skeleton.rebuild();
    const ids = ['other', 'root', 'child', 'root'].map((id) => {
      const add = new AddSlotCommand(engine, id);
      add.do();
      return add.slotId;
    });
    data.attachments.push({
      id: 'clip',
      name: 'clip',
      type: 'clipping',
      textureId: '',
      meshVertices: [0, 0, 4, 0, 4, 4],
      endSlotId: ids[1]!,
    });
    data.skins.push({ name: 'inactive', attachments: { [ids[1]!]: 'clip', [ids[2]!]: 'clip' } });
    data.ikConstraints.push({
      id: 'ik',
      bones: ['root', 'child'],
      targetId: 'other',
      poleVectorId: null,
      bendDirection: 1,
      mix: 1,
      softness: 0,
      order: 0,
    });
    new AddAnimationCommand(engine).do();
    const anim = engine.document.animations[0]!;
    anim.timelines = [
      {
        kind: 'boneProperty',
        boneId: 'root',
        property: 'x',
        keyframes: [{ time: 0, value: 4, curve: { type: 'linear' } }],
      },
      { kind: 'slotColor', slotId: ids[1]!, keyframes: [] },
      {
        kind: 'slotAttachment',
        slotId: ids[3]!,
        keyframes: [{ time: 0, attachmentId: 'clip', curve: { type: 'stepped' } }],
      },
      { kind: 'drawOrder', keyframes: [{ time: 0, slotOrder: [3, 2, 1, 0], curve: { type: 'stepped' } }] },
    ];
    engine.skeleton.rebuild();
    const before = structuredClone(engine.document);
    const history = new HistoryManager();
    history.execute(new RemoveBoneCommand(engine, 'root'));
    expect(data.slots.map((slot) => slot.id)).toEqual([ids[0], ids[2]]);
    expect(data.skins[0]!.attachments).toEqual({ [ids[2]!]: 'clip' });
    expect(data.attachments[0]!.endSlotId).toBe(ids[2]);
    expect(data.ikConstraints).toEqual([]);
    expect(anim.timelines).toEqual([
      { kind: 'drawOrder', keyframes: [{ time: 0, slotOrder: [1, 0], curve: { type: 'stepped' } }] },
    ]);
    expect(deserializeProject(serializeProject(engine.project))).toEqual(engine.project);
    const after = structuredClone(engine.document);
    for (let repeat = 0; repeat < 3; repeat++) {
      history.undo();
      expect(engine.document).toEqual(before);
      history.redo();
      expect(engine.document).toEqual(after);
    }
  });

  it('rejects weighted deletion, cycles, unknown parents, singular transforms and broken IK atomically', () => {
    const engine = new EditorEngine();
    const data = engine.skeleton.data;
    data.bones = [
      bone('root', null),
      bone('child', 'root'),
      bone('target', null),
      bone('zero', null, { scaleX: 0 }),
    ];
    engine.skeleton.rebuild();
    weighted(engine, 'child');
    data.ikConstraints.push({
      id: 'ik',
      bones: ['root', 'child'],
      targetId: 'target',
      poleVectorId: null,
      bendDirection: 1,
      mix: 1,
      softness: 0,
      order: 0,
    });
    engine.skeleton.rebuild();
    const history = new HistoryManager();
    history.execute(new AddBoneCommand(engine, null, { x: 0, y: 0 }));
    history.undo();
    engine.tick(0);
    const before = structuredClone(engine.document);
    const pose = structuredClone(engine.skeleton.pose);
    const indices = [...engine.skeleton.boneIndexMap];
    const attempts = [
      () => history.execute(new RemoveBoneCommand(engine, 'child')),
      () => history.execute(new AddBoneCommand(engine, 'missing', { x: 0, y: 0 })),
      () => history.execute(new AddBoneCommand(engine, null, { x: NaN, y: 0 })),
      () => history.execute(new ReparentBoneCommand(engine, 'root', 'child')),
      () => history.execute(new ReparentBoneCommand(engine, 'child', 'missing')),
      () => history.execute(new ReparentBoneCommand(engine, 'child', 'zero')),
      () => history.execute(new ReparentBoneCommand(engine, 'child', 'target')),
    ];
    for (const attempt of attempts) {
      expect(attempt).toThrow();
      expect(engine.document).toEqual(before);
      expect(engine.skeleton.pose).toEqual(pose);
      expect([...engine.skeleton.boneIndexMap]).toEqual(indices);
      expect(history.canRedo).toBe(true);
    }
  });

  it('keeps animation object identity for playback and earlier metadata undo', () => {
    const engine = new EditorEngine();
    const root = engine.skeleton.data.bones[0]!.id;
    new AddAnimationCommand(engine).do();
    engine.setAnimation('animation');
    const animation = engine.currentAnimation!;
    const history = new HistoryManager();
    history.execute(new SetAnimationMetaCommand(engine, 'animation', { newName: 'walk', duration: 2 }));
    history.execute(new AddBoneCommand(engine, root, { x: 5, y: 0 }));
    expect(engine.currentAnimation).toBe(animation);
    history.undo();
    history.undo();
    expect(engine.currentAnimation).toBe(animation);
    expect(animation.name).toBe('animation');
    history.redo();
    history.redo();
    expect(engine.currentAnimation).toBe(animation);
    expect(animation.name).toBe('walk');
  });
});
