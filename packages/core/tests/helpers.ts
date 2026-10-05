import type { BoneData, SkeletonData, Transform } from '@sprine/core';

export function makeBone(id: string, parentId: string | null, t: Partial<Transform> = {}): BoneData {
  return {
    id,
    name: id,
    parentId,
    length: 0,
    setupPose: {
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      shearX: 0,
      shearY: 0,
      ...t,
    },
  };
}

export function makeSkeletonData(bones: BoneData[]): SkeletonData {
  return {
    bones,
    slots: [],
    attachments: [],
    ikConstraints: [],
    skins: [],
    activeSkin: '',
  };
}
