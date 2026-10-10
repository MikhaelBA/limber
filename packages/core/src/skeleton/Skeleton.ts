import {
  validateWeights,
  validateHull,
  validateMeshTopology,
  validateInvertibleAffine,
  decodeWeights,
} from '@limber/mesh';
import type { AttachmentData, IKConstraintData, SkeletonData } from '../types/data';
import type { BonePose, SkeletonPose, SlotPose } from '../types/pose';
import { createPose, resetPose } from './pose';
import { topologicalSortBones } from './topologicalSort';
import { validateMarkers } from './markers';
import { resolveMeshLinks } from './meshLinks';
import { validateConstraints, orderedConstraints, type ConstraintEntry } from './constraints';
import { PathSampler } from './pathSampling';
import { SecondaryMotion } from './SecondaryMotion';

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
  /** Mixed serialized order, baked only on structural publication. */
  constraintOrder: readonly ConstraintEntry[] = [];
  /** Per-instance scratch for finite-output rollback; never serialized or frame allocated. */
  constraintWorldBackup = new Float32Array(0);
  constraintLocalBackup = new Float64Array(0);
  readonly pathSamplers = new Map<string, PathSampler>();
  secondaryMotion: SecondaryMotion | null = null;

  constructor(data: SkeletonData) {
    this.data = data;
    this.normalize();
    this.pose = createPose(data);
    this.constraintWorldBackup = new Float32Array(this.pose.worldMatrices.length);
    this.bakePaths();
  }

  /** Convenience for pipeline step 1 (DESIGN.md §4.3). */
  resetToSetupPose(): void {
    resetPose(this.data, this.pose);
  }

  /**
   * Install a validated snapshot whose weights use its own bone-array indices.
   * Unlike rebuild(), this never interprets snapshot weights in the old index
   * space. Failed validation leaves source, maps and pose untouched.
   */
  replaceData(next: SkeletonData): void {
    const prepared = new Skeleton(structuredClone(next));
    prepared.remapAttachmentWeights(next.bones.map((bone) => bone.id));
    for (const [id, index] of prepared.boneIndexMap) {
      const old = this.boneIndexMap.get(id);
      if (old !== undefined) prepared.pose.bones[index]!.local = { ...this.pose.bones[old]!.local };
    }
    for (const [id, index] of prepared.slotIndexMap) {
      const old = this.slotIndexMap.get(id);
      if (old !== undefined) Object.assign(prepared.pose.slots[index]!, this.pose.slots[old]!);
    }
    for (const key of Object.keys(this.data)) {
      if (!Object.hasOwn(prepared.data, key)) Reflect.deleteProperty(this.data, key);
    }
    Object.assign(this.data, prepared.data);
    this.boneIndexMap.clear();
    for (const [id, index] of prepared.boneIndexMap) this.boneIndexMap.set(id, index);
    this.slotIndexMap.clear();
    for (const [id, index] of prepared.slotIndexMap) this.slotIndexMap.set(id, index);
    this.attachmentById.clear();
    for (const [id, attachment] of prepared.attachmentById) this.attachmentById.set(id, attachment);
    Object.assign(this.pose, prepared.pose);
    this.constraintOrder = prepared.constraintOrder;
    this.constraintWorldBackup = prepared.constraintWorldBackup;
    this.constraintLocalBackup = prepared.constraintLocalBackup;
    this.secondaryMotion = prepared.secondaryMotion;
    this.pathSamplers.clear();
    for (const [id, sampler] of prepared.pathSamplers) this.pathSamplers.set(id, sampler);
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
    this.bakePaths();

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
    this.constraintWorldBackup = new Float32Array(pose.worldMatrices.length);
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
    resolveMeshLinks(this.data);
    const sorted = topologicalSortBones(this.data.bones);
    this.data.bones.length = 0;
    this.data.bones.push(...sorted);

    this.data.ikConstraints = [...this.data.ikConstraints].sort(
      (a: IKConstraintData, b: IKConstraintData) => a.order - b.order,
    );
    this.constraintOrder = orderedConstraints(this.data);
    if (this.data.transformConstraints)
      this.data.transformConstraints = [...this.data.transformConstraints].sort((a, b) => a.order - b.order);
    if (this.data.pathConstraints)
      this.data.pathConstraints = [...this.data.pathConstraints].sort((a, b) => a.order - b.order);
    if (this.data.secondaryConstraints)
      this.data.secondaryConstraints = [...this.data.secondaryConstraints].sort((a, b) => a.order - b.order);

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

  private bakePaths(): void {
    this.secondaryMotion = this.data.secondaryConstraints?.length
      ? new SecondaryMotion(this.data.secondaryConstraints, this.boneIndexMap)
      : null;
    this.constraintLocalBackup = new Float64Array(this.data.bones.length * 7);
    this.pathSamplers.clear();
    for (const path of this.data.paths ?? []) this.pathSamplers.set(path.id, new PathSampler(path));
  }

  /** Structural validation with descriptive errors — catches corrupted documents early. */
  private validate(): void {
    const boneIds = this.boneIndexMap;
    validateMarkers(this.data.markers, boneIds);
    if (boneIds.size !== this.data.bones.length) {
      throw new Error('Duplicate bone ids in skeleton.');
    }
    if (this.slotIndexMap.size !== this.data.slots.length) {
      throw new Error('Duplicate slot ids in skeleton.');
    }

    const attachmentIds = new Set(this.data.attachments.map((a) => a.id));
    if (attachmentIds.size !== this.data.attachments.length) {
      throw new Error('Duplicate attachment ids in skeleton.');
    }

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

    validateConstraints(this.data);

    const skinNames = new Set(this.data.skins.map((skin) => skin.name));
    if (skinNames.size !== this.data.skins.length || skinNames.has('')) {
      throw new Error('Skin names must be unique and nonempty.');
    }
    if (this.data.activeSkin !== '' && !skinNames.has(this.data.activeSkin)) {
      throw new Error(`activeSkin "${this.data.activeSkin}" not found in skins.`);
    }
    for (const skin of this.data.skins) {
      for (const [slotId, attachmentId] of Object.entries(skin.attachments)) {
        if (!this.slotIndexMap.has(slotId)) {
          throw new Error(`Skin "${skin.name}" references unknown slotId "${slotId}".`);
        }
        if (!attachmentIds.has(attachmentId)) {
          throw new Error(`Skin "${skin.name}" references unknown attachmentId "${attachmentId}".`);
        }
      }
    }

    for (const attachment of this.data.attachments) {
      try {
        // Source geometry becomes Float32 pose/GPU data. Finite doubles outside
        // that range must fail load rather than create infinite renderer vertices/UVs.
        const local = attachment.type === 'region' ? attachment.vertices : attachment.meshVertices;
        const uvs = attachment.type === 'region' ? attachment.uvs : attachment.meshUVs;
        for (const values of [local, uvs])
          if (Array.isArray(values)) {
            for (let i = 0; i < values.length; i++)
              if (!Number.isFinite(Math.fround(values[i]!)))
                throw new Error('Geometry exceeds finite pose precision.');
          }
        if (attachment.type === 'mesh') {
          if (!attachment.meshUVs) throw new Error('Mesh UVs are required.');
          validateMeshTopology({
            vertices: attachment.meshVertices!,
            triangles: attachment.meshTriangles!,
            uvs: attachment.meshUVs,
            hull: attachment.meshHull,
          });
        } else if (attachment.type === 'region') {
          if (attachment.vertices?.length !== 8 || attachment.uvs?.length !== 8)
            throw new Error('Region needs four vertices and UV pairs.');
          validateMeshTopology({
            vertices: attachment.vertices,
            triangles: [0, 1, 2, 0, 2, 3],
            uvs: attachment.uvs,
          });
        } else validateHull(attachment.meshVertices!, attachment.meshHull);
      } catch (error) {
        throw new Error(`Attachment "${attachment.name}" has invalid geometry: ${(error as Error).message}`);
      }
      validateAttachmentWeights(attachment, this.data.bones.length);
      if (attachment.boneBindings !== undefined) {
        if (
          attachment.type !== 'mesh' ||
          !Array.isArray(attachment.boneBindings) ||
          !attachment.boneBindings.length
        )
          throw new Error('Bone bindings require a mesh and at least one bone.');
        const bound = new Set<string>();
        for (const binding of attachment.boneBindings) {
          if (!binding || !this.boneIndexMap.has(binding.boneId) || bound.has(binding.boneId))
            throw new Error('Bone binding references a missing or duplicate bone.');
          if (!Array.isArray(binding.matrix)) throw new Error('Bone binding matrix must be an array.');
          if (binding.matrix.some((value) => !Number.isFinite(Math.fround(value))))
            throw new Error('Bone binding exceeds finite pose precision.');
          validateInvertibleAffine(binding.matrix);
          bound.add(binding.boneId);
          for (let i = 0; i < attachment.meshVertices!.length; i += 2) {
            const x = attachment.meshVertices![i]!,
              y = attachment.meshVertices![i + 1]!;
            if (
              !Number.isFinite(
                Math.fround(binding.matrix[0]! * x + binding.matrix[2]! * y + binding.matrix[4]!),
              ) ||
              !Number.isFinite(
                Math.fround(binding.matrix[1]! * x + binding.matrix[3]! * y + binding.matrix[5]!),
              )
            )
              throw new Error('Bound vertex exceeds finite pose precision.');
          }
        }
        if (attachment.weights) {
          for (const row of decodeWeights(
            attachment.weights,
            attachment.meshVertices!.length / 2,
            this.data.bones.length,
          )) {
            if (row.some((influence) => !bound.has(this.data.bones[influence.boneIndex]!.id)))
              throw new Error('Bind every influenced bone before assigning mesh weights.');
          }
        }
      }
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
  const vertices = attachment.type === 'region' ? attachment.vertices : attachment.meshVertices;
  try {
    validateWeights(attachment.weights, (vertices?.length ?? 0) / 2, boneCount);
  } catch (error) {
    throw new Error(`Attachment "${attachment.name}" has malformed weights: ${(error as Error).message}`);
  }
}
