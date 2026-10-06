import type { AttachmentData } from '@limber/core';
import { uuid } from '@limber/core';
import type { EditorEngine } from '../engine/EditorEngine';
import type { Command } from '../history/history';

/** Where a slot's visible attachment assignment is written. */
export type AttachmentTarget = 'default' | 'skin';

/** Axis-aligned region parameters — vertices/uvs are derived (Phase 4 regions only). */
export interface RegionParams {
  textureId: string;
  /** Quad CENTER, local to the slot's bone (y-down, like all editor space). */
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Corners are ordered TL, TR, BR, BL (y-down) so the image renders upright
 * with standard top-left-origin UVs.
 */
export function regionVertices(p: { x: number; y: number; width: number; height: number }): number[] {
  const hw = p.width / 2;
  const hh = p.height / 2;
  return [p.x - hw, p.y - hh, p.x + hw, p.y - hh, p.x + hw, p.y + hh, p.x - hw, p.y + hh];
}

export const FULL_UVS = [0, 0, 1, 0, 1, 1, 0, 1];

/** Reads back RegionParams from a region attachment's axis-aligned corners. */
export function regionOf(a: AttachmentData): RegionParams {
  const v = a.vertices ?? [0, 0, 1, 0, 1, 1, 0, 1];
  return {
    textureId: a.textureId,
    x: (v[0]! + v[4]!) / 2,
    y: (v[1]! + v[5]!) / 2,
    width: Math.abs(v[2]! - v[0]!), // TR.x - TL.x
    height: Math.abs(v[5]! - v[1]!), // BR.y - TL.y
  };
}

/**
 * Records an imported texture in the document's assetManifest. The live pixels
 * live in the (browser-only) TextureRegistry and are intentionally NOT part of
 * undo — undoing removes the manifest entry, redo restores it, and attachments
 * keep rendering as long as the registry still holds the texture.
 */
export class AddTextureCommand implements Command {
  readonly label: string;

  constructor(
    private engine: EditorEngine,
    readonly textureId: string,
    readonly name: string,
  ) {
    this.label = `Import Texture ${name}`;
  }

  do(): void {
    this.engine.document.assetManifest[this.textureId] = { name: this.name, source: 'embedded' };
  }

  undo(): void {
    delete this.engine.document.assetManifest[this.textureId];
  }
}

/**
 * Creates a region attachment from a texture and assigns it to a slot
 * (default attachment, or the active skin's override). One undo step.
 */
export class AddAttachmentCommand implements Command {
  readonly attachmentId: string;
  private _label = 'Add Attachment';
  private readonly attachment: AttachmentData;
  private named = false;
  private beforeSlotValue: string | null | undefined;

  get label(): string {
    return this._label;
  }

  /**
   * `slotId` may not exist in the data YET — commands composed in a
   * CompositeCommand (drop-file flow: AddTexture + AddSlot + AddAttachment)
   * construct this before the earlier commands have run. Naming and slot
   * capture resolve lazily at first do().
   */
  constructor(
    private engine: EditorEngine,
    readonly slotId: string,
    params: RegionParams,
    private target: AttachmentTarget = 'default',
    name?: string,
  ) {
    this.attachmentId = uuid();
    this.attachment = {
      id: this.attachmentId,
      name: name ?? 'region', // Placeholder — uniquified at first do().
      type: 'region',
      textureId: params.textureId,
      vertices: regionVertices(params),
      uvs: [...FULL_UVS],
    };
  }

  do(): void {
    const data = this.engine.skeleton.data;
    const slot = data.slots.find((s) => s.id === this.slotId);
    if (!slot) throw new Error(`AddAttachmentCommand: slot "${this.slotId}" not found.`);
    if (!this.named) {
      const base =
        this.attachment.name !== 'region'
          ? this.attachment.name
          : this.engine.document.assetManifest[this.attachment.textureId]?.name.replace(/\.[a-z0-9]+$/i, '') ?? 'region';
      const names = new Set(data.attachments.map((a) => a.name));
      let unique = base;
      let i = 2;
      while (names.has(unique)) unique = base + i++;
      this.attachment.name = unique;
      this._label = `Add Attachment ${unique}`;
      this.named = true;
    }
    if (this.beforeSlotValue === undefined) this.captureBefore();
    data.attachments.push(this.attachment);
    this.assign(this.attachment.id);
    this.engine.skeleton.rebuild();
  }

  undo(): void {
    const data = this.engine.skeleton.data;
    data.attachments = data.attachments.filter((a) => a.id !== this.attachment.id);
    this.restoreBefore();
    this.engine.skeleton.rebuild();
  }

  private captureBefore(): void {
    const data = this.engine.skeleton.data;
    const slot = data.slots.find((s) => s.id === this.slotId)!;
    if (this.target === 'default') {
      this.beforeSlotValue = slot.defaultAttachmentId;
    } else {
      const skin = data.skins.find((s) => s.name === data.activeSkin);
      this.beforeSlotValue = skin ? skin.attachments[this.slotId] : undefined; // undefined = no entry existed
    }
  }

  private restoreBefore(): void {
    const data = this.engine.skeleton.data;
    const slot = data.slots.find((s) => s.id === this.slotId);
    if (!slot) return;
    if (this.target === 'default') {
      slot.defaultAttachmentId = this.beforeSlotValue ?? null;
    } else {
      const skin = data.skins.find((s) => s.name === data.activeSkin);
      if (!skin) return;
      if (this.beforeSlotValue === undefined || this.beforeSlotValue === null) {
        delete skin.attachments[this.slotId];
      } else {
        skin.attachments[this.slotId] = this.beforeSlotValue;
      }
    }
  }

  private assign(attachmentId: string): void {
    const data = this.engine.skeleton.data;
    const slot = data.slots.find((s) => s.id === this.slotId)!;
    if (this.target === 'default') slot.defaultAttachmentId = attachmentId;
    else {
      const skin = data.skins.find((s) => s.name === data.activeSkin);
      if (!skin) throw new Error(`AddAttachmentCommand: active skin "${data.activeSkin}" not found.`);
      skin.attachments[this.slotId] = attachmentId;
    }
  }
}

/**
 * Creates an untextured POLYGON attachment (bounding box or clipping) from a
 * rect and assigns it to the slot. Vertices are editable with the Mesh tool;
 * `endSlotId` only matters for clipping (null = clip through the last slot).
 */
export class AddPolygonAttachmentCommand implements Command {
  readonly attachmentId: string;
  private _label = 'Add Bounding Box';
  private readonly attachment: AttachmentData;
  private named = false;
  private beforeSlotValue: string | null | undefined;

  constructor(
    private engine: EditorEngine,
    readonly slotId: string,
    params: { x: number; y: number; width: number; height: number },
    private kind: 'boundingBox' | 'clipping',
    private target: AttachmentTarget = 'default',
    endSlotId: string | null = null,
  ) {
    this.attachmentId = uuid();
    const hw = params.width / 2;
    const hh = params.height / 2;
    this.attachment = {
      id: this.attachmentId,
      name: kind, // Uniquified at first do().
      type: kind,
      textureId: '',
      // TL, TR, BR, BL — same corner order as regions (y-down).
      meshVertices: [params.x - hw, params.y - hh, params.x + hw, params.y - hh, params.x + hw, params.y + hh, params.x - hw, params.y + hh],
      meshHull: [0, 1, 2, 3],
      ...(kind === 'clipping' ? { endSlotId } : {}),
    };
  }

  get label(): string {
    return this._label;
  }

  do(): void {
    const data = this.engine.skeleton.data;
    const slot = data.slots.find((s) => s.id === this.slotId);
    if (!slot) throw new Error(`AddPolygonAttachmentCommand: slot "${this.slotId}" not found.`);
    if (!this.named) {
      const names = new Set(data.attachments.map((a) => a.name));
      const base = this.kind === 'clipping' ? 'clipping' : 'boundingBox';
      let unique = base;
      let i = 2;
      while (names.has(unique)) unique = base + i++;
      this.attachment.name = unique;
      this._label = `Add ${base} ${unique}`;
      this.named = true;
    }
    if (this.beforeSlotValue === undefined) {
      this.beforeSlotValue =
        this.target === 'default'
          ? slot.defaultAttachmentId
          : data.skins.find((s) => s.name === data.activeSkin)?.attachments[this.slotId];
    }
    data.attachments.push(this.attachment);
    this.assign(this.attachment.id);
    this.engine.skeleton.rebuild();
  }

  undo(): void {
    const data = this.engine.skeleton.data;
    data.attachments = data.attachments.filter((a) => a.id !== this.attachmentId);
    const slot = data.slots.find((s) => s.id === this.slotId);
    if (!slot) return;
    if (this.target === 'default') slot.defaultAttachmentId = this.beforeSlotValue ?? null;
    else {
      const skin = data.skins.find((s) => s.name === data.activeSkin);
      if (!skin) return;
      if (this.beforeSlotValue === undefined || this.beforeSlotValue === null) delete skin.attachments[this.slotId];
      else skin.attachments[this.slotId] = this.beforeSlotValue;
    }
    this.engine.skeleton.rebuild();
  }

  private assign(id: string): void {
    const data = this.engine.skeleton.data;
    const slot = data.slots.find((s) => s.id === this.slotId)!;
    if (this.target === 'default') slot.defaultAttachmentId = id;
    else {
      const skin = data.skins.find((s) => s.name === data.activeSkin);
      if (!skin) throw new Error(`AddPolygonAttachmentCommand: active skin "${data.activeSkin}" not found.`);
      skin.attachments[this.slotId] = id;
    }
  }
}

/** Sets where a clipping attachment stops clipping (null = last slot). */
export class SetClipEndSlotCommand implements Command {
  readonly label = 'Set Clip End';
  private readonly before: string | null;

  constructor(
    private engine: EditorEngine,
    private attachmentId: string,
    private endSlotId: string | null,
  ) {
    const a = engine.skeleton.data.attachments.find((x) => x.id === attachmentId);
    if (!a || a.type !== 'clipping') {
      throw new Error(`SetClipEndSlotCommand: clipping attachment "${attachmentId}" not found.`);
    }
    this.before = a.endSlotId ?? null;
  }

  do(): void {
    this.apply(this.endSlotId);
  }

  undo(): void {
    this.apply(this.before);
  }

  private apply(id: string | null): void {
    const a = this.engine.skeleton.data.attachments.find((x) => x.id === this.attachmentId);
    if (!a || a.type !== 'clipping') return;
    a.endSlotId = id;
  }
}

/** Everything referencing an attachment must be captured for a clean undo. */
interface RemoveAttachmentSnapshots {
  attachment: AttachmentData;
  /** Slots whose defaultAttachmentId pointed here. */
  defaultSlots: string[];
  /** skins' entries pointing here (skin name -> slot ids). */
  skinEntries: { skinName: string; slotIds: string[] }[];
  /** slotAttachment keyframes holding this id (timeline index + keyframe indices). */
  keyframes: { animName: string; timelineIndex: number; kfIndices: number[]; timeline: unknown }[];
}

/**
 * Removes an attachment and every reference: slots' defaultAttachmentId, skin
 * entries (validation requires known attachment ids), and slotAttachment
 * keyframes whose attachmentId pointed here.
 */
export class RemoveAttachmentCommand implements Command {
  readonly label: string;
  private snaps: RemoveAttachmentSnapshots | null = null;

  constructor(
    private engine: EditorEngine,
    readonly attachmentId: string,
  ) {
    const a = engine.skeleton.data.attachments.find((x) => x.id === attachmentId);
    if (!a) throw new Error(`RemoveAttachmentCommand: attachment "${attachmentId}" not found.`);
    this.label = `Delete Attachment ${a.name}`;
  }

  do(): void {
    const data = this.engine.skeleton.data;
    const attachment = data.attachments.find((a) => a.id === this.attachmentId);
    if (!attachment) return;

    const defaultSlots = data.slots.filter((s) => s.defaultAttachmentId === this.attachmentId).map((s) => s.id);
    const skinEntries = data.skins
      .map((skin) => ({
        skinName: skin.name,
        slotIds: Object.entries(skin.attachments)
          .filter(([, id]) => id === this.attachmentId)
          .map(([slotId]) => slotId),
      }))
      .filter((e) => e.slotIds.length > 0);
    const keyframes: RemoveAttachmentSnapshots['keyframes'] = [];
    for (const anim of this.engine.document.animations) {
      anim.timelines.forEach((tl, timelineIndex) => {
        if (tl.kind !== 'slotAttachment') return;
        const kfIndices = tl.keyframes.map((kf, i) => (kf.attachmentId === this.attachmentId ? i : -1)).filter((i) => i >= 0);
        if (kfIndices.length > 0) keyframes.push({ animName: anim.name, timelineIndex, kfIndices, timeline: structuredClone(tl) });
      });
    }
    this.snaps = { attachment: structuredClone(attachment), defaultSlots, skinEntries, keyframes };

    for (const slotId of defaultSlots) {
      data.slots.find((s) => s.id === slotId)!.defaultAttachmentId = null;
    }
    for (const { skinName, slotIds } of skinEntries) {
      const skin = data.skins.find((s) => s.name === skinName)!;
      for (const slotId of slotIds) delete skin.attachments[slotId];
    }
    for (const anim of this.engine.document.animations) {
      for (const tl of [...anim.timelines]) {
        if (tl.kind !== 'slotAttachment') continue;
        const before = tl.keyframes.length;
        tl.keyframes = tl.keyframes.filter((kf) => kf.attachmentId !== this.attachmentId);
        if (tl.keyframes.length !== before && tl.keyframes.length === 0) {
          anim.timelines.splice(anim.timelines.indexOf(tl), 1);
        }
      }
    }
    data.attachments = data.attachments.filter((a) => a.id !== this.attachmentId);
    this.engine.skeleton.rebuild();
  }

  undo(): void {
    if (!this.snaps) return;
    const data = this.engine.skeleton.data;
    data.attachments.push(structuredClone(this.snaps.attachment));
    for (const slotId of this.snaps.defaultSlots) {
      data.slots.find((s) => s.id === slotId)!.defaultAttachmentId = this.attachmentId;
    }
    for (const { skinName, slotIds } of this.snaps.skinEntries) {
      const skin = data.skins.find((s) => s.name === skinName)!;
      for (const slotId of slotIds) skin.attachments[slotId] = this.attachmentId;
    }
    for (const { animName, timelineIndex, timeline } of this.snaps.keyframes) {
      const anim = this.engine.document.animations.find((a) => a.name === animName);
      if (!anim) continue;
      if (timelineIndex < anim.timelines.length && anim.timelines[timelineIndex]!.kind === 'slotAttachment') {
        anim.timelines[timelineIndex] = structuredClone(timeline) as never;
      } else {
        anim.timelines.splice(Math.min(timelineIndex, anim.timelines.length), 0, structuredClone(timeline) as never);
      }
    }
    this.snaps = null;
    this.engine.skeleton.rebuild();
  }
}

/**
 * Switches which attachment a slot shows — writing the slot's default, or the
 * active skin's per-slot override (resetPose resolves skin over default).
 */
export class SetSlotAttachmentCommand implements Command {
  readonly label: string;
  private readonly before: string | null | undefined;

  constructor(
    private engine: EditorEngine,
    readonly slotId: string,
    private attachmentId: string | null,
    private target: AttachmentTarget,
  ) {
    const data = engine.skeleton.data;
    this.before =
      target === 'default'
        ? data.slots.find((s) => s.id === slotId)?.defaultAttachmentId ?? null
        : data.skins.find((s) => s.name === data.activeSkin)?.attachments[slotId];
    this.label = `Set Attachment${attachmentId ? ` ${attachmentId}` : ''}`;
  }

  do(): void {
    this.apply(this.attachmentId);
  }

  undo(): void {
    this.apply(this.before ?? null);
  }

  private apply(id: string | null): void {
    const data = this.engine.skeleton.data;
    const slot = data.slots.find((s) => s.id === this.slotId);
    if (!slot) return;
    if (this.target === 'default') {
      slot.defaultAttachmentId = id;
    } else {
      const skin = data.skins.find((s) => s.name === data.activeSkin);
      if (!skin) return;
      if (id === null) delete skin.attachments[this.slotId];
      else skin.attachments[this.slotId] = id;
    }
  }
}

export interface AttachmentPropsSnapshot {
  name: string;
  region: RegionParams;
}

/** Edits a region attachment's name/offset/size (vertices regenerated). */
export class SetAttachmentPropsCommand implements Command {
  readonly label: string;

  constructor(
    private engine: EditorEngine,
    private attachmentId: string,
    private before: AttachmentPropsSnapshot,
    private after: AttachmentPropsSnapshot,
  ) {
    this.label = `Edit Attachment ${after.name || before.name}`;
  }

  do(): void {
    this.apply(this.after);
  }

  undo(): void {
    this.apply(this.before);
  }

  private apply(snap: AttachmentPropsSnapshot): void {
    const a = this.engine.skeleton.data.attachments.find((x) => x.id === this.attachmentId);
    if (!a) throw new Error(`SetAttachmentPropsCommand: attachment "${this.attachmentId}" no longer exists.`);
    a.name = snap.name;
    a.vertices = regionVertices(snap.region);
  }
}
