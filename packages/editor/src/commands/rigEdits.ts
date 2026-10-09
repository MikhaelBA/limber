import { Skeleton, type Animation, type SkeletonData } from '@limber/core';
import type { EditorEngine } from '../engine/EditorEngine';

export interface RigSnapshot {
  skeleton: SkeletonData;
  animations: Animation[];
}

export function captureRig(engine: EditorEngine): RigSnapshot {
  return structuredClone({ skeleton: engine.skeleton.data, animations: engine.document.animations });
}

/** Structural edits must also preserve references outside the Skeleton wrapper. */
function validateRigReferences(snapshot: RigSnapshot): void {
  const { skeleton: data, animations } = snapshot;
  const bones = new Set(data.bones.map((bone) => bone.id));
  const slots = new Set(data.slots.map((slot) => slot.id));
  const attachments = new Set(data.attachments.map((attachment) => attachment.id));
  for (const bone of data.bones) {
    if (
      !Number.isFinite(bone.length) ||
      bone.length < 0 ||
      Object.values(bone.setupPose).some((value) => !Number.isFinite(value))
    ) {
      throw new Error(`Bone "${bone.name}" has an invalid setup transform or length.`);
    }
  }
  for (const attachment of data.attachments) {
    if (attachment.type === 'clipping' && attachment.endSlotId != null && !slots.has(attachment.endSlotId)) {
      throw new Error(`Clipping attachment "${attachment.name}" references an unknown end slot.`);
    }
  }
  for (const animation of animations) {
    for (const timeline of animation.timelines) {
      if (timeline.kind === 'boneProperty' && !bones.has(timeline.boneId)) {
        throw new Error(`Animation "${animation.name}" references an unknown bone.`);
      }
      if (
        (timeline.kind === 'slotAttachment' || timeline.kind === 'slotColor') &&
        !slots.has(timeline.slotId)
      ) {
        throw new Error(`Animation "${animation.name}" references an unknown slot.`);
      }
      if (timeline.kind === 'deform' && !attachments.has(timeline.attachmentId)) {
        throw new Error(`Animation "${animation.name}" references an unknown deform attachment.`);
      }
      if (
        timeline.kind === 'slotAttachment' &&
        timeline.keyframes.some((key) => key.attachmentId !== null && !attachments.has(key.attachmentId))
      ) {
        throw new Error(`Animation "${animation.name}" references an unknown attachment.`);
      }
      if (
        timeline.kind === 'drawOrder' &&
        timeline.keyframes.some(
          (key) =>
            key.slotOrder.length !== slots.size ||
            new Set(key.slotOrder).size !== slots.size ||
            key.slotOrder.some((index) => !Number.isInteger(index) || index < 0 || index >= slots.size),
        )
      ) {
        throw new Error(`Animation "${animation.name}" has an invalid draw-order permutation.`);
      }
    }
  }
}

export function prepareRigEdit(
  engine: EditorEngine,
  edit: (data: SkeletonData, animations: Animation[]) => void,
): RigSnapshot {
  const snapshot = captureRig(engine);
  const draft = new Skeleton(snapshot.skeleton);
  edit(draft.data, snapshot.animations);
  draft.rebuild(); // Remap surviving weights from the pre-edit index space, only on the draft.
  validateRigReferences(snapshot);
  return snapshot;
}

export function applyRigSnapshot(engine: EditorEngine, snapshot: RigSnapshot): void {
  validateRigReferences(snapshot);
  // Structural commands do not create/remove/rename animation clips. Keep each
  // object alive: AnimationState and earlier metadata commands reference it.
  const animations = structuredClone(snapshot.animations);
  if (
    animations.length !== engine.document.animations.length ||
    animations.some((anim, index) => anim.name !== engine.document.animations[index]!.name)
  ) {
    throw new Error('Rig snapshot belongs to a different animation library.');
  }
  const oldSlots = new Map(engine.skeleton.data.slots.map((item) => [item.id, item]));
  const oldAttachments = new Map(engine.skeleton.data.attachments.map((item) => [item.id, item]));
  engine.skeleton.replaceData(snapshot.skeleton);
  // Existing commands and callers may retain slot/attachment objects. Preserve
  // surviving identities after validation, just as animation objects below.
  const retain = <T extends { id: string }>(next: T, old: Map<string, T>): T => {
    const existing = old.get(next.id);
    if (!existing) return next;
    for (const key of Object.keys(existing))
      if (!(key in next)) delete (existing as Record<string, unknown>)[key];
    return Object.assign(existing, next);
  };
  engine.skeleton.data.slots = engine.skeleton.data.slots.map((item) => retain(item, oldSlots));
  engine.skeleton.data.attachments = engine.skeleton.data.attachments.map((item) =>
    retain(item, oldAttachments),
  );
  engine.skeleton.attachmentById.clear();
  for (const item of engine.skeleton.data.attachments) engine.skeleton.attachmentById.set(item.id, item);
  engine.document.animations.forEach((anim, index) => Object.assign(anim, animations[index]));
}

export function editRig(
  engine: EditorEngine,
  edit: (data: SkeletonData, animations: Animation[]) => void,
): void {
  applyRigSnapshot(engine, prepareRigEdit(engine, edit));
}
