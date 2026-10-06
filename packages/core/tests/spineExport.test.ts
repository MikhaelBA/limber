import { describe, expect, it } from 'vitest';
import { exportSpineJson } from '../src/serialization/spineExport';
import type { EditorDocument } from '../src/types/document';
import type { BoneData } from '../src/types/data';

const bone = (id: string, parentId: string | null, p: Partial<BoneData['setupPose']> = {}): BoneData => ({
  id,
  name: id,
  parentId,
  length: 20,
  setupPose: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0, ...p },
});

function doc(): EditorDocument {
  return {
    skeleton: {
      bones: [
        bone('a', null, { x: 10, y: -20, rotation: 0.5, shearX: 0.1 }),
        bone('b', 'a', { x: 30, y: 5 }),
      ],
      slots: [
        { id: 's1', name: 'slotA', boneId: 'a', defaultAttachmentId: 'r1', color: 0xff8040c0 },
      ],
      attachments: [
        {
          id: 'r1',
          name: 'head',
          type: 'region',
          textureId: 't1',
          vertices: [-10, -5, 10, -5, 10, 5, -10, 5],
          uvs: [0, 0, 1, 0, 1, 1, 0, 1],
        },
      ],
      ikConstraints: [],
      skins: [],
      activeSkin: '',
    },
    animations: [],
    assetManifest: { t1: { name: 'head.png', source: 'embedded' } },
  };
}

describe('exportSpineJson', () => {
  it('exports bones with y-flip, negated rotation/shear in degrees, names not ids', () => {
    const json = JSON.parse(exportSpineJson(doc()));
    expect(json.bones).toHaveLength(2);
    const a = json.bones[0];
    expect(a.name).toBe('a');
    expect(a.parent).toBeUndefined(); // root
    expect(a.x).toBe(10);
    expect(a.y).toBe(20); // -(-20)
    expect(a.rotation).toBeCloseTo(-0.5 * (180 / Math.PI), 3);
    expect(a.shearX).toBeCloseTo(-0.1 * (180 / Math.PI), 3);
    expect(json.bones[1].parent).toBe('a');
  });

  it('exports slots with color strings and the default attachment', () => {
    const json = JSON.parse(exportSpineJson(doc()));
    expect(json.slots[0]).toMatchObject({ name: 'slotA', bone: 'a', attachment: 'head', color: 'ff8040c0' });
  });

  it('exports region attachments with centered y-flipped geometry and sans-extension path', () => {
    const json = JSON.parse(exportSpineJson(doc()));
    const region = json.skins[0].attachments.slotA.head;
    expect(json.skins[0].name).toBe('default');
    expect(region).toMatchObject({ type: 'region', path: 'head', width: 20, height: 10, rotation: 0 });
    expect(region.x).toBe(0);
    expect(region.y).toBe(0); // -0
  });

  it('exports mesh attachments hull-first with remapped triangles/uvs', () => {
    const d = doc();
    // 3x3-ish custom layout: hull square [0,1,2,3], interior vertex 4 at center.
    d.skeleton.attachments = [
      {
        id: 'm1',
        name: 'blob',
        type: 'mesh',
        textureId: 't1',
        // v0 interior-ish ordering: v0 = center (interior), v1..v4 = hull ring.
        meshVertices: [0, 0, -10, -10, 10, -10, 10, 10, -10, 10],
        meshTriangles: [1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 1, 0],
        meshUVs: [0.5, 0.5, 0, 0, 1, 0, 1, 1, 0, 1],
        meshHull: [1, 2, 3, 4],
      },
    ];
    d.skeleton.slots[0]!.defaultAttachmentId = 'm1';
    const json = JSON.parse(exportSpineJson(d));
    const mesh = json.skins[0].attachments.slotA.blob;
    expect(mesh.type).toBe('mesh');
    expect(mesh.hull).toBe(4);
    // Hull-first: ring corners with y flipped, then the interior center.
    expect(mesh.vertices).toEqual([-10, 10, 10, 10, 10, -10, -10, -10, 0, 0]);
    // Old v0 (center) is now index 4; triangles remapped accordingly.
    expect(mesh.triangles.slice(0, 3)).toEqual([0, 1, 4]);
    expect(mesh.uvs).toEqual([0, 0, 1, 0, 1, 1, 0, 1, 0.5, 0.5]);
  });

  it('exports weighted meshes with per-influence bone-local coordinates', () => {
    const d = doc();
    d.skeleton.bones[1]!.setupPose.x = 100; // bone b world (110, -15): translate away.
    d.skeleton.attachments = [
      {
        id: 'm1',
        name: 'skinned',
        type: 'mesh',
        textureId: 't1',
        meshVertices: [10, 0, -10, -10, 10, -10, 10, 10, -10, 10],
        meshTriangles: [1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 1, 0],
        meshUVs: [0.5, 0.5, 0, 0, 1, 0, 1, 1, 0, 1],
        meshHull: [1, 2, 3, 4],
        // Vertex 0 (old index): 50% bone a (index 0), 50% bone b (index 1).
        weights: [2, 0, 0.5, 1, 0.5, 0, 0, 0, 0, 0],
      },
    ];
    d.skeleton.slots[0]!.defaultAttachmentId = 'm1';
    const json = JSON.parse(exportSpineJson(d));
    const mesh = json.skins[0].attachments.slotA.skinned;
    // Layout: 4 rigid hull vertices first ([1, 0, x, -y, 1] each), then the
    // weighted interior vertex last ([2, b0, xa, ya, w, b1, xb, yb, w]).
    const v = mesh.vertices;
    expect(v).toHaveLength(4 * 5 + 9);
    expect(v.slice(5, 10)).toEqual([1, 0, 10, 10, 1]); // old v1 (-10,-10) → (-10, 10)
    const w = v.slice(20); // the weighted vertex
    expect(w[0]).toBe(2);
    expect(w[1]).toBe(0); // bone a index
    expect(w[2]).toBeCloseTo(10, 5); // influence-a local = M_a⁻¹·M_a·(10,0) = (10,0)
    expect(w[3]).toBeCloseTo(0, 5);
    expect(w[4]).toBeCloseTo(0.5, 5);
    expect(w[5]).toBe(1); // bone b index
    expect(w[7]).toBeDefined(); // influence-b local coords exist (M_b⁻¹·M_a·v)
    expect(w[8]).toBeCloseTo(0.5, 5);
  });

  it('exports ik constraints with generated names', () => {
    const d = doc();
    d.skeleton.ikConstraints.push({
      id: 'ik-uuid-1',
      bones: ['a', 'b'],
      targetId: 'b',
      poleVectorId: null,
      bendDirection: -1,
      mix: 0.5,
      softness: 0,
      order: 0,
    });
    const json = JSON.parse(exportSpineJson(d));
    expect(json.ik[0]).toMatchObject({ name: 'ik1', bones: ['a', 'b'], target: 'b', bendDirection: -1, mix: 0.5 });
  });

  it('merges per-property timelines into packed tracks with flipped values and curves', () => {
    const d = doc();
    d.animations = [
      {
        name: 'walk',
        duration: 1,
        loop: true,
        timelines: [
          {
            kind: 'boneProperty',
            boneId: 'a',
            property: 'rotation',
            keyframes: [
              { time: 0, value: 1.5707963, curve: { type: 'linear' } },
              { time: 0.5, value: 0, curve: { type: 'stepped' } },
            ],
          },
          {
            kind: 'boneProperty',
            boneId: 'a',
            property: 'x',
            keyframes: [{ time: 0, value: 5, curve: { type: 'bezier', c1: 0.2, c2: 0.4, c3: 0.8, c4: 1.2 } }],
          },
          {
            kind: 'boneProperty',
            boneId: 'a',
            property: 'y',
            keyframes: [{ time: 0.5, value: -7, curve: { type: 'linear' } }],
          },
        ],
      },
    ];
    const json = JSON.parse(exportSpineJson(d));
    const bones = json.animations.walk.bones.a;
    expect(bones.rotate[0].angle).toBeCloseTo(-90, 3);
    expect(bones.rotate[1].curve).toBe('stepped');
    // translate merges x (t=0) and y (t=0.5) at the union of times; y holds 0
    // until keyed, x holds 5 after.
    expect(bones.translate).toEqual([
      { time: 0, x: 5, y: 0, curve: [0.2, -0.4, 0.8, -1.2] },
      { time: 0.5, x: 5, y: 7 }, // y=-7 → +7 (flip)
    ]);
  });

  it('exports slot color/attachment tracks and draw-order diffs', () => {
    const d = doc();
    d.skeleton.slots.push({ id: 's2', name: 'slotB', boneId: 'b', defaultAttachmentId: null, color: 0xffffffff });
    d.animations = [
      {
        name: 'anim',
        duration: 1,
        loop: true,
        timelines: [
          { kind: 'slotColor', slotId: 's1', keyframes: [{ time: 0.25, value: 0x11223344, curve: { type: 'linear' } }] },
          { kind: 'slotAttachment', slotId: 's1', keyframes: [{ time: 0, attachmentId: null, curve: { type: 'stepped' } }] },
          { kind: 'drawOrder', keyframes: [{ time: 0.5, slotOrder: [1, 0], curve: { type: 'stepped' } }] },
        ],
      },
    ];
    const json = JSON.parse(exportSpineJson(d));
    const slots = json.animations.anim.slots.slotA;
    expect(slots.rgba[0]).toEqual({ time: 0.25, color: '11223344' });
    expect(slots.attachment[0]).toEqual({ time: 0, name: null, curve: 'stepped' });
    // Swap [1,0]: slot0 moves 0→1 (+1), slot1 moves 1→0 (-1); exported sorted
    // by offset so sequential application converges for swaps.
    expect(json.animations.anim['draw-order'][0].offsets).toEqual([
      { slot: 1, offset: -1 },
      { slot: 0, offset: 1 },
    ]);
  });

  it('exports deform timelines with y-flipped offsets under the owning slot', () => {
    const d = doc();
    d.animations = [
      {
        name: 'anim',
        duration: 1,
        loop: true,
        timelines: [
          {
            kind: 'deform',
            attachmentId: 'r1', // regions can carry deform too in our model — exported the same
            keyframes: [{ time: 0.3, offsets: [1, -2, 3, 4], curve: { type: 'linear' } }],
          },
        ],
      },
    ];
    const json = JSON.parse(exportSpineJson(d));
    const kf = json.animations.anim.deform.default.slotA.head[0];
    expect(kf.time).toBe(0.3);
    expect(kf.vertices).toEqual([1, 2, 3, -4]);
  });

  it('collects event definitions and exports event keyframes', () => {
    const d = doc();
    d.animations = [
      {
        name: 'anim',
        duration: 1,
        loop: true,
        timelines: [
          {
            kind: 'event',
            keyframes: [
              { time: 0.1, eventName: 'footstep', payload: 3, curve: { type: 'stepped' } },
              { time: 0.6, eventName: 'shout', payload: 'hi', curve: { type: 'stepped' } },
            ],
          },
        ],
      },
    ];
    const json = JSON.parse(exportSpineJson(d));
    expect(json.events).toEqual({ footstep: { int: 3 }, shout: { string: 'hi' } });
    expect(json.animations.anim.events[0]).toEqual({ time: 0.1, name: 'footstep', int: 3 });
    expect(json.animations.anim.events[1]).toEqual({ time: 0.6, name: 'shout', string: 'hi' });
  });

  it('exports named skins as separate entries', () => {
    const d = doc();
    d.skeleton.skins = [{ name: 'summer', attachments: { s1: 'r1' } }];
    const json = JSON.parse(exportSpineJson(d));
    expect(json.skins.map((s: { name: string }) => s.name)).toEqual(['default', 'summer']);
    expect(json.skins[1].attachments.slotA.head.type).toBe('region');
  });
});
