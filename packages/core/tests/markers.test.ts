import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  Skeleton,
  solveFK,
  applyTimeline,
  evaluateMarkers,
  validateMarkers,
  sceneLocalMatrix,
  multiplySceneMatrices,
  deserializeProject,
  serializeProject,
  exportSpineJson,
  type MarkerData,
} from '../src';
import { makeBone, makeSkeletonData } from './helpers';

const socket = (): MarkerData => ({
  id: 'hand',
  name: 'Hand socket',
  kind: 'socket',
  boneId: 'child',
  transform: { x: 17, y: -3, rotation: 0.3, scaleX: 1, scaleY: -0.8, shearX: 0.2, shearY: -0.1 },
});
describe('native runtime marker contract', () => {
  it('composes a socket with the sampled bone and owning rig transforms deterministically', () => {
    const data = makeSkeletonData([
      makeBone('root', null, { x: 10, y: -20, rotation: 0.7, scaleX: -1.1, shearX: 0.2 }),
      makeBone('child', 'root', { x: 40, y: 5 }),
    ]);
    data.markers = [
      socket(),
      { ...socket(), id: 'hit', kind: 'hitbox', shape: { type: 'rectangle', width: 20, height: 10 } },
    ];
    const skeleton = new Skeleton(data),
      pose = skeleton.pose;
    applyTimeline(
      {
        kind: 'boneProperty',
        boneId: 'child',
        property: 'rotation',
        keyframes: [
          { time: 0, value: 0, curve: { type: 'linear' } },
          { time: 1, value: 1, curve: { type: 'linear' } },
        ],
      },
      skeleton,
      0.5,
      0,
      1,
      null,
      'test',
    );
    solveFK(data, skeleton.boneIndexMap, pose);
    const setup = structuredClone(data);
    const owner = sceneLocalMatrix({
      x: 50,
      y: 20,
      rotation: -0.2,
      scaleX: 2,
      scaleY: 0.6,
      shearX: 0,
      shearY: 0,
      pivotX: 0,
      pivotY: 0,
    });
    const evaluated = evaluateMarkers(data, pose, skeleton.boneIndexMap, owner);
    const root = sceneLocalMatrix({ ...pose.bones[0]!.local, pivotX: 0, pivotY: 0 });
    const child = sceneLocalMatrix({ ...pose.bones[1]!.local, pivotX: 0, pivotY: 0 });
    const local = sceneLocalMatrix({ ...data.markers[0]!.transform, pivotX: 0, pivotY: 0 });
    const expected = multiplySceneMatrices(
      owner,
      multiplySceneMatrices(multiplySceneMatrices(root, child), local),
    );
    evaluated[0]!.world.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 4));
    expect(evaluated[1]!.outline).toHaveLength(8);
    expect(evaluateMarkers(data, pose, skeleton.boneIndexMap, owner)).toEqual(evaluated);
    expect(data).toEqual(setup);
  });

  it('rejects dangling IDs, unsupported kinds, nonfinite transforms and invalid area geometry', () => {
    const ids = new Set(['child']);
    const valid = socket();
    expect(() => validateMarkers([valid], ids)).not.toThrow();
    for (const invalid of [
      null,
      [valid, valid],
      [{ ...valid, boneId: 'missing' }],
      [{ ...valid, kind: 'unknown' }],
      [{ ...valid, transform: { ...valid.transform, x: Infinity } }],
      [{ ...valid, kind: 'hitbox' }],
      [{ ...valid, kind: 'hitbox', shape: { type: 'rectangle', width: -1, height: 4 } }],
      [{ ...valid, kind: 'trigger', shape: { type: 'polygon', vertices: [0, 0, 10, 10, 0, 10, 10, 0] } }],
      [{ ...valid, kind: 'trigger', shape: { type: 'polygon', vertices: [0, 0, 1, 1, 2, 2] } }],
      [{ ...valid, shape: { type: 'rectangle', width: 4, height: 4 } }],
    ])
      expect(() => validateMarkers(invalid, ids)).toThrow();
    expect(() =>
      validateMarkers(
        [{ ...valid, kind: 'trigger', shape: { type: 'polygon', vertices: [0, 0, 10, 0, 4, 4, 0, 10] } }],
        ids,
      ),
    ).not.toThrow();
  });

  it('migrates schemas 1–3 without adding fields and requires explicit Spine omission reporting', () => {
    for (const name of ['bbbproj-v1-demo.json', 'bbbproj-v2-motion.json', 'bbbproj-v3-reward.json']) {
      const raw = JSON.parse(readFileSync(new URL(`../../../fixtures/${name}`, import.meta.url), 'utf8'));
      const project = deserializeProject(JSON.stringify(raw));
      expect(project).toEqual({ ...raw, schemaVersion: 6 });
      expect(deserializeProject(serializeProject(project))).toEqual(project);
    }
    const skeleton = makeSkeletonData([makeBone('child', null)]);
    skeleton.markers = [socket()];
    const doc = { skeleton, animations: [], assetManifest: {} };
    expect(() => exportSpineJson(doc)).toThrow(/omits.*markers/);
    const warnings: string[] = [];
    expect(JSON.parse(exportSpineJson(doc, undefined, warnings)).bones).toHaveLength(1);
    expect(warnings).toHaveLength(1);
    expect(doc.skeleton.markers).toEqual([socket()]);
  });
});
