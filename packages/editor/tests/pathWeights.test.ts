import { describe, expect, it } from 'vitest';
import { encodeWeights, decodeWeights } from '@limber/mesh';
import {
  Skeleton,
  pathWeightAttachment,
  type PathData,
  serializeProject,
  deserializeProject,
} from '@limber/core';
import { compileRuntime, encodeRuntime, loadRuntime, NativeRigPlayer } from '@limber/runtime';
import { EditorEngine } from '../src/engine/EditorEngine';
import { AddBoneCommand } from '../src/commands/boneCommands';
import { BindMeshCommand } from '../src/commands/bindMeshCommand';
import { PaintWeightsCommand } from '../src/commands/meshCommands';
import {
  DirectWeightsCommand,
  WeightMetadataCommand,
  UpdateBindingsCommand,
  weightWorldVertices,
} from '../src/commands/weightEditingCommands';
import { HistoryManager } from '../src/history/history';
import { EditPathShapeCommand } from '../src/commands/pathConstraintCommands';
import { DuplicateBonesCommand } from '../src/commands/duplicateBonesCommand';
import { RemoveBoneCommand } from '../src/commands/boneCommands';
function fixture(joined = false) {
  const engine = new EditorEngine(),
    root = engine.skeleton.data.bones[0]!.id;
  const driver = new AddBoneCommand(engine, root, { x: 100, y: 0 });
  driver.do();
  const follower = new AddBoneCommand(engine, root, { x: 0, y: 0 });
  follower.do();
  const path: PathData = {
    id: 'weighted-path',
    name: 'Weighted curve',
    boneId: root,
    closed: false,
    segments: [
      [0, 0, 30, 0, 60, 0, 90, 0],
      ...(joined ? [[90, 0, 120, 0, 150, 0, 180, 0] as PathData['segments'][number]] : []),
    ],
  };
  engine.skeleton.data.paths = [path];
  engine.skeleton.rebuild();
  new BindMeshCommand(engine, path.id, path.id, [root, driver.boneId], true).do();
  const current = engine.skeleton.data.paths![0]!;
  current.weights = encodeWeights(
    Array.from({ length: current.segments.length * 4 }, () => [
      { boneIndex: engine.skeleton.boneIndexMap.get(root)!, weight: 0.5 },
      { boneIndex: engine.skeleton.boneIndexMap.get(driver.boneId)!, weight: 0.5 },
    ]),
  );
  engine.skeleton.data.pathConstraints = [
    {
      id: 'follow',
      bones: [follower.boneId],
      pathId: path.id,
      progress: 0.5,
      spacing: 0,
      rotationOffset: 0,
      driverId: null,
      mixTranslation: 1,
      mixRotation: 1,
      order: 0,
    },
  ];
  engine.skeleton.rebuild();
  engine.tick(0);
  return {
    engine,
    root,
    driver: driver.boneId,
    follower: follower.boneId,
    path: engine.skeleton.data.paths![0]!,
  };
}
describe('weighted cubic paths', () => {
  it('retains outside-bone contributions when the path owner collapses', () => {
    const { engine, root, driver, follower, path } = fixture();
    path.boneId = driver;
    path.boneBindings = [
      { boneId: root, matrix: [1, 0, 0, 1, 100, 0] },
      { boneId: driver, matrix: [1, 0, 0, 1, 0, 0] },
    ];
    engine.skeleton.data.bones.find((b) => b.id === driver)!.setupPose.scaleX = 0;
    engine.skeleton.data.bones.find((b) => b.id === driver)!.setupPose.scaleY = 0;
    engine.skeleton.rebuild();
    engine.tick(0);
    expect([...weightWorldVertices(engine, path.id)]).toEqual([100, 0, 115, 0, 130, 0, 145, 0]);
    expect(
      engine.skeleton.pose.worldMatrices[engine.skeleton.boneIndexMap.get(follower)! * 6 + 4],
    ).toBeCloseTo(122.5);
  });
  it('skins control points and follows the actual deformed cubic', () => {
    const { engine, driver, follower, path } = fixture();
    engine.skeleton.data.bones.find((b) => b.id === driver)!.setupPose.y = 40;
    engine.tick(0);
    expect([...weightWorldVertices(engine, path.id)]).toEqual([0, 20, 30, 20, 60, 20, 90, 20]);
    const o = engine.skeleton.boneIndexMap.get(follower)! * 6;
    expect(engine.skeleton.pose.worldMatrices[o + 4]).toBeCloseTo(45);
    expect(engine.skeleton.pose.worldMatrices[o + 5]).toBeCloseTo(20);
  });
  it('Direct and brush synchronize joined endpoint influence rows, with exact undo', () => {
    const { engine, root, driver, path } = fixture(true),
      history = new HistoryManager(),
      before = structuredClone(engine.project);
    const direct = new DirectWeightsCommand(engine, path.id, [3], [root]);
    direct.open();
    direct.update(0.8);
    direct.commit();
    history.execute(direct);
    let rows = decodeWeights(engine.skeleton.data.paths![0]!.weights!, 8, engine.skeleton.data.bones.length);
    expect(rows[3]).toEqual(rows[4]);
    expect(rows[3]![0]!.weight).toBe(0.8);
    history.undo();
    expect(engine.project).toEqual(before);
    const brush = new PaintWeightsCommand(engine, path.id);
    brush.open();
    brush.update(4, engine.skeleton.boneIndexMap.get(driver)!, 0, 0.1, 'replace');
    rows = decodeWeights(engine.skeleton.data.paths![0]!.weights!, 8, engine.skeleton.data.bones.length);
    expect(rows[3]).toEqual(rows[4]);
    new Skeleton(structuredClone(engine.skeleton.data));
  });
  it('path locks and current-pose binding updates retain the deformed shape', () => {
    const { engine, root, driver, path } = fixture();
    new WeightMetadataCommand(engine, path.id, 'lock', [root]).do();
    engine.skeleton.data.bones.find((b) => b.id === driver)!.setupPose.y = 30;
    engine.tick(0);
    const before = [...weightWorldVertices(engine, path.id)];
    new UpdateBindingsCommand(engine, path.id).do();
    new WeightMetadataCommand(engine, path.id, 'lock', []).do();
    const cmd = new DirectWeightsCommand(engine, path.id, [0, 1, 2, 3], [driver]);
    cmd.open();
    cmd.update(0.8);
    cmd.commit();
    engine.tick(0);
    expect([...weightWorldVertices(engine, path.id)]).toEqual(before);
    expect(
      decodeWeights(engine.skeleton.data.paths![0]!.weights!, 4, engine.skeleton.data.bones.length)[0]!.find(
        (row) => row.boneIndex === engine.skeleton.boneIndexMap.get(driver),
      )!.weight,
    ).toBe(0.8);
  });
  it('native compile/load preserves weighted following and strips authoring locks', () => {
    const { engine, root, driver, follower, path } = fixture();
    new WeightMetadataCommand(engine, path.id, 'lock', [root]).do();
    engine.skeleton.data.bones.find((b) => b.id === driver)!.setupPose.y = 40;
    engine.tick(0);
    const { program } = compileRuntime(engine.project),
      encoded = encodeRuntime(program);
    expect(new TextDecoder().decode(encoded)).not.toContain('weightLocks');
    const native = new NativeRigPlayer(loadRuntime(encoded), engine.project.editor!.activeRigId!);
    expect(native.getWorldTransforms()[engine.skeleton.boneIndexMap.get(follower)! * 6 + 5]).toBeCloseTo(20);
    expect(deserializeProject(serializeProject(engine.project))).toEqual(engine.project);
  });
  it('rejects weighted feedback and disagreeing shared endpoints', () => {
    const { engine, follower, path } = fixture(true),
      data = structuredClone(engine.skeleton.data);
    data.pathConstraints![0]!.bones = [path.boneBindings![0]!.boneId];
    expect(() => new Skeleton(data)).toThrow(/outside.*subtree/);
    const broken = structuredClone(engine.skeleton.data),
      rows = decodeWeights(broken.paths![0]!.weights!, 8, broken.bones.length);
    rows[4] = [{ boneIndex: engine.skeleton.boneIndexMap.get(follower)!, weight: 1 }];
    broken.paths![0]!.boneBindings!.push({ boneId: follower, matrix: [1, 0, 0, 1, 0, 0] });
    broken.pathConstraints = [];
    broken.paths![0]!.weights = encodeWeights(rows);
    expect(() => new Skeleton(broken)).toThrow(/Joined.*identical/);
  });
  it('rebinding removal restores rigid curves and adapters remain live', () => {
    const { engine, path } = fixture();
    const ids = path.boneBindings!.map((b) => b.boneId);
    new WeightMetadataCommand(engine, path.id, 'remove', ids).do();
    engine.tick(0);
    expect(pathWeightAttachment(engine.skeleton.data.paths![0]!).weights).toBeUndefined();
    expect([...weightWorldVertices(engine, path.id)]).toEqual([0, 0, 30, 0, 60, 0, 90, 0]);
  });
  it('extends, closes and removes weighted segments without losing endpoint continuity', () => {
    const { engine, path } = fixture();
    engine.skeleton.data.pathConstraints = [];
    new EditPathShapeCommand(engine, path.id, 'extend').do();
    expect(engine.skeleton.data.paths![0]!.segments).toHaveLength(2);
    new EditPathShapeCommand(engine, path.id, 'close').do();
    new Skeleton(structuredClone(engine.skeleton.data));
    expect(engine.skeleton.data.paths![0]!.closed).toBe(true);
    new EditPathShapeCommand(engine, path.id, 'open').do();
    new EditPathShapeCommand(engine, path.id, 'removeLast').do();
    expect(
      decodeWeights(engine.skeleton.data.paths![0]!.weights!, 8, engine.skeleton.data.bones.length),
    ).toHaveLength(8);
  });
  it('copies owned weighted paths and rejects deletion of an influencing bone', () => {
    const { engine, root, driver, path } = fixture();
    expect(() => new RemoveBoneCommand(engine, driver).do()).toThrow(/Rebind/);
    new DuplicateBonesCommand(engine, root).do();
    const copied = engine.skeleton.data.paths!.find((item) => item.id !== path.id)!;
    expect(
      copied.boneBindings!.every((binding) =>
        engine.skeleton.data.bones.find((bone) => bone.id === binding.boneId)!.name.includes('.copy'),
      ),
    ).toBe(true);
    new Skeleton(structuredClone(engine.skeleton.data));
  });
});
