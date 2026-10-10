import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deserializeProject, createSkinningStats, updateSkinning, type RigNode } from '@limber/core';
import {
  compileRuntime,
  NativeArtboardPlayer,
  inspectRuntimeFrame,
  RuntimeFrameProfiler,
  RuntimeFormatError,
} from '@limber/runtime';

describe('native selected pose work and bounded profiler', () => {
  it('matches independent skinning instrumentation on ordinary and weighted sample poses without advancing', () => {
    for (const filename of [
      '../../../fixtures/bbbproj-v13-interactive.json',
      '../../../examples/fox-adventurer/Fox-Adventurer.bbbproj',
    ]) {
      const source = deserializeProject(readFileSync(new URL(filename, import.meta.url), 'utf8')),
        player = new NativeArtboardPlayer(compileRuntime(source).program);
      player.play();
      player.update(1 / 60);
      const before = JSON.stringify(player.snapshot()),
        references = player.getRigIds().map((id) => player.getRig(id).skeleton.pose.worldMatrices),
        report = inspectRuntimeFrame(player);
      const expected = createSkinningStats();
      for (const id of player.getRigIds()) {
        const stats = createSkinningStats();
        updateSkinning(player.getRig(id).skeleton, stats);
        for (const key of Object.keys(expected) as (keyof typeof expected)[]) expected[key] += stats[key];
      }
      for (const key of Object.keys(expected) as (keyof typeof expected)[])
        expect(report[key]).toBe(expected[key]);
      expect(report.weightedVertexTransforms).toBe(expected.vertexTransforms - expected.rigidVertices);
      expect(JSON.stringify(player.snapshot())).toBe(before);
      expect(
        player.getRigIds().every((id, i) => player.getRig(id).skeleton.pose.worldMatrices === references[i]),
      ).toBe(true);
      player.pause();
      expect(inspectRuntimeFrame(player).activeTracks).toBe(report.activeTracks);
      player.stop();
      expect(inspectRuntimeFrame(player).activeTracks).toBe(0);
      expect(report.nodes).toBe(player.getView().nodes.length);
      if (filename.includes('fox-adventurer')) expect(report.weightedVertexTransforms).toBeGreaterThan(0);
    }
  });
  it('keeps hidden independent character CPU work and follows null attachment selection', () => {
    const source = deserializeProject(
      readFileSync(new URL('../../../fixtures/bbbproj-v13-interactive.json', import.meta.url), 'utf8'),
    );
    const board = source.artboards[0]!,
      rig = board.nodes.find((node): node is RigNode => node.type === 'rig')!;
    board.nodes.push({ ...structuredClone(rig), id: 'hidden-peer', visible: false });
    const player = new NativeArtboardPlayer(compileRuntime(source).program),
      initial = inspectRuntimeFrame(player);
    expect(initial.rigs).toBe(2);
    expect(initial.bones).toBe(rig.skeleton.bones.length * 2);
    expect(initial.visibleNodes).toBeLessThan(initial.nodes);
    const hidden = player.getRig('hidden-peer');
    for (const slot of hidden.skeleton.data.slots) hidden.setAttachment(slot.id, null);
    const changed = inspectRuntimeFrame(player);
    expect(changed.attachments).toBe(initial.attachments / 2);
    expect(changed.vertices).toBe(initial.vertices / 2);
    expect(changed.bones).toBe(initial.bones);
    hidden.setLogicEnabled(false);
    expect(hidden.activeTrackCount).toBe(0);
    player.stop();
    expect(player.scene.activeTrackCount).toBe(0);
  });
  it('uses exact nearest-rank window percentiles, preserves unknown draw coverage and owns results', () => {
    const frames = new RuntimeFrameProfiler(3);
    expect(frames.inspect()).toEqual({
      samples: 0,
      totalRecorded: 0,
      acceptedTicks: 0,
      drawCallSamples: 0,
      updateMs: null,
      renderSubmitMs: null,
      drawCalls: null,
    });
    for (const [updateMs, renderSubmitMs, acceptedTicks, drawCalls] of [
      [99, 50, 12, 8],
      [1, 3, 1, null],
      [2, 2, 2, 0],
      [3, 1, 3, 2],
    ] as const)
      frames.record({ updateMs, renderSubmitMs, acceptedTicks, drawCalls });
    const result = frames.inspect();
    expect(result).toEqual({
      samples: 3,
      totalRecorded: 4,
      acceptedTicks: 6,
      drawCallSamples: 2,
      updateMs: { min: 1, median: 2, p95: 3, max: 3 },
      renderSubmitMs: { min: 1, median: 2, p95: 3, max: 3 },
      drawCalls: { min: 0, median: 0, p95: 2, max: 2 },
    });
    result.updateMs!.p95 = 999;
    expect(frames.inspect().updateMs!.p95).toBe(3);
    frames.clear();
    expect(frames.inspect().samples).toBe(0);
    expect(frames.inspect().totalRecorded).toBe(0);
    frames.record({ updateMs: 0, renderSubmitMs: 0, acceptedTicks: 0, drawCalls: null });
    expect(frames.inspect().drawCalls).toBe(null);
    expect(frames.inspect().updateMs!.p95).toBe(0);
  });
  it('rejects invalid capacity/samples atomically with coded errors', () => {
    for (const capacity of [0, -1, 1.5, 601, Infinity])
      expect(() => new RuntimeFrameProfiler(capacity)).toThrow(RuntimeFormatError);
    const frames = new RuntimeFrameProfiler(1),
      good = { updateMs: 0.1, renderSubmitMs: 0.2, acceptedTicks: 2, drawCalls: 1 };
    frames.record(good);
    const before = frames.inspect();
    for (const bad of [
      null,
      [],
      { ...good, updateMs: NaN },
      { ...good, renderSubmitMs: -1 },
      { ...good, acceptedTicks: 13 },
      { ...good, acceptedTicks: 0.5 },
      { ...good, drawCalls: Infinity },
      { ...good, drawCalls: undefined },
      { ...good, fake: true },
    ]) {
      expect(() => frames.record(bad as never)).toThrow(RuntimeFormatError);
      expect(frames.inspect()).toEqual(before);
    }
  });
});
