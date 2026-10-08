import { describe, expect, it } from 'vitest';
import { evaluateMarkers, serializeProject, deserializeProject, type BoneData } from '@limber/core';
import { EditorEngine } from '../src/engine/EditorEngine';
import { HistoryManager } from '../src/history/history';
import { AddHumanGuideCommand, MirrorBonesCommand } from '../src/commands/rigHelperCommands';
import { createMarker } from '../src/commands/markerCommands';

const world = (engine: EditorEngine, id: string) => {
  const index = engine.skeleton.boneIndexMap.get(id)!;
  return Array.from(engine.solveSetupWorlds().slice(index * 6, index * 6 + 6));
};
const options = { name: 'Guide', height: 360, x: 35, y: -12 };
describe('setup human guides and affine mirror', () => {
  it('adds a complete y-down guide without touching an existing rig or animation, with exact stable undo/redo', () => {
    const engine = new EditorEngine(),
      history = new HistoryManager();
    engine.document.animations.push({ name: 'idle', duration: 1, loop: true, timelines: [] });
    const before = structuredClone(engine.project);
    const command = new AddHumanGuideCommand(engine, options);
    history.execute(command);
    expect(engine.skeleton.data.bones).toHaveLength(16);
    expect(engine.skeleton.data.markers).toHaveLength(4);
    const head = engine.skeleton.data.bones.find((bone) => bone.name === 'Guide.head')!;
    const foot = engine.skeleton.data.bones.find((bone) => bone.name === 'Guide.foot.L')!;
    expect(world(engine, head.id)[5]).toBeCloseTo(options.y - options.height * 0.3, 4);
    expect(world(engine, foot.id)[5]).toBeCloseTo(options.y + options.height * 0.47, 4);
    engine.tick(0);
    const markers = evaluateMarkers(engine.skeleton.data, engine.skeleton.pose, engine.skeleton.boneIndexMap);
    expect(markers.find((m) => m.marker.name === 'Guide.foot.L.socket')!.world[5]).toBeCloseTo(
      options.y + options.height * 0.5,
      4,
    );
    const after = structuredClone(engine.project);
    expect(deserializeProject(serializeProject(after))).toEqual(after);
    history.undo();
    expect(engine.project).toEqual(before);
    history.redo();
    expect(engine.project).toEqual(after);
    history.execute(new AddHumanGuideCommand(engine, options));
    expect(engine.skeleton.data.bones.some((bone) => bone.name === 'Guide2.pelvis')).toBe(true);
    expect(new Set(engine.skeleton.data.bones.map((bone) => bone.name)).size).toBe(31);
    expect(engine.document.animations).toEqual(
      before.artboards[0]!.nodes[0]!.type === 'rig' ? before.artboards[0]!.nodes[0]!.animations : [],
    );
  });

  it('reflects every affine column and marker across an offset axis under a mirrored/sheared parent', () => {
    const engine = new EditorEngine(),
      history = new HistoryManager();
    const bone = (id: string, parentId: string | null, x: number, scaleX: number): BoneData => ({
      id,
      name: id,
      parentId,
      length: 34,
      setupPose: { x, y: 7, rotation: 0.43, scaleX, scaleY: 0.8, shearX: 0.22, shearY: -0.15 },
    });
    engine.skeleton.data.bones = [
      bone('parent', null, 35, -1.4),
      bone('arm', 'parent', 25, 1.2),
      bone('hand', 'arm', 34, -0.8),
    ];
    engine.skeleton.data.markers = [{ ...createMarker('hand', 'hitbox'), name: 'Hand area' }];
    engine.skeleton.rebuild();
    engine.tick(0);
    const originalMarker = evaluateMarkers(
      engine.skeleton.data,
      engine.skeleton.pose,
      engine.skeleton.boneIndexMap,
    )[0]!;
    const originalWorlds = new Map(['arm', 'hand'].map((id) => [id, world(engine, id)]));
    const before = structuredClone(engine.project),
      axis = 18;
    const command = new MirrorBonesCommand(engine, 'arm', axis);
    history.execute(command);
    for (const id of ['arm', 'hand']) {
      const copy = engine.skeleton.data.bones.find((item) => item.name === id + '.mirror')!;
      const old = originalWorlds.get(id)!;
      const expected = [-old[0]!, old[1]!, -old[2]!, old[3]!, 2 * axis - old[4]!, old[5]!];
      world(engine, copy.id).forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, 4));
      expect(world(engine, id)).toEqual(old);
    }
    engine.tick(0);
    const copyMarker = evaluateMarkers(
      engine.skeleton.data,
      engine.skeleton.pose,
      engine.skeleton.boneIndexMap,
    )[1]!;
    copyMarker.outline.forEach((value, index) =>
      expect(value).toBeCloseTo(
        index % 2 ? originalMarker.outline[index]! : 2 * axis - originalMarker.outline[index]!,
        4,
      ),
    );
    const after = structuredClone(engine.project);
    for (let i = 0; i < 3; i++) {
      history.undo();
      expect(engine.project).toEqual(before);
      history.redo();
      expect(engine.project).toEqual(after);
    }
    // A top-level mirror also composes reflection correctly without an external parent.
    history.execute(new MirrorBonesCommand(engine, 'parent', axis));
    expect(engine.skeleton.data.bones.find((item) => item.name === 'parent.mirror')!.parentId).toBeNull();
  });

  it('rejects invalid guides, degenerate mirrors and animate authoring before modifying data or redo', () => {
    const engine = new EditorEngine(),
      history = new HistoryManager();
    history.execute(new AddHumanGuideCommand(engine, options));
    history.undo();
    const before = structuredClone(engine.project);
    for (const height of [0, Infinity, 10001])
      expect(() => history.execute(new AddHumanGuideCommand(engine, { ...options, height }))).toThrow();
    expect(() => history.execute(new MirrorBonesCommand(engine, 'missing', 0))).toThrow();
    expect(() =>
      history.execute(new MirrorBonesCommand(engine, engine.skeleton.data.bones[0]!.id, NaN)),
    ).toThrow();
    engine.mode = 'animate';
    expect(() => history.execute(new AddHumanGuideCommand(engine, options))).toThrow(/Setup/);
    expect(() =>
      history.execute(new MirrorBonesCommand(engine, engine.skeleton.data.bones[0]!.id, 0)),
    ).toThrow(/Setup/);
    expect(engine.project).toEqual(before);
    expect(history.canRedo).toBe(true);
    history.redo();
    expect(engine.skeleton.data.bones).toHaveLength(16);
    engine.mode = 'setup';
    engine.skeleton.data.bones[0]!.setupPose.scaleX = 0;
    const singular = structuredClone(engine.project);
    expect(() =>
      history.execute(new MirrorBonesCommand(engine, engine.skeleton.data.bones[0]!.id, 0)),
    ).toThrow(/zero-scale/);
    expect(engine.project).toEqual(singular);
  });
});
