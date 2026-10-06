import type { SkeletonData, SlotData } from '@limber/core';
import { uuid } from '@limber/core';
import type { EditorEngine } from '../engine/EditorEngine';
import type { Command } from '../history/history';

function uniqueSlotName(data: SkeletonData, base: string): string {
  const names = new Set(data.slots.map((s) => s.name));
  let name = base;
  let i = 2;
  while (names.has(name)) name = base + i++;
  return name;
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
    this.engine.skeleton.data.slots.push(this.slot);
    this.engine.skeleton.rebuild();
  }

  undo(): void {
    const data = this.engine.skeleton.data;
    data.slots = data.slots.filter((s) => s.id !== this.slot.id);
    this.engine.skeleton.rebuild();
  }
}

/** Everything that references a slot must be captured for a clean undo. */
interface RemoveSlotSnapshots {
  slot: SlotData;
  /** skins' slotId entries (name -> had-entry + attachmentId). */
  skinEntries: { skinName: string; attachmentId: string }[];
  /** slot-referencing timelines in every animation (index + deep copy). */
  timelines: { animName: string; index: number; timeline: unknown }[];
}

/**
 * Removes a slot and every reference to it: skin entries (validation requires
 * skins reference known slot ids) and slotColor/slotAttachment timelines across
 * all animations. The attachment objects themselves stay — they have their own
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
    const timelines: RemoveSlotSnapshots['timelines'] = [];
    const liveTimelines: unknown[] = [];
    for (const anim of this.engine.document.animations) {
      for (const tl of anim.timelines) {
        if ((tl.kind === 'slotColor' || tl.kind === 'slotAttachment') && tl.slotId === this.slotId) {
          timelines.push({ animName: anim.name, index: anim.timelines.indexOf(tl), timeline: structuredClone(tl) });
          liveTimelines.push(tl);
        }
      }
    }
    this.snaps = { slot: structuredClone(slot), skinEntries, timelines };

    for (const skin of data.skins) delete skin.attachments[this.slotId];
    for (const anim of this.engine.document.animations) {
      anim.timelines = anim.timelines.filter((tl) => !liveTimelines.includes(tl));
    }
    data.slots = data.slots.filter((s) => s.id !== this.slotId);
    this.engine.skeleton.rebuild();
  }

  undo(): void {
    if (!this.snaps) return;
    const data = this.engine.skeleton.data;
    data.slots.push(this.snaps.slot);
    for (const { skinName, attachmentId } of this.snaps.skinEntries) {
      data.skins.find((s) => s.name === skinName)!.attachments[this.slotId] = attachmentId;
    }
    for (const { animName, index, timeline } of this.snaps.timelines) {
      const anim = this.engine.document.animations.find((a) => a.name === animName)!;
      anim.timelines.splice(Math.min(index, anim.timelines.length), 0, structuredClone(timeline) as never);
    }
    this.snaps = null;
    this.engine.skeleton.rebuild();
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
    const rebind = slot.boneId !== snap.boneId;
    slot.name = snap.name;
    slot.boneId = snap.boneId;
    slot.color = snap.color;
    if (rebind) this.engine.skeleton.rebuild(); // Index maps are bone-keyed; pose parity is preserved by id.
    else this.engine.skeleton.pose.slots[this.engine.skeleton.slotIndexMap.get(this.slotId)!]!.color = snap.color;
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
  private beforeKeyframes: { animName: string; timelineIndex: number; keyframes: { slotOrder: number[] }[] }[] = [];

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
            ? [{ animName: anim.name, timelineIndex, keyframes: tl.keyframes.map((k) => ({ slotOrder: [...k.slotOrder] })) }]
            : [],
        ),
      );
    }

    const oldIdOrder = data.slots.map((s) => s.id);
    const moved = data.slots.splice(at, 1)[0]!;
    data.slots.splice(to, 0, moved);

    // Re-map drawOrder keyframes: permutation entries are draw-position -> slot
    // INDEX in the OLD space; translate via the slot id at that old index.
    for (const anim of this.engine.document.animations) {
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

    this.engine.skeleton.rebuild();
  }

  undo(): void {
    if (!this.beforeOrder) return;
    const data = this.engine.skeleton.data;
    const byId = new Map(data.slots.map((s) => [s.id, s]));
    const restored: typeof data.slots = [];
    for (const id of this.beforeOrder) {
      const slot = byId.get(id);
      if (slot) restored.push(slot);
    }
    // Slots added after this command ran keep their relative position at the end.
    for (const slot of data.slots) if (!restored.includes(slot)) restored.push(slot);
    data.slots = restored;

    for (const { animName, timelineIndex, keyframes } of this.beforeKeyframes) {
      const anim = this.engine.document.animations.find((a) => a.name === animName);
      const tl = anim?.timelines[timelineIndex];
      if (tl && tl.kind === 'drawOrder') {
        tl.keyframes.forEach((kf, i) => (kf.slotOrder = [...keyframes[i]!.slotOrder]));
      }
    }

    this.engine.skeleton.rebuild();
  }
}
