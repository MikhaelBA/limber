import { createPose, solveFK, weightAttachment } from '@limber/core';
import { relativeAffine, autoWeights } from '@limber/mesh';
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
    private initializeWeights = false,
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
      const mesh = weightAttachment(data, this.attachmentId);
      const path = data.paths?.find((item) => item.id === this.attachmentId);
      const slot = path ? { boneId: path.boneId } : data.slots.find((item) => item.id === this.slotId);
      if (!mesh?.meshVertices || !slot) throw new Error('Select a mesh slot before binding.');
      if (!this.boneIds.length || new Set(this.boneIds).size !== this.boneIds.length)
        throw new Error('Choose at least one unique bone to bind.');
      const indices = new Map(data.bones.map((bone, index) => [bone.id, index]));
      if (this.boneIds.some((id) => !indices.has(id)))
        throw new Error('A selected binding bone no longer exists.');
      const pose = createPose(data);
      solveFK(data, indices, pose);
      const slotIndex = indices.get(slot.boneId)!;
      const slotWorld = pose.worldMatrices.subarray(slotIndex * 6, slotIndex * 6 + 6);
      // First public binding makes all rows explicit; it binds only chosen bones.
      // Legacy rigid rows still need their owner as a valid fallback.
      const selected = [
        ...new Set([...this.boneIds, ...(!this.initializeWeights || mesh.weights ? [slot.boneId] : [])]),
      ];
      const previous = new Map(mesh.boneBindings?.map((binding) => [binding.boneId, binding]));
      mesh.boneBindings = selected.map((boneId) => {
        const index = indices.get(boneId)!;
        if (this.initializeWeights && previous.has(boneId)) return previous.get(boneId)!;
        return {
          boneId,
          matrix: relativeAffine(pose.worldMatrices.subarray(index * 6, index * 6 + 6), slotWorld),
        };
      });
      if (this.initializeWeights && !mesh.weights) {
        const vertices = mesh.meshVertices.map((value, i) => {
          const offset = i - (i % 2),
            x = mesh.meshVertices![offset]!,
            y = mesh.meshVertices![offset + 1]!;
          return i % 2
            ? slotWorld[1]! * x + slotWorld[3]! * y + slotWorld[5]!
            : slotWorld[0]! * x + slotWorld[2]! * y + slotWorld[4]!;
        });
        const bones = selected.map((boneId) => {
          const index = indices.get(boneId)!,
            o = index * 6,
            wm = pose.worldMatrices;
          return {
            boneIndex: index,
            x0: wm[o + 4]!,
            y0: wm[o + 5]!,
            x1: wm[o + 4]! + data.bones[index]!.length * wm[o]!,
            y1: wm[o + 5]! + data.bones[index]!.length * wm[o + 1]!,
          };
        });
        mesh.weights = autoWeights({
          vertices,
          bones,
          triangles: mesh.meshTriangles,
          edges: !mesh.meshTriangles?.length
            ? (mesh.weightEdges ?? mesh.meshHull?.flatMap((v, i, ring) => [v, ring[(i + 1) % ring.length]!]))
            : undefined,
          maxInfluences: Math.min(4, bones.length),
        });
      }
    });
    applyRigSnapshot(this.engine, after);
    this.before = before;
    this.after = after;
  }
  undo(): void {
    if (this.before) applyRigSnapshot(this.engine, this.before);
  }
}
