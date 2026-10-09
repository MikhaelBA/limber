import type { AttachmentData, SkeletonData } from '../types/data';
import type { AttachmentPoseState, SkeletonPose } from '../types/pose';

/** Number of local-space floats an attachment's vertex data uses (0 = none). */
export function attachmentVertexCount(a: AttachmentData): number {
  // Regions carry their quad in `vertices`; every other type (mesh, bounding
  // box, clipping) is a polygon in `meshVertices`.
  const local = a.type === 'region' ? a.vertices : a.meshVertices;
  return local ? local.length : 0;
}

function allocateAttachmentStates(data: SkeletonData): Map<string, AttachmentPoseState> {
  const map = new Map<string, AttachmentPoseState>();
  for (const a of data.attachments) {
    const n = attachmentVertexCount(a);
    if (n > 0) {
      const state: AttachmentPoseState = { verts: new Float32Array(n), deform: new Float32Array(n), deformed: false };
      if (a.boneBindings) {
        state.bindMatrices = new Float64Array(data.bones.length * 6);
        state.skinMatrices = new Float64Array(data.bones.length * 6);
        const indices = new Map(data.bones.map((bone, index) => [bone.id, index]));
        for (const binding of a.boneBindings) state.bindMatrices.set(binding.matrix, indices.get(binding.boneId)! * 6);
      }
      map.set(a.id, state);
    }
  }
  return map;
}

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
    attachments: allocateAttachmentStates(data),
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

  // Deform offsets are animation output — back to the setup mesh (Phase 5).
  for (const state of pose.attachments.values()) {
    state.deform.fill(0);
    state.deformed = false;
  }
}
