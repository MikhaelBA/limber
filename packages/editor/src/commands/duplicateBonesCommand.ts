import { Skeleton, uuid, weightAttachment, type Animation } from '@limber/core';
import { decodeWeights, encodeWeights } from '@limber/mesh';
import type { EditorEngine } from '../engine/EditorEngine';
import type { Command } from '../history/history';
import { applyRigSnapshot, captureRig, prepareRigEdit, type RigSnapshot } from './rigEdits';

/** Copy a subtree's artwork and tracks; weights follow copied bones by stable identity. */
export class DuplicateBonesCommand implements Command {
  readonly label = 'Duplicate bones and artwork';
  readonly rootBoneId = uuid();
  private before: RigSnapshot | null = null;
  private after: RigSnapshot | null = null;
  constructor(
    private engine: EditorEngine,
    private boneId: string,
  ) {}
  do(): void {
    if (this.after) {
      applyRigSnapshot(this.engine, this.after);
      return;
    }
    if (this.engine.mode !== 'setup') throw new Error('Switch to Setup to duplicate bones.');
    const before = captureRig(this.engine),
      originalIds = before.skeleton.bones.map((b) => b.id);
    const boneIds = new Map<string, string>(),
      attachmentIds = new Map<string, string>();
    const pending: { id: string; weights: number[]; vertices: number }[] = [];
    const after = prepareRigEdit(this.engine, (data, animations) => {
      if (!data.bones.some((b) => b.id === this.boneId)) throw new Error('Select a bone to duplicate.');
      boneIds.set(this.boneId, this.rootBoneId);
      for (const bone of data.bones)
        if (bone.parentId && boneIds.has(bone.parentId)) boneIds.set(bone.id, uuid());
      const slotIds = new Map(data.slots.filter((s) => boneIds.has(s.boneId)).map((s) => [s.id, uuid()]));
      const needed = new Set<string>();
      for (const slot of data.slots)
        if (slotIds.has(slot.id) && slot.defaultAttachmentId) needed.add(slot.defaultAttachmentId);
      for (const skin of data.skins)
        for (const [slot, attachment] of Object.entries(skin.attachments))
          if (slotIds.has(slot) && attachment) needed.add(attachment);
      for (const clip of animations)
        for (const track of clip.timelines)
          if (track.kind === 'slotAttachment' && slotIds.has(track.slotId))
            for (const key of track.keyframes) if (key.attachmentId) needed.add(key.attachmentId);
      for (const id of needed) attachmentIds.set(id, uuid());
      const unique = (names: Set<string>, source: string) => {
        let name = `${source}.copy`,
          i = 2;
        while (names.has(name)) name = `${source}.copy${i++}`;
        names.add(name);
        return name;
      };
      const boneNames = new Set(data.bones.map((b) => b.name)),
        slotNames = new Set(data.slots.map((s) => s.name)),
        attachmentNames = new Set(data.attachments.map((a) => a.name));
      for (const bone of [...data.bones])
        if (boneIds.has(bone.id))
          data.bones.push({
            ...structuredClone(bone),
            id: boneIds.get(bone.id)!,
            name: unique(boneNames, bone.name),
            parentId: bone.parentId ? (boneIds.get(bone.parentId) ?? bone.parentId) : null,
          });
      const oldSlotCount = data.slots.length;
      for (const slot of [...data.slots])
        if (slotIds.has(slot.id))
          data.slots.push({
            ...structuredClone(slot),
            id: slotIds.get(slot.id)!,
            name: unique(slotNames, slot.name),
            boneId: boneIds.get(slot.boneId)!,
            defaultAttachmentId: slot.defaultAttachmentId
              ? attachmentIds.get(slot.defaultAttachmentId)!
              : null,
          });
      for (const attachment of [...data.attachments])
        if (attachmentIds.has(attachment.id)) {
          const copy = structuredClone(attachment);
          copy.id = attachmentIds.get(attachment.id)!;
          copy.name = unique(attachmentNames, attachment.name);
          if (copy.meshSourceId)
            copy.meshSourceId = attachmentIds.get(copy.meshSourceId) ?? copy.meshSourceId;
          if (copy.endSlotId) copy.endSlotId = slotIds.get(copy.endSlotId) ?? copy.endSlotId;
          copy.boneBindings = copy.boneBindings?.map((b) => ({
            ...b,
            boneId: boneIds.get(b.boneId) ?? b.boneId,
          }));
          copy.weightLocks = copy.weightLocks?.map((id) => boneIds.get(id) ?? id);
          // Newly added bone indices are assigned after the draft's structural rebuild.
          if (copy.weights) {
            pending.push({
              id: copy.id,
              weights: [...copy.weights],
              vertices: (copy.type === 'region' ? copy.vertices! : copy.meshVertices!).length / 2,
            });
            delete copy.weights;
          }
          data.attachments.push(copy);
        }
      const pathNames = new Set(data.paths?.map((path) => path.name));
      for (const path of [...(data.paths ?? [])])
        if (boneIds.has(path.boneId)) {
          const copy = structuredClone(path);
          copy.id = uuid();
          copy.name = unique(pathNames, path.name);
          copy.boneId = boneIds.get(path.boneId)!;
          copy.boneBindings = copy.boneBindings?.map((binding) => ({
            ...binding,
            boneId: boneIds.get(binding.boneId) ?? binding.boneId,
          }));
          copy.weightLocks = copy.weightLocks?.map((id) => boneIds.get(id) ?? id);
          if (copy.weights) {
            pending.push({ id: copy.id, weights: [...copy.weights], vertices: copy.segments.length * 4 });
            delete copy.weights;
          }
          data.paths!.push(copy);
        }
      for (const skin of data.skins)
        for (const [slot, attachment] of Object.entries({ ...skin.attachments }))
          if (slotIds.has(slot) && attachment)
            skin.attachments[slotIds.get(slot)!] = attachmentIds.get(attachment)!;
      for (const marker of [...(data.markers ?? [])])
        if (boneIds.has(marker.boneId))
          data.markers!.push({
            ...structuredClone(marker),
            id: uuid(),
            name: marker.name + '.copy',
            boneId: boneIds.get(marker.boneId)!,
          });
      for (const clip of animations) {
        const copies: Animation['timelines'] = [];
        for (const track of clip.timelines) {
          if (track.kind === 'drawOrder')
            for (const key of track.keyframes)
              key.slotOrder.push(...Array.from({ length: slotIds.size }, (_, i) => oldSlotCount + i));
          if (track.kind === 'boneProperty' && boneIds.has(track.boneId))
            copies.push({ ...structuredClone(track), boneId: boneIds.get(track.boneId)! });
          if ((track.kind === 'slotAttachment' || track.kind === 'slotColor') && slotIds.has(track.slotId)) {
            const copy = structuredClone(track);
            copy.slotId = slotIds.get(track.slotId)!;
            if (copy.kind === 'slotAttachment')
              copy.keyframes.forEach((key) => {
                if (key.attachmentId) key.attachmentId = attachmentIds.get(key.attachmentId)!;
              });
            copies.push(copy);
          }
          if (track.kind === 'deform' && attachmentIds.has(track.attachmentId))
            copies.push({ ...structuredClone(track), attachmentId: attachmentIds.get(track.attachmentId)! });
        }
        clip.timelines.push(...copies);
      }
    });
    const indices = new Map(after.skeleton.bones.map((b, i) => [b.id, i]));
    for (const { id, weights, vertices } of pending) {
      const copy = weightAttachment(after.skeleton, id)!;
      copy.weights = encodeWeights(
        decodeWeights(weights, vertices, originalIds.length).map((row) =>
          row.map((item) => ({
            boneIndex: indices.get(
              boneIds.get(originalIds[item.boneIndex]!) ?? originalIds[item.boneIndex]!,
            )!,
            weight: item.weight,
          })),
        ),
      );
    }
    new Skeleton(structuredClone(after.skeleton));
    applyRigSnapshot(this.engine, after);
    this.before = before;
    this.after = after;
  }
  undo(): void {
    if (this.before) applyRigSnapshot(this.engine, this.before);
  }
}
