import type { SkeletonData } from '../types/data';
import type { SkeletonPose } from '../types/pose';

/**
 * Allocates a fresh pose for `data` (topologically parallel arrays) and resets
 * it to the setup/skin defaults. The returned object is reused by Skeleton —
 * callers never rebuild it per frame.
 */
export function createPose(data: SkeletonData): SkeletonPose {
  const pose: SkeletonPose = {
    bones: data.bones.map((bone) => ({ local: { ...bone.setupPose } })),
    slots: data.slots.map(() => ({ attachmentId: null, color: 0xffffffff })),
    slotOrder: data.slots.map((_, i) => i),
    worldMatrices: new Float32Array(data.bones.length * 6),
  };
  resetPose(data, pose);
  return pose;
}

/**
 * Pipeline step 1 (DESIGN.md §4.3): reset local transforms to the setup pose,
 * slots to their skin defaults, and draw order to the skeleton default.
 *
 * Runs EVERY frame before animations are applied. No per-bone "was animated"
 * flags — they are unreliable once multiple animations mix, and this loop is
 * nearly free.
 */
export function resetPose(data: SkeletonData, pose: SkeletonPose): void {
  for (let i = 0; i < data.bones.length; i++) {
    const setup = data.bones[i]!.setupPose;
    const local = pose.bones[i]!.local;
    local.x = setup.x;
    local.y = setup.y;
    local.rotation = setup.rotation;
    local.scaleX = setup.scaleX;
    local.scaleY = setup.scaleY;
    local.shearX = setup.shearX;
    local.shearY = setup.shearY;
  }

  const skin = data.activeSkin === '' ? undefined : data.skins.find((s) => s.name === data.activeSkin);
  for (let i = 0; i < data.slots.length; i++) {
    const slot = data.slots[i]!;
    const slotPose = pose.slots[i]!;
    slotPose.attachmentId = skin?.attachments[slot.id] ?? slot.defaultAttachmentId;
    slotPose.color = slot.color;
  }

  for (let i = 0; i < pose.slotOrder.length; i++) {
    pose.slotOrder[i] = i;
  }
}
