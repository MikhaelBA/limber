import type { AttachmentData, IKConstraintData, SkeletonData } from '../types/data';
import type { BonePose, SkeletonPose, SlotPose } from '../types/pose';
import { createPose, resetPose } from './pose';
import { topologicalSortBones } from './topologicalSort';

/**
 * Runtime wrapper: data (the rig definition, mutated only by editor commands)
 * + pose (mutable, per-frame state). One SkeletonData may back many Skeleton
 * instances (editor preview, runtime players) — DESIGN.md §4.1.
 */
export class Skeleton {
  readonly data: SkeletonData;
  readonly pose: SkeletonPose;
  /** boneId -> topological index. Editor-side lookups only — never inside the FK loop. */
  readonly boneIndexMap: Map<string, number> = new Map();
  readonly slotIndexMap: Map<string, number> = new Map();
  /** attachmentId -> attachment. Baked with the other maps; used by the skinning step. */
  readonly attachmentById: Map<string, AttachmentData> = new Map();

  constructor(data: SkeletonData) {
    this.data = data;
    this.normalize();
    this.pose = createPose(data);
  }

  /** Convenience for pipeline step 1 (DESIGN.md §4.3). */
  resetToSetupPose(): void {
    resetPose(this.data, this.pose);
  }

  /**
   * Call after ANY structural command (add/remove/reparent bone, slot or IK
   * edits): re-sorts bones topologically (indices shift!), rebuilds index maps,
   * re-allocates the pose copying current values over BY BONE ID (the visible
   * pose survives), and re-maps attachment weight bone indices to the new index
   * space — DESIGN.md §4.1.
   */
  rebuild(): void {
    // Snapshot the OLD index space before normalize() re-sorts the bones array.
    const oldIndexToId: string[] = [];
    const prevBonePoseById = new Map<string, BonePose>();
    const prevSlotPoseById = new Map<string, SlotPose>();
    for (const [id, index] of this.boneIndexMap) {
      oldIndexToId[index] = id;
      prevBonePoseById.set(id, this.pose.bones[index]!);
    }
    for (const [id, index] of this.slotIndexMap) {
      prevSlotPoseById.set(id, this.pose.slots[index]!);
    }

    // Sort/bake first, then remap weights to the new index space, and only THEN
    // validate — weight indices from the old index space would fail validation
    // before remapAttachmentWeights gets a chance to translate them.
    this.sortAndBakeMaps();
    this.remapAttachmentWeights(oldIndexToId);
    this.validate();

    // Fresh pose; carry current values over by id so the visible pose survives.
    const pose = createPose(this.data);
    for (let i = 0; i < this.data.bones.length; i++) {
      const bone = this.data.bones[i]!;
      const prev = prevBonePoseById.get(bone.id);
      if (prev) pose.bones[i]!.local = { ...prev.local };
    }
    for (let i = 0; i < this.data.slots.length; i++) {
      const slot = this.data.slots[i]!;
      const prev = prevSlotPoseById.get(slot.id);
      if (prev) {
        pose.slots[i]!.attachmentId = prev.attachmentId;
        pose.slots[i]!.color = prev.color;
      }
    }
    // Swap contents in place — `pose` stays a readonly reference holders can keep.
    this.pose.bones = pose.bones;
    this.pose.slots = pose.slots;
    this.pose.slotOrder = pose.slotOrder;
    this.pose.worldMatrices = pose.worldMatrices;
    // Attachment vertex/deform caches are per-frame output — fresh allocation,
    // nothing to carry across a structural change.
    this.pose.attachments = pose.attachments;
  }

  /**
   * Sorts bones topologically in place (the array order IS the index space),
   * sorts IK constraints by `order`, and bakes the id -> index maps.
   * No validation — callers decide when to run validate().
   */
  private sortAndBakeMaps(): void {
    const sorted = topologicalSortBones(this.data.bones);
    this.data.bones.length = 0;
    this.data.bones.push(...sorted);

    this.data.ikConstraints = [...this.data.ikConstraints].sort(
      (a: IKConstraintData, b: IKConstraintData) => a.order - b.order,
    );

    this.boneIndexMap.clear();
    for (let i = 0; i < this.data.bones.length; i++) {
      this.boneIndexMap.set(this.data.bones[i]!.id, i);
    }
    this.slotIndexMap.clear();
    for (let i = 0; i < this.data.slots.length; i++) {
      this.slotIndexMap.set(this.data.slots[i]!.id, i);
    }

    this.attachmentById.clear();
    for (const attachment of this.data.attachments) {
      this.attachmentById.set(attachment.id, attachment);
    }
  }

  private normalize(): void {
    this.sortAndBakeMaps();
    this.validate();
  }

  /** Structural validation with descriptive errors — catches corrupted documents early. */
  private validate(): void {
    const boneIds = this.boneIndexMap;
    if (boneIds.size !== this.data.bones.length) {
      throw new Error('Duplicate bone ids in skeleton.');
    }
    if (this.slotIndexMap.size !== this.data.slots.length) {
      throw new Error('Duplicate slot ids in skeleton.');
    }

    const attachmentIds = new Set(this.data.attachments.map((a) => a.id));

    for (const slot of this.data.slots) {
      if (!boneIds.has(slot.boneId)) {
        throw new Error(`Slot "${slot.name}" references unknown boneId "${slot.boneId}".`);
      }
      if (slot.defaultAttachmentId !== null && !attachmentIds.has(slot.defaultAttachmentId)) {
        throw new Error(
          `Slot "${slot.name}" references unknown defaultAttachmentId "${slot.defaultAttachmentId}".`,
        );
      }
    }

    for (const constraint of this.data.ikConstraints) {
      if (constraint.bones.length < 1 || constraint.bones.length > 2) {
        throw new Error(
          `IK constraint "${constraint.id}" must control 1 or 2 bones (got ${constraint.bones.length}).`,
        );
      }
      for (const boneId of [...constraint.bones, constraint.targetId]) {
        if (!boneIds.has(boneId)) {
          throw new Error(`IK constraint "${constraint.id}" references unknown boneId "${boneId}".`);
        }
      }
      if (constraint.poleVectorId !== null && !boneIds.has(constraint.poleVectorId)) {
        throw new Error(
          `IK constraint "${constraint.id}" references unknown poleVectorId "${constraint.poleVectorId}".`,
        );
      }
    }

    if (this.data.activeSkin !== '') {
      const skin = this.data.skins.find((s) => s.name === this.data.activeSkin);
      if (!skin) {
        throw new Error(`activeSkin "${this.data.activeSkin}" not found in skins.`);
      }
      for (const [slotId, attachmentId] of Object.entries(skin.attachments)) {
        if (!this.slotIndexMap.has(slotId)) {
          throw new Error(`Skin "${skin.name}" references unknown slotId "${slotId}".`);
        }
        if (!attachmentIds.has(attachmentId)) {
          throw new Error(
            `Skin "${skin.name}" references unknown attachmentId "${attachmentId}".`,
          );
        }
      }
    }

    for (const attachment of this.data.attachments) {
      validateAttachmentWeights(attachment, this.data.bones.length);
    }
  }

  /** Re-maps weight bone indices from the old index space to the current one (DESIGN.md §4.1). */
  private remapAttachmentWeights(oldIndexToId: string[]): void {
    for (const attachment of this.data.attachments) {
      if (!attachment.weights) continue;
      const w = attachment.weights;
      const out: number[] = [];
      let p = 0;
      while (p < w.length) {
        const count = w[p++]!;
        if (!Number.isInteger(count) || count < 0) {
          throw new Error(`Attachment "${attachment.name}" has malformed weights.`);
        }
        out.push(count);
        for (let k = 0; k < count; k++) {
          if (p + 1 >= w.length) {
            throw new Error(`Attachment "${attachment.name}" has malformed weights (truncated).`);
          }
          const oldIndex = w[p++]!;
          const weight = w[p++]!;
          const id = oldIndexToId[oldIndex];
          const newIndex = id === undefined ? undefined : this.boneIndexMap.get(id);
          if (newIndex === undefined) {
            throw new Error(
              `Attachment "${attachment.name}" weights reference bone index ${oldIndex} that no longer exists.`,
            );
          }
          out.push(newIndex, weight);
        }
      }
      attachment.weights = out;
    }
  }
}

function validateAttachmentWeights(attachment: AttachmentData, boneCount: number): void {
  const w = attachment.weights;
  if (!w) return;
  let p = 0;
  while (p < w.length) {
    const count = w[p++]!;
    if (!Number.isInteger(count) || count < 0) {
      throw new Error(`Attachment "${attachment.name}" has malformed weights.`);
    }
    for (let k = 0; k < count; k++) {
      if (p + 1 >= w.length) {
        throw new Error(`Attachment "${attachment.name}" has malformed weights (truncated).`);
      }
      const boneIndex = w[p++]!;
      p++; // weight — value not validated here.
      if (boneIndex < 0 || boneIndex >= boneCount) {
        throw new Error(
          `Attachment "${attachment.name}" weights reference bone index ${boneIndex} out of range [0, ${boneCount}).`,
        );
      }
    }
  }
}
