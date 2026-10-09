import { describe, expect, it } from 'vitest';
import { playbackFixture } from '../../../tools/mesh-fixtures.mjs';
import { activeRigDocument, createSkinningStats, deserializeProject, serializeProject } from '@limber/core';
import { RuntimePlayer } from '@limber/runtime';
import { EditorEngine } from '../src/engine/EditorEngine';

describe('representative mesh playback fixtures', () => {
  it.each(['Standard','Heavy'])('%s has complete spec contents and native/runtime/preview parity', (kind) => {
    const project = playbackFixture(kind), doc = activeRigDocument(project)!, heavy = kind === 'Heavy';
    const engine = new EditorEngine(); engine.loadProject(deserializeProject(serializeProject(project)));
    expect(doc.skeleton.bones).toHaveLength(heavy ? 120 : 60);
    expect(doc.skeleton.ikConstraints).toHaveLength(heavy ? 10 : 5);
    expect(doc.animations).toHaveLength(10);
    const stats = createSkinningStats(), player = new RuntimePlayer(doc);
    engine.setAnimation('benchmark-00'); engine.mode = 'animate'; engine.play();
    player.setAnimation('benchmark-00');
    for (let i = 0; i < 30; i++) {
      engine.tick(1000 / 60, stats); player.update(1 / 60);
    }
    expect(stats.vertexTransforms).toBe(heavy ? 40004 : 10000);
    expect(stats.bindMatrixProducts).toBe(heavy ? 120 : 60);
    expect(stats.vertices).toBe(heavy ? 10004 : 2500);
    const actual = engine.skeleton.pose.attachments.get('mesh')!.verts;
    expect([...actual].every(Number.isFinite)).toBe(true);
    expect([...actual]).toEqual([...player.getDeformedVertices('mesh')!]);
    expect(doc.animations.some((clip) => clip.timelines.some((track) => track.kind === 'deform'))).toBe(heavy);
    expect(doc.skeleton.attachments.some((item) => item.type === 'clipping')).toBe(heavy);
  });
});
