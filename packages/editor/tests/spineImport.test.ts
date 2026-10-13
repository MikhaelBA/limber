import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as spine from '@esotericsoftware/spine-core';
import { grid43 } from '../../../fixtures/spine-import/grid43.mjs';
import {
  importSpineJson,
  spineSkinNames,
  parseSpineAtlas,
  Skeleton,
  resetPose,
  solveFK,
  updateSkinning,
  applyTimeline,
  projectFromLegacy,
  serializeProject,
  deserializeProject,
} from '@limber/core';

const source = JSON.parse(readFileSync('fixtures/spine-import/skeleton.json', 'utf8'));
function load(raw = source, skin = 'default') {
  return importSpineJson(JSON.stringify(raw), skin);
}
function oracle(raw = source) {
  const atlas = new spine.TextureAtlas(
    `test.png\nsize: 16,16\npatch\nbounds: 0,0,8,8\nbadge\nbounds: 0,0,8,8\nblue\nbounds: 0,0,8,8\n`,
  );
  const reader = new spine.SkeletonJson(new spine.AtlasAttachmentLoader(atlas));
  const data = reader.readSkeletonData(raw);
  return new spine.Skeleton(data);
}
function pose(imported: ReturnType<typeof load>, time: number) {
  const sk = new Skeleton(imported.document.skeleton);
  resetPose(sk.data, sk.pose);
  for (const t of imported.document.animations[0]!.timelines) applyTimeline(t, sk, time, 0, 1, null, 'wave');
  solveFK(sk.data, sk.boneIndexMap, sk.pose);
  updateSkinning(sk);
  return sk;
}
describe('Spine import, verified against the official 4.2 runtime', () => {
  it('matches weighted mesh positions, Bezier transforms, deform and draw order across the clip', () => {
    const imported = load(),
      official = oracle();
    for (const time of [0, 0.15, 0.5, 0.75, 1]) {
      official.setToSetupPose();
      official.data.animations[0]!.apply(
        official,
        0,
        time,
        false,
        [],
        1,
        spine.MixBlend.replace,
        spine.MixDirection.mixIn,
      );
      official.updateWorldTransform(spine.Physics.none);
      const native = pose(imported, time),
        mesh = official.slots[1]!.getAttachment() as spine.MeshAttachment;
      const expected = new Float32Array(mesh.worldVerticesLength);
      mesh.computeWorldVertices(official.slots[1]!, 0, mesh.worldVerticesLength, expected, 0, 2);
      const actual = native.pose.attachments.get(native.data.slots[1]!.defaultAttachmentId!)!.verts;
      for (let i = 0; i < actual.length; i++)
        expect(actual[i]).toBeCloseTo(i % 2 ? -expected[i]! : expected[i]!, 1);
      expect([...native.pose.slotOrder]).toEqual(official.drawOrder.map((s) => s.data.index));
    }
  });
  it('preserves setup scale multipliers and independent absolute Bezier channels', () => {
    const raw = structuredClone(source);
    raw.skins = [];
    raw.slots = [];
    Object.assign(raw.bones[1]!, { scaleX: 1.7, scaleY: -0.8, rotation: 25 });
    raw.animations.wave = {
      bones: {
        arm: {
          scale: [
            { x: 1, y: 1, curve: [0.2, 1, 0.8, 1.5, 0.1, 1, 0.9, 0.4] },
            { time: 1, x: 1.5, y: 0.4 },
          ],
        },
      },
    } as unknown as typeof raw.animations.wave;
    const native = pose(load(raw), 0.4),
      official = oracle(raw);
    official.data.animations[0]!.apply(
      official,
      0,
      0.4,
      false,
      [],
      1,
      spine.MixBlend.replace,
      spine.MixDirection.mixIn,
    );
    official.updateWorldTransform(spine.Physics.none);
    const a = native.pose.worldMatrices,
      b = official.bones[1]!;
    for (const [i, v] of [
      [6, b.a],
      [7, -b.c],
      [8, -b.b],
      [9, b.d],
    ])
      expect(a[i!]).toBeCloseTo(v!, 2);
  });
  it('flattens selected skin with default fallback and saves/reopens the native rig', () => {
    expect(spineSkinNames(JSON.stringify(source))).toEqual(['default', 'blue']);
    const imported = load(source, 'blue');
    expect([...imported.images.values()].sort()).toEqual(['blue', 'patch']);
    const reopened = deserializeProject(serializeProject(projectFromLegacy(imported.document)));
    expect(reopened.artboards[0]!.nodes[0]).toMatchObject({
      skeleton: JSON.parse(JSON.stringify(imported.document.skeleton)),
      animations: JSON.parse(JSON.stringify(imported.document.animations)),
    });
  });
  it('preserves event scalar payloads', () => {
    const event = load().document.animations[0]!.timelines.find((t) => t.kind === 'event');
    expect(event?.keyframes[0]).toMatchObject({ eventName: 'hello', payload: 'Spine imported' });
  });
  it('imports 4.3 grid meshes without changing vertex/UV/triangle or sparse Deform indices', () => {
    const raw = grid43(),
      imported = importSpineJson(JSON.stringify(raw));
    const mesh = imported.document.skeleton.attachments[0]!;
    expect(mesh.meshVertices?.length).toBe(2146);
    expect(mesh.meshUVs).toEqual(raw.skins[0]!.attachments.panel.panel.uvs);
    expect(mesh.meshTriangles).toEqual(raw.skins[0]!.attachments.panel.panel.triangles);
    expect(mesh.meshHull?.length).toBe(128);
    expect(imported.warnings[0]).toMatch(/128 vertices; export declared 1073/);
    const k = raw.animations.idle.attachments.default.panel.panel.deform[1]!;
    const track = imported.document.animations[0]!.timelines[0]!;
    if (track.kind !== 'deform') throw new Error('Missing Deform');
    expect(track.keyframes[1]!.offsets?.slice(k.offset!, k.offset! + 3)).toEqual([-15, 18, 12]);
    const atlas = new spine.TextureAtlas('test.png\nsize: 8,8\npanel\nbounds: 0,0,8,8\n');
    // The shared rotate/scale/mesh/Deform subset was also reviewed in the
    // official 4.3 reader. The pinned test runtime independently checks poses.
    const official = new spine.Skeleton(
      new spine.SkeletonJson(new spine.AtlasAttachmentLoader(atlas)).readSkeletonData(raw),
    );
    for (const animation of imported.document.animations)
      for (const time of [0, 0.15, 0.3, 0.6, 1, 1.5, 2]) {
        const native = new Skeleton(imported.document.skeleton);
        for (const t of animation.timelines) applyTimeline(t, native, time, 0, 1, null, animation.name);
        solveFK(native.data, native.boneIndexMap, native.pose);
        updateSkinning(native);
        official.setToSetupPose();
        official.data
          .findAnimation(animation.name)!
          .apply(official, 0, time, false, [], 1, spine.MixBlend.replace, spine.MixDirection.mixIn);
        official.updateWorldTransform(spine.Physics.none);
        const attachment = official.slots[0]!.getAttachment() as spine.MeshAttachment,
          output = new Float32Array(attachment.worldVerticesLength);
        attachment.computeWorldVertices(official.slots[0]!, 0, output.length, output, 0, 2);
        const actual = native.pose.attachments.get(mesh.id)!.verts;
        for (let i = 0; i < actual.length; i++)
          expect(actual[i]).toBeCloseTo(i % 2 ? -output[i]! : output[i]!, 3);
      }
  });
  it.each(['constraints', 'sliders', 'folders'])('does not silently ignore 4.3 %s', (field) => {
    const raw = { ...grid43(2, 2), [field]: [{ name: 'unsupported' }] };
    expect(() => importSpineJson(JSON.stringify(raw))).toThrow(new RegExp(`${field} is not supported`));
  });
  it('rejects invalid triangles even when hull metadata is repaired', () => {
    const raw = grid43(2, 2);
    raw.skins[0]!.attachments.panel.panel.triangles[0] = 99;
    expect(() => importSpineJson(JSON.stringify(raw))).toThrow(/in-range/);
  });
  it('preserves static inclusive clipping ends and rejects order changes that alter their boundary', () => {
    const raw = structuredClone(source);
    // A clip through its starting slot stops before the next native slot.
    Object.assign(raw.skins[0]!.attachments.badge!.badge, {
      type: 'clipping',
      end: 'badge',
      vertexCount: 3,
      vertices: [0, 0, 10, 0, 0, 10],
    });
    expect(() => load(raw)).toThrow(/finite clipping ends with draw-order/);
    Object.assign(raw.skins[0]!.attachments.badge!.badge, { end: 'mesh' });
    expect(() => load(raw)).toThrow(/finite clipping ends with draw-order/);
    Object.assign(raw.skins[0]!.attachments.badge!.badge, { end: 'badge' });
    delete (raw.animations.wave as { drawOrder?: unknown }).drawOrder;
    const imported = load(raw).document.skeleton;
    expect(imported.attachments.find((a) => a.type === 'clipping')?.endSlotId).toBe(imported.slots[1]!.id);
    Object.assign(raw.skins[0]!.attachments.badge!.badge, { end: 'mesh' });
    Object.assign(raw.skins[0]!.attachments.mesh!.patch, {
      type: 'clipping',
      vertexCount: 3,
      vertices: [0, 0, 10, 0, 0, 10],
    });
    expect(() => load(raw)).toThrow(/Overlapping clipping/);
  });
  it.each([
    ['constraint', (r: typeof source) => Object.assign(r, { ik: [{ name: 'ik' }] }), /ik is not supported/],
    ['inheritance', (r: typeof source) => Object.assign(r.bones[1]!, { inherit: 'noScale' }), /inheritance/],
    ['shear', (r: typeof source) => Object.assign(r.bones[1]!, { shearX: 12 }), /shear/],
    ['old version', (r: typeof source) => (r.skeleton.spine = '3.8.99'), /4.2/],
    ['missing attachment', (r: typeof source) => (r.slots[1]!.attachment = 'missing'), /Missing attachment/],
    [
      'bind mismatch',
      (r: typeof source) => {
        r.skins[0]!.attachments.mesh!.patch.vertices[7] = 10;
      },
      /per-influence bind/,
    ],
    [
      'independent deform',
      (r: typeof source) => {
        r.animations.wave.attachments.default.mesh.patch.deform[1]!.vertices![4] = 30;
      },
      /per-influence deformation/,
    ],
  ])('rejects %s before replacing any project', (_, mutate, pattern) => {
    const raw = structuredClone(source);
    mutate(raw);
    expect(() => load(raw)).toThrow(pattern);
  });
  it('reads modern multipage and legacy rotated/trimmed atlas regions', () => {
    const modern = parseSpineAtlas(readFileSync('fixtures/spine-import/atlas.atlas', 'utf8'));
    expect(modern[1]).toMatchObject({
      page: 'page.png',
      rotation: 90,
      originalWidth: 4,
      originalHeight: 6,
      width: 2,
      height: 4,
      offsetX: 1,
      offsetY: 1,
    });
    const legacy = parseSpineAtlas(
      'one.png\npma: true\npart\n rotate: true\n xy: 1, 2\n size: 2, 4\n orig: 4, 6\n offset: 1, 1\n\ntwo.png\nother\nbounds: 0, 0, 4, 4',
    );
    expect(legacy[0]).toMatchObject({ pma: true, rotation: 90, page: 'one.png' });
    expect(legacy[1]).toMatchObject({ pma: false, page: 'two.png' });
    expect(() => parseSpineAtlas('p.png\npart\nbounds: 0,0,3,3\npart\nbounds: 0,0,3,3')).toThrow(/Duplicate/);
  });
});
