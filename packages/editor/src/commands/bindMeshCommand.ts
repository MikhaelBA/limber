import { createPose, solveFK } from '@limber/core';
import { relativeAffine } from '@limber/mesh';
import type { EditorEngine } from '../engine/EditorEngine';
import type { Command } from '../history/history';
import { applyRigSnapshot, captureRig, prepareRigEdit, type RigSnapshot } from './rigEdits';

/** Capture setup-space bind transforms, independent of the sampled animation. */
export class BindMeshCommand implements Command {
  readonly label = 'Bind Mesh Bones';
  private before: RigSnapshot | null = null;
  private after: RigSnapshot | null = null;
  private boneIds: string[];
  constructor(
    private engine: EditorEngine,
    private attachmentId: string,
    private slotId: string,
    boneIds: readonly string[],
  ) {
    this.boneIds = [...boneIds];
  }
  do(): void {
    if (this.after) {
      applyRigSnapshot(this.engine, this.after);
      return;
    }
    if (this.engine.mode !== 'setup') throw new Error('Switch to Setup to bind mesh bones.');
    const before = captureRig(this.engine);
    const after = prepareRigEdit(this.engine, (data) => {
      const mesh = data.attachments.find((item) => item.id === this.attachmentId);
      const slot = data.slots.find((item) => item.id === this.slotId);
      if (!mesh || mesh.type !== 'mesh' || !slot) throw new Error('Select a mesh slot before binding.');
      if (!this.boneIds.length || new Set(this.boneIds).size !== this.boneIds.length)
        throw new Error('Choose at least one unique bone to bind.');
      const indices = new Map(data.bones.map((bone, index) => [bone.id, index]));
      if (this.boneIds.some((id) => !indices.has(id)))
        throw new Error('A selected binding bone no longer exists.');
      const pose = createPose(data);
      solveFK(data, indices, pose);
      const slotIndex = indices.get(slot.boneId)!;
      const slotWorld = pose.worldMatrices.subarray(slotIndex * 6, slotIndex * 6 + 6);
      // Include rigid fallback's bone so painting an unweighted vertex is valid.
      const selected = new Set([...this.boneIds, slot.boneId]);
      mesh.boneBindings = data.bones
        .filter((bone) => selected.has(bone.id))
        .map((bone) => {
          const index = indices.get(bone.id)!;
          return {
            boneId: bone.id,
            matrix: relativeAffine(pose.worldMatrices.subarray(index * 6, index * 6 + 6), slotWorld),
          };
        });
    });
    applyRigSnapshot(this.engine, after);
    this.before = before;
    this.after = after;
  }
  undo(): void {
    if (this.before) applyRigSnapshot(this.engine, this.before);
  }
}
