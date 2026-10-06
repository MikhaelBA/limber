import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RuntimePlayer } from '@limber/runtime';
import {
  deserializeDocument,
  serializeDocument,
  FORMAT_VERSION,
  type EditorDocument,
  type ExportedDocument,
} from '@limber/core';

function makeExportedDocument(): ExportedDocument {
  return {
    version: FORMAT_VERSION,
    skeleton: {
      bones: [
        { id: 'root', name: 'root', parentId: null, length: 0,
          setupPose: { x: 10, y: 20, rotation: Math.PI / 2, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 } },
        { id: 'child', name: 'child', parentId: 'root', length: 0,
          setupPose: { x: 5, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 } },
      ],
      slots: [],
      attachments: [],
      ikConstraints: [],
      skins: [],
      activeSkin: '',
    },
    animations: [],
    assetManifest: {},
  };
}

describe('RuntimePlayer (Phase 1 stub)', () => {
  it('end-to-end: serialize → deserialize → construct → FK-solved world transforms', () => {
    // The full Phase 1 pipeline: a document saved by the editor loads into the
    // runtime and produces correct world matrices at the setup pose.
    const exported = makeExportedDocument();
    const editorDoc: EditorDocument = {
      skeleton: exported.skeleton,
      animations: exported.animations,
      assetManifest: exported.assetManifest,
    };
    const restored = deserializeDocument(serializeDocument(editorDoc));
    const player = new RuntimePlayer({ ...restored, version: FORMAT_VERSION });
    player.update(1 / 60);

    // root: translate(10,20)·R(90°) → [0, 1, -1, 0, 10, 20]
    const wm = player.getWorldTransforms();
    expect(wm[0]!).toBeCloseTo(0, 5);
    expect(wm[1]!).toBeCloseTo(1, 5);
    expect(wm[2]!).toBeCloseTo(-1, 5);
    expect(wm[3]!).toBeCloseTo(0, 5);
    expect(wm[4]!).toBeCloseTo(10, 5);
    expect(wm[5]!).toBeCloseTo(20, 5);

    // child at local (5,0) under the rotated root → world (10, 25), rotation inherited.
    expect(wm[6 + 0]!).toBeCloseTo(0, 5);
    expect(wm[6 + 1]!).toBeCloseTo(1, 5);
    expect(wm[6 + 2]!).toBeCloseTo(-1, 5);
    expect(wm[6 + 3]!).toBeCloseTo(0, 5);
    expect(wm[6 + 4]!).toBeCloseTo(10, 5);
    expect(wm[6 + 5]!).toBeCloseTo(25, 5);
  });
});

describe('RuntimePlayer (full implementation)', () => {
  const demoPath = new URL('../../editor/public/examples/demo.limber.json', import.meta.url);
  const demo = deserializeDocument(
    JSON.stringify({ version: FORMAT_VERSION, ...JSON.parse(readFileSync(demoPath, 'utf8')) }),
  );

  function meshAttachmentId(): string {
    const att = demo.skeleton.attachments.find((a) => a.type === 'mesh')!;
    return att.id;
  }

  it('plays the demo project end-to-end: animation moves the skinned mesh', () => {
    const player = new RuntimePlayer({ ...demo, version: FORMAT_VERSION });
    player.setAnimation('wave');
    const meshId = meshAttachmentId();

    const at = (t: number): number[] => {
      while (player.time < t) player.update(Math.min(1 / 60, t - player.time));
      return [...player.getDeformedVertices(meshId)].map((v) => Math.round(v * 100) / 100);
    };
    const start = at(0);
    const mid = at(0.6);
    expect(start).not.toEqual(mid); // the rig actually moved

    // Deformed verts are world-space and finite throughout.
    for (const v of mid) expect(Number.isFinite(v)).toBe(true);
    // 4x3 grid mesh = 20 vertices.
    expect(mid.length).toBe(40);
  });

  it('fires events through onEvent and the events buffer', () => {
    const player = new RuntimePlayer({ ...demo, version: FORMAT_VERSION });
    player.setAnimation('wave', { loop: false });
    const seen: string[] = [];
    const off = player.onEvent((e) => seen.push(e.eventName));
    let buffered: string[] | null = null;
    while (player.time < 1.19) {
      player.update(1 / 60);
      if (player.events.length > 0) buffered = player.events.map((e) => e.eventName); // last-crossing frame
    }
    expect(seen).toContain('swoosh');
    expect(buffered).toContain('swoosh'); // the frame-buffer also carried it
    off();
  });

  it('queues the next animation after the current one ends', () => {
    const player = new RuntimePlayer({ ...demo, version: FORMAT_VERSION });
    player.setAnimation('wave', { loop: false });
    player.addAnimation('wave', { delay: 0.2 });
    for (let i = 0; i < 240; i++) player.update(1 / 60);
    // Without the queue, a non-looping track parks AT its duration forever;
    // the queued replay is running again mid-animation.
    expect(player.time).toBeGreaterThan(0);
    expect(player.time).toBeLessThan(player.duration);
    // It must already have passed the first play + delay (4s simulated).
    expect(player.time).toBeLessThan(4 - player.duration - 0.2 + 1e-6);
  });

  it('loops by default and exposes draw order + slot colors', () => {
    const player = new RuntimePlayer({ ...demo, version: FORMAT_VERSION });
    player.setAnimation('wave');
    for (let i = 0; i < 200; i++) player.update(1 / 60);
    expect(player.time).toBeLessThan(demo.animations[0]!.duration); // wrapped
    expect(player.getDrawOrder()).toHaveLength(demo.skeleton.slots.length);
    expect(player.getSlotAttachmentId(0)).toMatch(/[a-z0-9-]+/);
    expect(typeof player.getSlotColor(0)).toBe('number');
  });

  it('unknown names fail loudly', () => {
    const player = new RuntimePlayer({ ...demo, version: FORMAT_VERSION });
    expect(() => player.setAnimation('nope')).toThrow(/no animation "nope"/);
    expect(() => player.getDeformedVertices('ghost')).toThrow(/unknown attachment "ghost"/);
  });
});
