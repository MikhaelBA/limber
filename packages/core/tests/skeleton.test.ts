import { describe, expect, it } from 'vitest';
import { Skeleton, type AttachmentData, type IKConstraintData, type SlotData } from '@limber/core';
import { makeBone, makeSkeletonData } from './helpers';

const makeSlot = (id: string, boneId: string, attachmentId: string | null = null): SlotData => ({
  id,
  name: id,
  boneId,
  defaultAttachmentId: attachmentId,
  color: 0xff0000ff,
});

const makeAttachment = (id: string, weights?: number[]): AttachmentData => ({
  id,
  name: id,
  type: 'region',
  textureId: 'tex1',
  vertices: [-10, -10, 10, -10, 10, 10, -10, 10],
  uvs: [0, 0, 1, 0, 1, 1, 0, 1],
  weights,
});

describe('Skeleton construction & validation', () => {
  it('validates inactive skins and rejects ambiguous skin or attachment identities', () => {
    const data = makeSkeletonData([makeBone('root', null)]);
    data.skins.push({ name: 'inactive', attachments: { missing: 'missing' } });
    expect(() => new Skeleton(structuredClone(data))).toThrow(/unknown slotId/);
    data.slots.push(makeSlot('slot', 'root'));
    data.skins[0]!.attachments = { slot: 'missing' };
    expect(() => new Skeleton(structuredClone(data))).toThrow(/unknown attachmentId/);
    data.attachments.push(makeAttachment('att'));
    data.skins[0]!.attachments = { slot: 'att' };
    expect(() => new Skeleton(structuredClone(data))).not.toThrow();
    data.skins.push({ name: 'inactive', attachments: {} });
    expect(() => new Skeleton(structuredClone(data))).toThrow(/unique and nonempty/);
    data.skins.pop();
    data.attachments.push(makeAttachment('att'));
    expect(() => new Skeleton(structuredClone(data))).toThrow(/Duplicate attachment/);
  });

  it('sorts bones topologically and bakes index maps', () => {
    const sk = new Skeleton(
      makeSkeletonData([makeBone('grandchild', 'child'), makeBone('child', 'root'), makeBone('root', null)]),
    );
    expect(sk.data.bones.map((b) => b.id)).toEqual(['root', 'child', 'grandchild']);
    expect(sk.boneIndexMap.get('root')).toBe(0);
    expect(sk.boneIndexMap.get('child')).toBe(1);
    expect(sk.boneIndexMap.get('grandchild')).toBe(2);
  });

  it('initializes the pose from the setup pose', () => {
    const sk = new Skeleton(makeSkeletonData([makeBone('root', null, { x: 3, y: 4 })]));
    expect(sk.pose.bones[0]!.local).toEqual({
      x: 3,
      y: 4,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      shearX: 0,
      shearY: 0,
    });
    expect(sk.pose.worldMatrices.length).toBe(6);
  });

  it('throws on duplicate bone ids', () => {
    expect(() => new Skeleton(makeSkeletonData([makeBone('a', null), makeBone('a', null)]))).toThrow(
      /Duplicate bone id/,
    );
  });

  it('throws on unknown slot boneId', () => {
    const data = makeSkeletonData([makeBone('root', null)]);
    data.slots.push(makeSlot('slot', 'ghost'));
    expect(() => new Skeleton(data)).toThrow(/unknown boneId "ghost"/);
  });

  it('throws on unknown slot defaultAttachmentId', () => {
    const data = makeSkeletonData([makeBone('root', null)]);
    data.slots.push(makeSlot('slot', 'root', 'ghost-att'));
    expect(() => new Skeleton(data)).toThrow(/unknown defaultAttachmentId/);
  });

  it('throws on IK constraints referencing unknown bones', () => {
    const data = makeSkeletonData([makeBone('root', null)]);
    const ik: IKConstraintData = {
      id: 'ik1',
      bones: ['root'],
      targetId: 'ghost',
      poleVectorId: null,
      bendDirection: 1,
      mix: 1,
      softness: 0,
      order: 0,
    };
    data.ikConstraints.push(ik);
    expect(() => new Skeleton(data)).toThrow(/unknown boneId "ghost"/);
  });

  it('throws on IK constraints controlling more than 2 bones', () => {
    const data = makeSkeletonData([makeBone('a', null), makeBone('b', 'a'), makeBone('c', 'b')]);
    data.ikConstraints.push({
      id: 'ik1',
      bones: ['a', 'b', 'c'],
      targetId: 'c',
      poleVectorId: null,
      bendDirection: 1,
      mix: 1,
      softness: 0,
      order: 0,
    });
    expect(() => new Skeleton(data)).toThrow(/must control 1 or 2 bones/);
  });

  it('sorts ikConstraints by order', () => {
    const data = makeSkeletonData([makeBone('a', null), makeBone('b', 'a')]);
    const mk = (id: string, order: number): IKConstraintData => ({
      id,
      bones: ['a'],
      targetId: 'b',
      poleVectorId: null,
      bendDirection: 1,
      mix: 1,
      softness: 0,
      order,
    });
    data.ikConstraints.push(mk('second', 5), mk('first', 1));
    const sk = new Skeleton(data);
    expect(sk.data.ikConstraints.map((c) => c.id)).toEqual(['first', 'second']);
  });

  it('throws on weight bone indices out of range', () => {
    const data = makeSkeletonData([makeBone('root', null)]);
    data.attachments.push(makeAttachment('att', [1, 7, 1])); // bone index 7 does not exist
    expect(() => new Skeleton(data)).toThrow(/out of range/);
  });

  it('throws on truncated interleaved weights', () => {
    const data = makeSkeletonData([makeBone('root', null)]);
    data.attachments.push(makeAttachment('att', [2, 0, 0.5])); // count 2, only one pair
    expect(() => new Skeleton(data)).toThrow(/malformed weights/);
  });

  it('throws on unknown activeSkin', () => {
    const data = makeSkeletonData([makeBone('root', null)]);
    data.skins.push({ name: 'default', attachments: {} });
    data.activeSkin = 'nonexistent';
    expect(() => new Skeleton(data)).toThrow(/activeSkin "nonexistent" not found/);
  });
});

describe('resetPose (pipeline step 1)', () => {
  it('restores setup pose for all bones', () => {
    const sk = new Skeleton(
      makeSkeletonData([
        makeBone('root', null, { x: 1, y: 2 }),
        makeBone('child', 'root', { rotation: 0.5 }),
      ]),
    );
    sk.pose.bones[0]!.local.x = 99;
    sk.pose.bones[1]!.local.rotation = 42;
    sk.resetToSetupPose();
    expect(sk.pose.bones[0]!.local.x).toBe(1);
    expect(sk.pose.bones[1]!.local.rotation).toBe(0.5);
  });

  it('resets slots to skin defaults — active skin overrides the slot default', () => {
    const data = makeSkeletonData([makeBone('root', null)]);
    data.attachments.push(makeAttachment('att1'), makeAttachment('att2'));
    data.slots.push(makeSlot('slotA', 'root', 'att1'));
    data.skins.push({ name: 'armor', attachments: { slotA: 'att2' } });

    const skinned = new Skeleton(data);
    skinned.data.activeSkin = 'armor';
    skinned.rebuild(); // normalize() re-validates with the new active skin
    skinned.resetToSetupPose();
    expect(skinned.pose.slots[0]!.attachmentId).toBe('att2');

    const unskinned = new Skeleton(data);
    unskinned.data.activeSkin = '';
    unskinned.rebuild();
    unskinned.resetToSetupPose();
    expect(unskinned.pose.slots[0]!.attachmentId).toBe('att1');
  });

  it('restores the default draw order after swapping', () => {
    const data = makeSkeletonData([makeBone('root', null)]);
    data.attachments.push(makeAttachment('att1'));
    data.slots.push(makeSlot('a', 'root', 'att1'), makeSlot('b', 'root', 'att1'));
    const sk = new Skeleton(data);
    sk.pose.slotOrder = [1, 0];
    sk.resetToSetupPose();
    expect(sk.pose.slotOrder).toEqual([0, 1]);
  });
});

describe('Skeleton.rebuild (structural edits)', () => {
  it('shifts indices, preserves the current pose BY BONE ID, and starts new bones at setup', () => {
    const data = makeSkeletonData([makeBone('root', null), makeBone('child', 'root', { x: 5 })]);
    const sk = new Skeleton(data);

    // Animate the child away from setup.
    sk.pose.bones[1]!.local.x = 99;
    sk.pose.bones[1]!.local.rotation = 1.234;

    // Structural edit: a NEW root inserted at the front of the unsorted array.
    data.bones.unshift(makeBone('newRoot', null, { x: -50 }));

    sk.rebuild();

    // New index space: newRoot=0, root=1, child=2.
    expect(sk.data.bones.map((b) => b.id)).toEqual(['newRoot', 'root', 'child']);
    expect(sk.boneIndexMap.get('child')).toBe(2);
    expect(sk.pose.bones.length).toBe(3);
    expect(sk.pose.worldMatrices.length).toBe(18);

    // The visible pose survived by id — child is still animated.
    expect(sk.pose.bones[2]!.local.x).toBe(99);
    expect(sk.pose.bones[2]!.local.rotation).toBe(1.234);
    // The new bone starts at its setup pose.
    expect(sk.pose.bones[0]!.local.x).toBe(-50);
  });

  it('re-maps attachment weight bone indices to the new index space', () => {
    const data = makeSkeletonData([makeBone('root', null), makeBone('child', 'root')]);
    const att = makeAttachment('meshAtt', [2, 0, 0.7, 1, 0.3]); // vertex: root 0.7 + child 0.3
    data.attachments.push(att);
    const sk = new Skeleton(data);
    expect(sk.data.attachments[0]!.weights).toEqual([2, 0, 0.7, 1, 0.3]);

    // Insert a new root — every existing index shifts by one.
    data.bones.unshift(makeBone('newRoot', null));
    sk.rebuild();

    // Same bones (root now index 1, child now index 2), same weights.
    expect(sk.data.attachments[0]!.weights).toEqual([2, 1, 0.7, 2, 0.3]);
  });

  it('re-maps weights to the same bone even when the sort reorders siblings', () => {
    const data = makeSkeletonData([makeBone('a', null), makeBone('b', null)]);
    const att = makeAttachment('att', [1, 1, 1]); // rigid to bone 'b' (index 1)
    data.attachments.push(att);
    const sk = new Skeleton(data);

    // Remove 'a' — 'b' moves from index 1 to index 0.
    data.bones = data.bones.filter((b) => b.id !== 'a');
    sk.rebuild();

    expect(sk.data.bones.map((b) => b.id)).toEqual(['b']);
    expect(sk.data.attachments[0]!.weights).toEqual([1, 0, 1]);
  });

  it('throws when weights reference a bone that was removed', () => {
    const data = makeSkeletonData([makeBone('a', null), makeBone('b', 'a')]);
    data.attachments.push(makeAttachment('att', [1, 0, 1])); // bound to 'a'
    const sk = new Skeleton(data);

    // Reparent b to root and remove 'a' — the weighted bone disappears.
    const b = data.bones.find((bone) => bone.id === 'b')!;
    b.parentId = null;
    data.bones = data.bones.filter((bone) => bone.id !== 'a');
    expect(() => sk.rebuild()).toThrow(/no longer exists/);
  });
});
