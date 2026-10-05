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

  it('animation and render APIs fail loudly with their phase, not silently', () => {
    const player = new RuntimePlayer(makeExportedDocument());
    expect(() => player.setAnimation('walk')).toThrow(/Phase 3/);
    expect(() => player.addAnimation('run')).toThrow(/Phase 3/);
    expect(() => player.getDeformedVertices('att')).toThrow(/Phase 5/);
    expect(() => player.render(undefined)).toThrow(/Phase 8/);
    expect(() => player.onEvent(() => {})).toThrow(/Phase 8/);
  });
});
