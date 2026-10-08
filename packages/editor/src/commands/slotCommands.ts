import type { Animation, SkeletonData, SlotData } from '@limber/core';
import { Skeleton, uuid } from '@limber/core';
import type { EditorEngine } from '../engine/EditorEngine';
import type { Command } from '../history/history';

function uniqueSlotName(data: SkeletonData, base: string): string {
  const names = new Set(data.slots.map((s) => s.name));
  let name = base;
  let i = 2;
  while (names.has(name)) name = base + i++;
  return name;
}

/** Slot edits keep bone indices fixed. Validate the complete proposal before publishing it. */
function editSlots(engine: EditorEngine, edit: (data: SkeletonData, animations: Animation[]) => void): void {
  const data = structuredClone(engine.skeleton.data);
  const animations = structuredClone(engine.document.animations);
  edit(data, animations);
  new Skeleton(data);
  for (const anim of animations) {
    for (const timeline of anim.timelines) {
      if (timeline.kind !== 'drawOrder') continue;
      for (const key of timeline.keyframes) {
        if (
          key.slotOrder.length !== data.slots.length ||
          new Set(key.slotOrder).size !== data.slots.length ||
          key.slotOrder.some((index) => !Number.isInteger(index) || index < 0 || index >= data.slots.length)
        ) {
          throw new Error(`Animation "${anim.name}" has an invalid draw-order permutation.`);
        }
      }
    }
  }
  const live = engine.skeleton.data;
  live.slots = data.slots;
  live.skins = data.skins;
  live.attachments = data.attachments;
  engine.document.animations.forEach((anim, index) => {
    anim.timelines = animations[index]!.timelines;
  });
  engine.skeleton.rebuild();
}

function removeSlotReferences(data: SkeletonData, animations: Animation[], slotId: string): void {
  const index = data.slots.findIndex((slot) => slot.id === slotId);
  if (index < 0) throw new Error(`Slot "${slotId}" not found.`);
  // A clipping boundary is exclusive: retain the same boundary before the surviving successor.
  const successor = data.slots[index + 1]?.id ?? null;
  for (const attachment of data.attachments) {
    if (attachment.type === 'clipping' && attachment.endSlotId === slotId) attachment.endSlotId = successor;
  }
  for (const skin of data.skins) delete skin.attachments[slotId];
  for (const anim of animations) {
    anim.timelines = anim.timelines.filter(
      (timeline) =>
        !(
          (timeline.kind === 'slotColor' || timeline.kind === 'slotAttachment') &&
          timeline.slotId === slotId
        ),
    );
    for (const timeline of anim.timelines) {
      if (timeline.kind !== 'drawOrder') continue;
      for (const key of timeline.keyframes) {
        key.slotOrder = key.slotOrder
          .filter((old) => old !== index)
          .map((old) => (old > index ? old - 1 : old));
      }
    }
  }
  data.slots.splice(index, 1);
}

/**
 * Structural command: a slot is added bound to `boneId` with no attachment and
 * a white opaque color. do()/undo() both rebuild() (index space shifts —
 * DESIGN.md §5.3); Skeleton.rebuild() carries the visible pose over by id.
 */
export class AddSlotCommand implements Command {
  readonly slotId: string;
  private readonly slot: SlotData;
  private named = false;
  private _label = 'Add Slot';

  constructor(
    private engine: EditorEngine,
    readonly boneId: string,
  ) {
    this.slotId = uuid();
    this.slot = {
      id: this.slotId,
      name: 'slot', // Placeholder — the unique name is chosen at first do().
      boneId,
      defaultAttachmentId: null,
      color: 0xffffffff,
    };
  }

  get label(): string {
    return this._label;
  }

  do(): void {
    if (!this.named) {
      this.slot.name = uniqueSlotName(this.engine.skeleton.data, 'slot');
      this._label = `Add Slot ${this.slot.name}`;
      this.named = true;
    }
    editSlots(this.engine, (data, animations) => {
      if (data.slots.some((slot) => slot.id === this.slotId)) throw new Error('Duplicate slot id.');
      const index = data.slots.length;
      data.slots.push(structuredClone(this.slot));
      for (const anim of animations) {
        for (const timeline of anim.timelines) {
          if (timeline.kind === 'drawOrder') {
            for (const key of timeline.keyframes) key.slotOrder.push(index);
          }
        }
      }
    });
  }

  undo(): void {
    editSlots(this.engine, (data, animations) => removeSlotReferences(data, animations, this.slotId));
  }
}

/** Everything that references a slot must be captured for a clean undo. */
interface RemoveSlotSnapshots {
  slot: SlotData;
  index: number;
  /** skins' slotId entries (name -> had-entry + attachmentId). */
  skinEntries: { skinName: string; attachmentId: string }[];
  /** Includes indexed draw-order keys as well as removed slot tracks. */
  animations: Animation[];
  clipEnds: { attachmentId: string; endSlotId: string }[];
}

/**
 * Removes a slot and every reference to it: skin entries (validation requires
 * skins reference known slot ids) and slotColor/slotAttachment timelines across
 * all animations. Remaps draw-order keys and exclusive clipping boundaries.
 * The attachment objects themselves stay — they have their own
 * lifecycle via RemoveAttachmentCommand.
 */
export class RemoveSlotCommand implements Command {
  readonly label: string;
  private snaps: RemoveSlotSnapshots | null = null;

  constructor(
    private engine: EditorEngine,
    readonly slotId: string,
  ) {
    const slot = engine.skeleton.data.slots.find((s) => s.id === slotId);
    if (!slot) throw new Error(`RemoveSlotCommand: slot "${slotId}" not found.`);
    this.label = `Delete Slot ${slot.name}`;
  }

  do(): void {
    const data = this.engine.skeleton.data;
    const slot = data.slots.find((s) => s.id === this.slotId);
    if (!slot) return;

    const skinEntries = data.skins.flatMap((skin) =>
      skin.attachments[this.slotId] !== undefined
        ? [{ skinName: skin.name, attachmentId: skin.attachments[this.slotId]! }]
        : [],
    );
    const snaps: RemoveSlotSnapshots = {
      slot: structuredClone(slot),
      index: data.slots.indexOf(slot),
      skinEntries,
      animations: structuredClone(this.engine.document.animations),
      clipEnds: data.attachments.flatMap((attachment) =>
        attachment.type === 'clipping' && attachment.endSlotId === this.slotId
          ? [{ attachmentId: attachment.id, endSlotId: this.slotId }]
          : [],
      ),
    };
    editSlots(this.engine, (proposed, animations) => removeSlotReferences(proposed, animations, this.slotId));
    this.snaps = snaps;
  }

  undo(): void {
    if (!this.snaps) return;
    const snaps = this.snaps;
    editSlots(this.engine, (data, animations) => {
      data.slots.splice(snaps.index, 0, structuredClone(snaps.slot));
      for (const { skinName, attachmentId } of snaps.skinEntries) {
        const skin = data.skins.find((s) => s.name === skinName);
        if (!skin) throw new Error(`Skin "${skinName}" no longer exists.`);
        skin.attachments[this.slotId] = attachmentId;
      }
      for (const { attachmentId, endSlotId } of snaps.clipEnds) {
        const attachment = data.attachments.find((a) => a.id === attachmentId);
        if (!attachment) throw new Error(`Attachment "${attachmentId}" no longer exists.`);
        attachment.endSlotId = endSlotId;
      }
      animations.forEach((anim, index) => {
        anim.timelines = structuredClone(snaps.animations[index]!.timelines);
      });
    });
    this.snaps = null;
  }
}

export interface SlotPropsSnapshot {
  name: string;
  boneId: string;
  /** Packed RGBA uint32. */
  color: number;
}

/** Toggles a slot's blend mode (additive glows). Data-only — no pose impact. */
export class SetSlotBlendCommand implements Command {
  readonly label: string;
  private before: 'normal' | 'add' | null = null;

  constructor(
    private engine: EditorEngine,
    private slotId: string,
    private blend: 'normal' | 'add',
  ) {
    const slot = engine.skeleton.data.slots.find((s) => s.id === slotId);
    if (!slot) throw new Error(`SetSlotBlendCommand: slot "${slotId}" not found.`);
    this.label = `${blend === 'add' ? 'Additive' : 'Normal'} blend ${slot.name}`;
  }

  do(): void {
    this.apply(this.blend);
  }

  undo(): void {
    if (this.before === null) return;
    this.apply(this.before);
  }

  private apply(blend: 'normal' | 'add'): void {
    const slot = this.engine.skeleton.data.slots.find((s) => s.id === this.slotId);
    if (!slot) return;
    if (this.before === null) this.before = slot.blendMode ?? 'normal';
    slot.blendMode = blend;
  }
}

/** Edits a slot's name/color, optionally re-binding it to another bone. */
export class SetSlotPropsCommand implements Command {
  readonly label: string;

  constructor(
    private engine: EditorEngine,
    private slotId: string,
    private before: SlotPropsSnapshot,
    private after: SlotPropsSnapshot,
  ) {
    this.label = `Edit Slot ${after.name || before.name}`;
  }

  do(): void {
    this.apply(this.after);
  }

  undo(): void {
    this.apply(this.before);
  }

  private apply(snap: SlotPropsSnapshot): void {
    const slot = this.engine.skeleton.data.slots.find((s) => s.id === this.slotId);
    if (!slot) throw new Error(`SetSlotPropsCommand: slot "${this.slotId}" no longer exists.`);
    const proposed = structuredClone(this.engine.skeleton.data);
    Object.assign(
      proposed.slots.find((s) => s.id === this.slotId)!,
      snap,
    );
    new Skeleton(proposed);
    const rebind = slot.boneId !== snap.boneId;
    slot.name = snap.name;
    slot.boneId = snap.boneId;
    slot.color = snap.color;
    if (rebind)
      this.engine.skeleton.rebuild(); // Index maps are bone-keyed; pose parity is preserved by id.
    else
      this.engine.skeleton.pose.slots[this.engine.skeleton.slotIndexMap.get(this.slotId)!]!.color =
        snap.color;
  }
}

/**
 * Moves a slot within `data.slots` — the DEFAULT draw order (pose.slotOrder is
 * reset from array order every frame). Existing drawOrder keyframes store slot
 * INDEX permutations, so they are re-mapped old-index -> id -> new-index; undo
 * restores both the array order and the original keyframe permutations.
 */
export class ReorderSlotCommand implements Command {
  readonly label: string;
  private readonly slotId: string;
  private beforeOrder: string[] | null = null;
  private beforeKeyframes: {
    animName: string;
    timelineIndex: number;
    keyframes: { slotOrder: number[] }[];
  }[] = [];

  constructor(
    private engine: EditorEngine,
    slotId: string,
    private delta: -1 | 1,
  ) {
    const slot = engine.skeleton.data.slots.find((s) => s.id === slotId);
    if (!slot) throw new Error(`ReorderSlotCommand: slot "${slotId}" not found.`);
    this.slotId = slotId;
    this.label = `Reorder Slot ${slot.name}`;
  }

  do(): void {
    const data = this.engine.skeleton.data;
    const at = data.slots.findIndex((s) => s.id === this.slotId);
    if (at < 0) return;
    const to = at + this.delta;
    if (to < 0 || to >= data.slots.length) return;

    if (!this.beforeOrder) {
      this.beforeOrder = data.slots.map((s) => s.id);
      this.beforeKeyframes = this.engine.document.animations.flatMap((anim) =>
        anim.timelines.flatMap((tl, timelineIndex) =>
          tl.kind === 'drawOrder'
            ? [
                {
                  animName: anim.name,
                  timelineIndex,
                  keyframes: tl.keyframes.map((k) => ({ slotOrder: [...k.slotOrder] })),
                },
              ]
            : [],
        ),
      );
    }

    editSlots(this.engine, (data, animations) => {
      const oldIdOrder = data.slots.map((s) => s.id);
      const moved = data.slots.splice(at, 1)[0]!;
      data.slots.splice(to, 0, moved);

      // Re-map drawOrder keyframes: permutation entries are draw-position -> slot
      // INDEX in the OLD space; translate via the slot id at that old index.
      for (const anim of animations) {
        for (const tl of anim.timelines) {
          if (tl.kind !== 'drawOrder') continue;
          for (const kf of tl.keyframes) {
            const remapped = kf.slotOrder.map((oldIndex) => {
              const id = oldIdOrder[oldIndex];
              return id === undefined ? oldIndex : data.slots.findIndex((s) => s.id === id);
            });
            kf.slotOrder = remapped.every((i) => i >= 0) ? remapped : kf.slotOrder;
          }
        }
      }
    });
  }

  undo(): void {
    if (!this.beforeOrder) return;
    const beforeOrder = this.beforeOrder;
    editSlots(this.engine, (data, animations) => {
      const byId = new Map(data.slots.map((s) => [s.id, s]));
      const restored: typeof data.slots = [];
      for (const id of beforeOrder) {
        const slot = byId.get(id);
        if (slot) restored.push(slot);
      }
      // Slots added after this command ran keep their relative position at the end.
      for (const slot of data.slots) if (!restored.includes(slot)) restored.push(slot);
      data.slots = restored;

      for (const { animName, timelineIndex, keyframes } of this.beforeKeyframes) {
        const anim = animations.find((a) => a.name === animName);
        const tl = anim?.timelines[timelineIndex];
        if (tl && tl.kind === 'drawOrder') {
          tl.keyframes.forEach((kf, i) => (kf.slotOrder = [...keyframes[i]!.slotOrder]));
        }
      }
    });
  }
}
