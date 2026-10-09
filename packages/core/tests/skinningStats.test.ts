import { describe, expect, it } from 'vitest';
import { Skeleton, solveFK, updateSkinning, createSkinningStats } from '../src';
import { readFileSync } from 'node:fs';

describe('optional skinning work counters', () => {
  it('counts rigid/weighted vertices, influence transforms and bind products without changing output', () => {
    const project = JSON.parse(readFileSync('fixtures/bbbproj-v5-bind-mesh.json', 'utf8'));
    const skeleton = new Skeleton(project.artboards[0].nodes[0].skeleton);
    skeleton.data.attachments[0]!.weights = [0, 1, 1, 1, 2, 0, 0.25, 1, 0.75, 1, 0, 1];
    solveFK(skeleton.data, skeleton.boneIndexMap, skeleton.pose);
    updateSkinning(skeleton);
    const before = [...skeleton.pose.attachments.get('mesh')!.verts],
      stats = createSkinningStats();
    updateSkinning(skeleton, stats);
    expect([...skeleton.pose.attachments.get('mesh')!.verts]).toEqual(before);
    expect(stats).toEqual({
      attachments: 1,
      vertices: 4,
      rigidVertices: 1,
      weightedVertices: 3,
      vertexTransforms: 5,
      bindMatrixProducts: 2,
    });
    updateSkinning(skeleton, stats);
    expect(stats.vertexTransforms).toBe(5);
    skeleton.pose.slots[0]!.attachmentId = null;
    updateSkinning(skeleton, stats);
    expect(stats).toEqual(createSkinningStats());
  });
});
