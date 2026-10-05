import { describe, expect, it } from 'vitest';
import type { AttachmentData, SkeletonData } from '../src/types/data';
import { createPose, resetPose } from '../src/skeleton/pose';
import { solveFK } from '../src/skeleton/FKSolver';
import { Skeleton } from '../src/skeleton/Skeleton';
import { computeAttachmentVertices, updateSkinning } from '../src/skeleton/skinning';
import { applyTimeline } from '../src/animation/applyTimeline';
import type { DeformTimeline } from '../src/types/animation';

function makeData(attachments: AttachmentData[] = []): SkeletonData {
  return {
    bones: [
      { id: 'a', name: 'a', parentId: null, length: 50, setupPose: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 } },
      { id: 'b', name: 'b', parentId: null, length: 50, setupPose: { x: 100, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 } },
    ],
    slots: [{ id: 's', name: 's', boneId: 'a', defaultAttachmentId: 'att', color: 0xffffffff }],
    attachments,
    ikConstraints: [],
    skins: [],
    activeSkin: '',
  };
}

function regionAttachment(partial: Partial<AttachmentData>): AttachmentData {
  return { id: 'att', name: 'r', type: 'region', textureId: 't', vertices: [0, 0, 10, 0, 10, 10, 0, 10], uvs: [0, 0, 1, 0, 1, 1, 0, 1], ...partial };
}

describe('computeAttachmentVertices', () => {
  it('rigid: transforms setup vertices by the slot bone world matrix', () => {
    const att = regionAttachment({});
    const data = makeData([att]);
    const skeleton = new Skeleton(data);
    solveFK(data, skeleton.boneIndexMap, skeleton.pose);

    // Move bone 'a' to (10, 20) with scaleX 2.
    skeleton.pose.bones[0]!.local.x = 10;
    skeleton.pose.bones[0]!.local.y = 20;
    skeleton.pose.bones[0]!.local.scaleX = 2;
    solveFK(data, skeleton.boneIndexMap, skeleton.pose);

    const state = skeleton.pose.attachments.get('att')!;
    computeAttachmentVertices(att, 0, skeleton.pose.worldMatrices, state);
    // local (0,0) -> (10,20); local (10,0) -> (10+20, 20); local (10,10) -> (30, 30).
    expect([...state.verts]).toEqual([10, 20, 30, 20, 30, 30, 10, 30]);
  });

  it('weighted: 50/50 between two translated bones lands at the midpoint', () => {
    // a=0, b=100 in the index space. Vertex (0,0): 50% bone a, 50% bone b.
    // Per vertex: count=2, [boneA 0.5, boneB 0.5] — weights sum to 1.
    const att = regionAttachment({ weights: [2, 0, 0.5, 1, 0.5, 2, 0, 0.5, 1, 0.5, 2, 0, 0.5, 1, 0.5, 2, 0, 0.5, 1, 0.5] });
    const data = makeData([att]);
    const skeleton = new Skeleton(data);
    solveFK(data, skeleton.boneIndexMap, skeleton.pose);

    const state = skeleton.pose.attachments.get('att')!;
    computeAttachmentVertices(att, 0, skeleton.pose.worldMatrices, state);
    // Every vertex: 0.5*(x,y) + 0.5*(x+100,y) = (x+50, y).
    expect([...state.verts]).toEqual([50, 0, 60, 0, 60, 10, 50, 10]);
  });

  it('weighted: uneven weights lean toward the heavier bone', () => {
    // Vertex (0,0): 25% a, 75% b -> x = 0.25*0 + 0.75*100 = 75.
    const att = regionAttachment({ weights: [2, 0, 0.25, 1, 0.75] });
    const data = makeData([att]);
    const skeleton = new Skeleton(data);
    solveFK(data, skeleton.boneIndexMap, skeleton.pose);
    const state = skeleton.pose.attachments.get('att')!;
    computeAttachmentVertices(att, 0, skeleton.pose.worldMatrices, state);
    expect(state.verts[0]).toBeCloseTo(75, 6);
  });
});

describe('updateSkinning (pipeline step)', () => {
  it('skins the ACTIVE attachment of each slot into the pose cache', () => {
    const att = regionAttachment({});
    const data = makeData([att]);
    const skeleton = new Skeleton(data);
    data.bones[0]!.setupPose.x = 40; // Animations write pose.local; resetPose restores setup.
    solveFK(data, skeleton.boneIndexMap, skeleton.pose);

    resetPose(data, skeleton.pose);
    solveFK(data, skeleton.boneIndexMap, skeleton.pose);
    updateSkinning(skeleton);

    const state = skeleton.pose.attachments.get('att')!;
    expect(state.verts[0]).toBe(40); // local (0,0) under bone a moved to x=40
    expect(state.verts[2]).toBe(50); // local (10,0)
  });
});

describe('DeformTimeline (applyTimeline)', () => {
  function deformEngine() {
    const att = regionAttachment({});
    const data = makeData([att]);
    const skeleton = new Skeleton(data);
    return { data, skeleton, att };
  }

  it('applies and linearly interpolates per-vertex offsets', () => {
    const { skeleton } = deformEngine();
    const tl: DeformTimeline = {
      kind: 'deform',
      attachmentId: 'att',
      keyframes: [
        { time: 0, offsets: [10, 0, 10, 0, 10, 0, 10, 0], curve: { type: 'linear' } },
        { time: 1, offsets: [30, 0, 30, 0, 30, 0, 30, 0], curve: { type: 'linear' } },
      ],
    };
    applyTimeline(tl, skeleton, 0.5, 0, 1, null, 'anim');
    const state = skeleton.pose.attachments.get('att')!;
    expect(state.deformed).toBe(true);
    expect([...state.deform]).toEqual([20, 0, 20, 0, 20, 0, 20, 0]);
  });

  it('null offsets mean setup mesh (treated as zeros)', () => {
    const { skeleton } = deformEngine();
    const tl: DeformTimeline = {
      kind: 'deform',
      attachmentId: 'att',
      keyframes: [
        { time: 0, offsets: null, curve: { type: 'linear' } },
        { time: 1, offsets: [8, 8, 8, 8, 8, 8, 8, 8], curve: { type: 'linear' } },
      ],
    };
    applyTimeline(tl, skeleton, 0.5, 0, 1, null, 'anim');
    expect([...skeleton.pose.attachments.get('att')!.deform]).toEqual([4, 4, 4, 4, 4, 4, 4, 4]);
  });

  it('before the first key the setup pose is kept', () => {
    const { skeleton } = deformEngine();
    const tl: DeformTimeline = {
      kind: 'deform',
      attachmentId: 'att',
      keyframes: [{ time: 1, offsets: [5, 5, 5, 5, 5, 5, 5, 5], curve: { type: 'linear' } }],
    };
    applyTimeline(tl, skeleton, 0.5, 0, 1, null, 'anim');
    expect(skeleton.pose.attachments.get('att')!.deformed).toBe(false);
  });

  it('deform offsets feed the skinning output (v + deform, then bone matrix)', () => {
    const { data, skeleton, att } = deformEngine();
    const tl: DeformTimeline = {
      kind: 'deform',
      attachmentId: 'att',
      keyframes: [{ time: 0, offsets: [10, 0, 10, 0, 10, 0, 10, 0], curve: { type: 'linear' } }],
    };
    applyTimeline(tl, skeleton, 0, 0, 1, null, 'anim');
    solveFK(data, skeleton.boneIndexMap, skeleton.pose);
    updateSkinning(skeleton);
    const state = skeleton.pose.attachments.get('att')!;
    // Vertex 0: local (0,0) + deform (10,0) -> world (10,0).
    expect(state.verts[0]).toBe(10);
    expect(state.verts[1]).toBe(0);
  });

  it('resetPose clears deform state for the next frame', () => {
    const { data, skeleton } = deformEngine();
    const tl: DeformTimeline = {
      kind: 'deform',
      attachmentId: 'att',
      keyframes: [{ time: 0, offsets: [7, 7, 7, 7, 7, 7, 7, 7], curve: { type: 'linear' } }],
    };
    applyTimeline(tl, skeleton, 0, 0, 1, null, 'anim');
    resetPose(data, skeleton.pose);
    const state = skeleton.pose.attachments.get('att')!;
    expect(state.deformed).toBe(false);
    expect([...state.deform]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('createPose allocates cache parallel to each attachment vertex data', () => {
    const data = makeData();
    data.attachments.push(regionAttachment({ id: 'r8', meshVertices: undefined }));
    data.attachments.push({
      id: 'm12',
      name: 'm',
      type: 'mesh',
      textureId: 't',
      meshVertices: new Array(12).fill(1),
      meshTriangles: [0, 1, 2],
      meshUVs: new Array(12).fill(0),
    });
    const pose = createPose(data);
    expect(pose.attachments.get('r8')!.verts).toHaveLength(8);
    expect(pose.attachments.get('m12')!.verts).toHaveLength(12);
  });
});
