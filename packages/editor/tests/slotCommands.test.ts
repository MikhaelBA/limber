import { describe, expect, it } from 'vitest';
import type { Animation, Timeline } from '@limber/core';
import { EditorEngine } from '../src/engine/EditorEngine';
import { HistoryManager, CompositeCommand } from '../src/history/history';
import { AddBoneCommand } from '../src/commands/boneCommands';
import {
  AddSlotCommand,
  RemoveSlotCommand,
  SetSlotPropsCommand,
  ReorderSlotCommand,
  SetSlotBlendCommand,
} from '../src/commands/slotCommands';
import {
  AddTextureCommand,
  AddAttachmentCommand,
  RemoveAttachmentCommand,
  SetSlotAttachmentCommand,
  SetAttachmentPropsCommand,
  regionOf,
  regionVertices,
} from '../src/commands/attachmentCommands';
import { AddSkinCommand, RemoveSkinCommand, SetActiveSkinCommand } from '../src/commands/skinCommands';
import {
  AddAnimationCommand,
  KeySlotColorCommand,
  DeleteSlotColorKeyframeCommand,
  KeyDrawOrderCommand,
  DeleteDrawOrderKeyframeCommand,
} from '../src/commands/animationCommands';

const TEX = 'tex-1';
const RED = 0xff0000ff;

type SlotColorTl = Extract<Timeline, { kind: 'slotColor' }>;
type DrawOrderTl = Extract<Timeline, { kind: 'drawOrder' }>;
type SlotAttTl = Extract<Timeline, { kind: 'slotAttachment' }>;

const slotColorTl = (anim: Animation) => anim.timelines.find((t): t is SlotColorTl => t.kind === 'slotColor');
const drawOrderTl = (anim: Animation) => anim.timelines.find((t): t is DrawOrderTl => t.kind === 'drawOrder');
const slotAttTl = (anim: Animation) =>
  anim.timelines.find((t): t is SlotAttTl => t.kind === 'slotAttachment');

/** Engine with one animation active + animate mode (keying preconditions). */
function animEngine(): { engine: EditorEngine; anim: Animation } {
  const engine = new EditorEngine();
  const cmd = new AddAnimationCommand(engine);
  cmd.do();
  engine.setAnimation(cmd.name);
  engine.mode = 'animate';
  return { engine, anim: engine.currentAnimation! };
}

describe('AddSlotCommand', () => {
  it('adds a slot bound to the bone, rebuilds, and generates unique names', () => {
    const engine = new EditorEngine();
    const rootId = engine.skeleton.data.bones[0]!.id;
    const a = new AddSlotCommand(engine, rootId);
    const b = new AddSlotCommand(engine, rootId);
    a.do();
    b.do();
    const slots = engine.skeleton.data.slots;
    expect(slots.map((s) => s.name)).toEqual(['slot', 'slot2']);
    expect(slots.every((s) => s.boneId === rootId)).toBe(true);
    expect(engine.skeleton.slotIndexMap.size).toBe(2);
    // Slot pose arrays stay parallel to the data.
    expect(engine.skeleton.pose.slots).toHaveLength(2);
    a.undo();
    b.undo();
    expect(engine.skeleton.data.slots).toHaveLength(0);
    b.do();
    expect(engine.skeleton.data.slots[0]!.name).toBe('slot2'); // Names chosen at first do().
  });
});

describe('RemoveSlotCommand', () => {
  it('preserves animated draw order, clipping boundaries and exact undo/redo state', () => {
    const { engine, anim } = animEngine();
    const data = engine.skeleton.data;
    const ids = Array.from({ length: 3 }, () => {
      const command = new AddSlotCommand(engine, data.bones[0]!.id);
      command.do();
      return command.slotId;
    });
    data.attachments.push({
      id: 'clip',
      name: 'clip',
      type: 'clipping',
      textureId: '',
      vertices: [0, 0, 10, 0, 10, 10],
      endSlotId: ids[1]!,
    });
    anim.timelines.push({
      kind: 'drawOrder',
      keyframes: [
        { time: 0, curve: { type: 'stepped' }, slotOrder: [2, 1, 0] },
        { time: 1, curve: { type: 'stepped' }, slotOrder: [1, 0, 2] },
      ],
    });
    anim.timelines.push({
      kind: 'slotColor',
      slotId: ids[1]!,
      keyframes: [{ time: 0, curve: { type: 'linear' }, value: RED }],
    });
    engine.skeleton.rebuild();
    const before = structuredClone(engine.document);
    const history = new HistoryManager();
    history.execute(new RemoveSlotCommand(engine, ids[1]!));
    expect(data.slots.map((s) => s.id)).toEqual([ids[0], ids[2]]);
    expect(drawOrderTl(anim)!.keyframes.map((k) => k.slotOrder)).toEqual([
      [1, 0],
      [0, 1],
    ]);
    expect(data.attachments[0]!.endSlotId).toBe(ids[2]);
    engine.scrub(0);
    engine.tick(0);
    expect(engine.skeleton.pose.slotOrder.map((i) => data.slots[i]!.id)).toEqual([ids[2], ids[0]]);
    const after = structuredClone(engine.document);
    history.undo();
    expect(engine.document).toEqual(before);
    history.redo();
    expect(engine.document).toEqual(after);
    history.undo();
    history.execute(new RemoveSlotCommand(engine, ids[2]!));
    expect(drawOrderTl(anim)!.keyframes.map((k) => k.slotOrder)).toEqual([
      [1, 0],
      [1, 0],
    ]);
    history.undo();
    expect(engine.document).toEqual(before);
  });

  it('adds slots to every animated permutation and removes the last clipping boundary safely', () => {
    const { engine, anim } = animEngine();
    const root = engine.skeleton.data.bones[0]!.id;
    const first = new AddSlotCommand(engine, root);
    first.do();
    new KeyDrawOrderCommand(engine).do();
    const second = new AddSlotCommand(engine, root);
    second.do();
    expect(drawOrderTl(anim)!.keyframes[0]!.slotOrder).toEqual([0, 1]);
    second.undo();
    expect(drawOrderTl(anim)!.keyframes[0]!.slotOrder).toEqual([0]);
    engine.skeleton.data.attachments.push({
      id: 'clip',
      name: 'clip',
      type: 'clipping',
      textureId: '',
      vertices: [0, 0, 1, 0, 1, 1],
      endSlotId: first.slotId,
    });
    const remove = new RemoveSlotCommand(engine, first.slotId);
    remove.do();
    expect(engine.skeleton.data.attachments[0]!.endSlotId).toBeNull();
    expect(drawOrderTl(anim)!.keyframes[0]!.slotOrder).toEqual([]);
    remove.undo();
    expect(engine.skeleton.data.attachments[0]!.endSlotId).toBe(first.slotId);
  });

  it('rejects invalid slot changes before mutating data, pose or redo history', () => {
    const { engine, anim } = animEngine();
    const root = engine.skeleton.data.bones[0]!.id;
    const slot = new AddSlotCommand(engine, root);
    slot.do();
    const history = new HistoryManager();
    history.execute(new SetSlotBlendCommand(engine, slot.slotId, 'add'));
    history.undo();
    const before = structuredClone(engine.document);
    const pose = structuredClone(engine.skeleton.pose);
    expect(() => history.execute(new AddSlotCommand(engine, 'missing-bone'))).toThrow(/unknown boneId/);
    const props = { name: 'slot', boneId: root, color: 0xffffffff };
    expect(() =>
      history.execute(
        new SetSlotPropsCommand(engine, slot.slotId, props, { ...props, boneId: 'missing-bone' }),
      ),
    ).toThrow(/unknown boneId/);
    expect(engine.document).toEqual(before);
    expect(engine.skeleton.pose).toEqual(pose);
    expect(history.canRedo).toBe(true);
    anim.timelines.push({
      kind: 'drawOrder',
      keyframes: [{ time: 0, curve: { type: 'stepped' }, slotOrder: [42] }],
    });
    const malformed = structuredClone(engine.document);
    expect(() => history.execute(new RemoveSlotCommand(engine, slot.slotId))).toThrow(/invalid draw-order/);
    expect(engine.document).toEqual(malformed);
    expect(history.canRedo).toBe(true);
  });

  it('cleans skin entries and slot timelines; undo restores everything', () => {
    const { engine, anim } = animEngine();
    const data = engine.skeleton.data;
    const rootId = data.bones[0]!.id;
    const slotCmd = new AddSlotCommand(engine, rootId);
    slotCmd.do();
    const slotId = slotCmd.slotId;

    new AddTextureCommand(engine, TEX, 'spot.png').do();
    const att = new AddAttachmentCommand(engine, slotId, {
      textureId: TEX,
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });
    att.do();
    const skinCmd = new AddSkinCommand(engine);
    skinCmd.do();
    new SetActiveSkinCommand(engine, skinCmd.name).do(); // Skin overrides write to the ACTIVE skin.
    new SetSlotAttachmentCommand(engine, slotId, att.attachmentId, 'skin').do();
    new KeySlotColorCommand(engine, slotId, RED).do(); // slotColor timeline on the slot

    expect(slotColorTl(anim)).toBeDefined();
    const rm = new RemoveSlotCommand(engine, slotId);
    rm.do();
    expect(data.slots).toHaveLength(0);
    expect(data.skins[0]!.attachments).toEqual({});
    expect(slotColorTl(anim)).toBeUndefined();
    expect(() => engine.skeleton.rebuild()).not.toThrow();

    rm.undo();
    expect(data.slots).toHaveLength(1);
    expect(data.skins[0]!.attachments[slotId]).toBe(att.attachmentId);
    expect(slotColorTl(anim)?.slotId).toBe(slotId);
    expect(() => engine.skeleton.rebuild()).not.toThrow();
  });
});

describe('SetSlotPropsCommand', () => {
  it('edits name/color and re-binds the bone with a rebuild', () => {
    const engine = new EditorEngine();
    const data = engine.skeleton.data;
    const rootId = data.bones[0]!.id;
    const slotCmd = new AddSlotCommand(engine, rootId);
    slotCmd.do();

    const boneCmd = new AddBoneCommand(engine, null, { x: 50, y: 0 });
    boneCmd.do();

    const before = { name: 'slot', boneId: rootId, color: 0xffffffff };
    const after = { name: 'arm', boneId: boneCmd.boneId, color: RED };
    const cmd = new SetSlotPropsCommand(engine, slotCmd.slotId, before, after);
    cmd.do();
    const slot = data.slots[0]!;
    expect(slot.name).toBe('arm');
    expect(slot.boneId).toBe(boneCmd.boneId);
    expect(slot.color).toBe(RED);
    expect(() => engine.skeleton.rebuild()).not.toThrow();
    cmd.undo();
    expect(data.slots[0]!.boneId).toBe(rootId);
    expect(data.slots[0]!.color).toBe(0xffffffff);
  });
});

describe('AddTextureCommand', () => {
  it('records and removes the manifest entry', () => {
    const engine = new EditorEngine();
    const cmd = new AddTextureCommand(engine, TEX, 'spot.png');
    cmd.do();
    expect(engine.document.assetManifest[TEX]).toEqual({ name: 'spot.png', source: 'embedded' });
    cmd.undo();
    expect(engine.document.assetManifest[TEX]).toBeUndefined();
    cmd.do();
    expect(engine.document.assetManifest[TEX]!.name).toBe('spot.png');
  });
});

describe('AddAttachmentCommand', () => {
  it('creates a region assigned to the slot default, named from the texture', () => {
    const engine = new EditorEngine();
    const rootId = engine.skeleton.data.bones[0]!.id;
    new AddTextureCommand(engine, TEX, 'head.png').do();
    const slotCmd = new AddSlotCommand(engine, rootId);
    slotCmd.do();
    const cmd = new AddAttachmentCommand(engine, slotCmd.slotId, {
      textureId: TEX,
      x: 5,
      y: -5,
      width: 20,
      height: 10,
    });
    cmd.do();

    const att = engine.skeleton.data.attachments[0]!;
    expect(att.name).toBe('head'); // Texture name minus extension.
    expect(att.type).toBe('region');
    expect(att.vertices).toEqual(regionVertices({ x: 5, y: -5, width: 20, height: 10 }));
    expect(att.uvs).toEqual([0, 0, 1, 0, 1, 1, 0, 1]);
    expect(engine.skeleton.data.slots[0]!.defaultAttachmentId).toBe(att.id);
    // The pose resolves the new attachment after the next reset+apply.
    engine.tick(0);
    expect(engine.skeleton.pose.slots[0]!.attachmentId).toBe(att.id);

    cmd.undo();
    expect(engine.skeleton.data.attachments).toHaveLength(0);
    expect(engine.skeleton.data.slots[0]!.defaultAttachmentId).toBeNull();
    cmd.do();
    expect(engine.skeleton.data.slots[0]!.defaultAttachmentId).toBe(cmd.attachmentId);
  });

  it('works inside a CompositeCommand constructed before the slot exists (drop flow)', () => {
    const engine = new EditorEngine();
    const rootId = engine.skeleton.data.bones[0]!.id;
    const slotCmd = new AddSlotCommand(engine, rootId);
    const attCmd = new AddAttachmentCommand(engine, slotCmd.slotId, {
      textureId: TEX,
      x: 0,
      y: 0,
      width: 8,
      height: 8,
    });
    const composite = new CompositeCommand('Drop Image spot.png', [
      new AddTextureCommand(engine, TEX, 'spot.png'),
      slotCmd,
      attCmd,
    ]);
    composite.do();
    expect(engine.document.assetManifest[TEX]!.name).toBe('spot.png');
    expect(engine.skeleton.data.attachments[0]!.name).toBe('spot');
    expect(engine.skeleton.data.slots[0]!.defaultAttachmentId).toBe(attCmd.attachmentId);
    composite.undo();
    expect(engine.skeleton.data.slots).toHaveLength(0);
    expect(engine.skeleton.data.attachments).toHaveLength(0);
    expect(engine.document.assetManifest[TEX]).toBeUndefined();
  });

  it('assigns to the active skin when target is skin', () => {
    const engine = new EditorEngine();
    const rootId = engine.skeleton.data.bones[0]!.id;
    const slotCmd = new AddSlotCommand(engine, rootId);
    slotCmd.do();
    const skinCmd = new AddSkinCommand(engine);
    skinCmd.do();
    new SetActiveSkinCommand(engine, skinCmd.name).do();

    const cmd = new AddAttachmentCommand(
      engine,
      slotCmd.slotId,
      { textureId: TEX, x: 0, y: 0, width: 4, height: 4 },
      'skin',
    );
    cmd.do();
    expect(engine.skeleton.data.slots[0]!.defaultAttachmentId).toBeNull();
    expect(engine.skeleton.data.skins[0]!.attachments[slotCmd.slotId]).toBe(cmd.attachmentId);
    // resetPose resolves the skin override.
    engine.tick(0);
    expect(engine.skeleton.pose.slots[0]!.attachmentId).toBe(cmd.attachmentId);
    cmd.undo();
    expect(engine.skeleton.data.skins[0]!.attachments[slotCmd.slotId]).toBeUndefined();
  });
});

describe('SetSlotAttachmentCommand', () => {
  it('switches the shown attachment (default and skin targets)', () => {
    const engine = new EditorEngine();
    const data = engine.skeleton.data;
    const rootId = data.bones[0]!.id;
    const slotCmd = new AddSlotCommand(engine, rootId);
    slotCmd.do();
    const slotId = slotCmd.slotId;
    const a1 = new AddAttachmentCommand(engine, slotId, { textureId: TEX, x: 0, y: 0, width: 4, height: 4 });
    a1.do();
    const a2 = new AddAttachmentCommand(engine, slotId, { textureId: TEX, x: 0, y: 0, width: 6, height: 6 });
    a2.do();

    const cmd = new SetSlotAttachmentCommand(engine, slotId, a1.attachmentId, 'default');
    cmd.do();
    expect(data.slots[0]!.defaultAttachmentId).toBe(a1.attachmentId);
    cmd.undo();
    expect(data.slots[0]!.defaultAttachmentId).toBe(a2.attachmentId);

    // Skin target: writing creates the entry, undo removes it again.
    const skinCmd = new AddSkinCommand(engine);
    skinCmd.do();
    new SetActiveSkinCommand(engine, skinCmd.name).do();
    const skinSet = new SetSlotAttachmentCommand(engine, slotId, a2.attachmentId, 'skin');
    skinSet.do();
    expect(data.skins[0]!.attachments[slotId]).toBe(a2.attachmentId);
    skinSet.undo();
    expect(data.skins[0]!.attachments[slotId]).toBeUndefined();
  });
});

describe('RemoveAttachmentCommand', () => {
  it('clears slot defaults, skin entries and slotAttachment keyframes; undo restores', () => {
    const { engine, anim } = animEngine();
    const data = engine.skeleton.data;
    const rootId = data.bones[0]!.id;
    const slotCmd = new AddSlotCommand(engine, rootId);
    slotCmd.do();
    const slotId = slotCmd.slotId;
    const att = new AddAttachmentCommand(engine, slotId, { textureId: TEX, x: 0, y: 0, width: 4, height: 4 });
    att.do();

    const skinCmd = new AddSkinCommand(engine);
    skinCmd.do();
    new SetActiveSkinCommand(engine, skinCmd.name).do();
    new SetSlotAttachmentCommand(engine, slotId, att.attachmentId, 'skin').do();

    // A slotAttachment timeline referencing the attachment.
    anim.timelines.push({
      kind: 'slotAttachment',
      slotId,
      keyframes: [
        { time: 0, attachmentId: null, curve: { type: 'stepped' } },
        { time: 0.5, attachmentId: att.attachmentId, curve: { type: 'stepped' } },
      ],
    });

    const rm = new RemoveAttachmentCommand(engine, att.attachmentId);
    rm.do();
    expect(data.attachments).toHaveLength(0);
    expect(data.slots[0]!.defaultAttachmentId).toBeNull();
    expect(data.skins[0]!.attachments).toEqual({});
    expect(slotAttTl(anim)!.keyframes).toHaveLength(1); // Only the null key survives.
    expect(slotAttTl(anim)!.keyframes[0]!.attachmentId).toBeNull();
    expect(() => engine.skeleton.rebuild()).not.toThrow();

    rm.undo();
    expect(data.attachments).toHaveLength(1);
    expect(data.slots[0]!.defaultAttachmentId).toBe(att.attachmentId);
    expect(data.skins[0]!.attachments[slotId]).toBe(att.attachmentId);
    expect(slotAttTl(anim)!.keyframes).toHaveLength(2);
  });
});

describe('SetAttachmentPropsCommand', () => {
  it('regenerates region vertices from x/y/w/h', () => {
    const engine = new EditorEngine();
    const rootId = engine.skeleton.data.bones[0]!.id;
    const slotCmd = new AddSlotCommand(engine, rootId);
    slotCmd.do();
    const att = new AddAttachmentCommand(engine, slotCmd.slotId, {
      textureId: TEX,
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });
    att.do();

    const cmd = new SetAttachmentPropsCommand(
      engine,
      att.attachmentId,
      { name: 'region', region: { textureId: TEX, x: 0, y: 0, width: 10, height: 10 } },
      { name: 'head2', region: { textureId: TEX, x: 10, y: 0, width: 20, height: 5 } },
    );
    cmd.do();
    const a = engine.skeleton.data.attachments[0]!;
    expect(a.name).toBe('head2');
    expect(a.vertices).toEqual(regionVertices({ x: 10, y: 0, width: 20, height: 5 }));
    cmd.undo();
    expect(engine.skeleton.data.attachments[0]!.vertices).toEqual(
      regionVertices({ x: 0, y: 0, width: 10, height: 10 }),
    );
  });

  it('regionOf round-trips x/y/w/h through the corner array (height uses BR.y)', () => {
    const engine = new EditorEngine();
    const rootId = engine.skeleton.data.bones[0]!.id;
    const slotCmd = new AddSlotCommand(engine, rootId);
    slotCmd.do();
    const att = new AddAttachmentCommand(engine, slotCmd.slotId, {
      textureId: TEX,
      x: 5,
      y: -3,
      width: 64,
      height: 32,
    });
    att.do();
    expect(regionOf(engine.skeleton.data.attachments[0]!)).toEqual({
      textureId: TEX,
      x: 5,
      y: -3,
      width: 64,
      height: 32,
    });
  });
});

describe('ReorderSlotCommand', () => {
  it('moves the slot in the default draw order and remaps drawOrder keyframes by slot id', () => {
    const { engine, anim } = animEngine();
    const data = engine.skeleton.data;
    const rootId = data.bones[0]!.id;
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const c = new AddSlotCommand(engine, rootId);
      c.do();
      ids.push(c.slotId);
    }
    engine.currentTime = 0;
    new KeyDrawOrderCommand(engine).do(); // Key [0, 1, 2] at t=0 (identity).
    expect(drawOrderTl(anim)!.keyframes[0]!.slotOrder).toEqual([0, 1, 2]);

    const cmd = new ReorderSlotCommand(engine, ids[2]!, -1); // [s0, s2, s1]
    cmd.do();
    expect(data.slots.map((s) => s.id)).toEqual([ids[0], ids[2], ids[1]]);
    // The keyframe permutation follows the SLOT IDENTITIES, not raw indices:
    // draw position 1 still shows s1 (now index 2), position 2 shows s2 (now 1).
    expect(drawOrderTl(anim)!.keyframes[0]!.slotOrder).toEqual([0, 2, 1]);

    // Applying the timeline reproduces the SAME visual order as before the
    // reorder (s0, s1, s2) even though the data array order changed.
    engine.scrub(0);
    engine.tick(0);
    expect([...engine.skeleton.pose.slotOrder]).toEqual([0, 2, 1]);

    cmd.undo();
    expect(data.slots.map((s) => s.id)).toEqual([ids[0], ids[1], ids[2]]);
    expect(drawOrderTl(anim)!.keyframes[0]!.slotOrder).toEqual([0, 1, 2]);
  });

  it('is a no-op at the array edges', () => {
    const engine = new EditorEngine();
    const rootId = engine.skeleton.data.bones[0]!.id;
    const a = new AddSlotCommand(engine, rootId);
    a.do();
    const cmd = new ReorderSlotCommand(engine, a.slotId, -1);
    cmd.do();
    expect(engine.skeleton.data.slots).toHaveLength(1);
  });
});

describe('Skins', () => {
  it('rejects unknown activation atomically and keeps animation while switching skins', () => {
    const { engine, anim } = animEngine();
    const slot = new AddSlotCommand(engine, engine.skeleton.data.bones[0]!.id);
    slot.do();
    const first = new AddAttachmentCommand(engine, slot.slotId, {
      textureId: TEX,
      x: 0,
      y: 0,
      width: 4,
      height: 4,
    });
    first.do();
    const second = new AddAttachmentCommand(engine, slot.slotId, {
      textureId: TEX,
      x: 0,
      y: 0,
      width: 8,
      height: 8,
    });
    second.do();
    const skin = new AddSkinCommand(engine);
    skin.do();
    new SetActiveSkinCommand(engine, skin.name).do();
    new SetSlotAttachmentCommand(engine, slot.slotId, first.attachmentId, 'skin').do();
    anim.timelines.push({
      kind: 'slotAttachment',
      slotId: slot.slotId,
      keyframes: [{ time: 0.5, curve: { type: 'stepped' }, attachmentId: second.attachmentId }],
    });
    const tracks = structuredClone(anim.timelines);
    engine.scrub(0);
    engine.tick(0);
    expect(engine.skeleton.pose.slots[0]!.attachmentId).toBe(first.attachmentId);
    engine.scrub(1);
    engine.tick(0);
    expect(engine.skeleton.pose.slots[0]!.attachmentId).toBe(second.attachmentId);
    const history = new HistoryManager();
    history.execute(new SetActiveSkinCommand(engine, ''));
    history.undo();
    const before = structuredClone(engine.document);
    const pose = structuredClone(engine.skeleton.pose);
    expect(() => history.execute(new SetActiveSkinCommand(engine, 'missing'))).toThrow(/not found/);
    expect(engine.document).toEqual(before);
    expect(engine.skeleton.pose).toEqual(pose);
    expect(history.canRedo).toBe(true);
    expect(anim.timelines).toEqual(tracks);
    history.redo();
    engine.tick(0);
    expect(engine.skeleton.pose.slots[0]!.attachmentId).toBe(second.attachmentId);
  });

  it('add/remove/select with validation and active-skin fallback', () => {
    const engine = new EditorEngine();
    const data = engine.skeleton.data;
    const s1 = new AddSkinCommand(engine);
    s1.do();
    const s2 = new AddSkinCommand(engine);
    s2.do();
    expect(data.skins.map((s) => s.name)).toEqual(['skin', 'skin2']);

    const set = new SetActiveSkinCommand(engine, s2.name);
    set.do();
    expect(data.activeSkin).toBe('skin2');
    set.undo();
    expect(data.activeSkin).toBe('');

    expect(() => new SetActiveSkinCommand(engine, 'nope').do()).toThrow(/not found/);

    const rm = new RemoveSkinCommand(engine, s2.name);
    rm.do();
    expect(data.skins).toHaveLength(1);
    rm.undo();
    expect(data.skins.map((s) => s.name)).toEqual(['skin', 'skin2']);

    // Removing the ACTIVE skin falls back to '' (and undo restores activity).
    new SetActiveSkinCommand(engine, s2.name).do();
    const rmActive = new RemoveSkinCommand(engine, s2.name);
    rmActive.do();
    expect(data.activeSkin).toBe('');
    rmActive.undo();
    expect(data.activeSkin).toBe('skin2');
  });

  it('resetPose resolves skin override over the slot default', () => {
    const engine = new EditorEngine();
    const rootId = engine.skeleton.data.bones[0]!.id;
    const slotCmd = new AddSlotCommand(engine, rootId);
    slotCmd.do();
    const slotId = slotCmd.slotId;
    const a1 = new AddAttachmentCommand(engine, slotId, { textureId: TEX, x: 0, y: 0, width: 4, height: 4 });
    a1.do();
    const a2 = new AddAttachmentCommand(engine, slotId, { textureId: TEX, x: 0, y: 0, width: 6, height: 6 });
    a2.do();

    const skinCmd = new AddSkinCommand(engine);
    skinCmd.do();
    new SetActiveSkinCommand(engine, skinCmd.name).do();
    new SetSlotAttachmentCommand(engine, slotId, a2.attachmentId, 'skin').do();
    new SetSlotAttachmentCommand(engine, slotId, a1.attachmentId, 'default').do();
    new SetActiveSkinCommand(engine, '').do(); // Deactivate: ticks below resolve the DEFAULT.

    engine.tick(0);
    expect(engine.skeleton.pose.slots[0]!.attachmentId).toBe(a1.attachmentId); // No active skin yet.
    new SetActiveSkinCommand(engine, skinCmd.name).do();
    engine.tick(0);
    expect(engine.skeleton.pose.slots[0]!.attachmentId).toBe(a2.attachmentId);
    new SetActiveSkinCommand(engine, '').do();
    engine.tick(0);
    expect(engine.skeleton.pose.slots[0]!.attachmentId).toBe(a1.attachmentId);
  });
});

describe('Slot color & draw order keyframes', () => {
  it('keys, interpolates, and deletes slot color', () => {
    const { engine, anim } = animEngine();
    const rootId = engine.skeleton.data.bones[0]!.id;
    const slotCmd = new AddSlotCommand(engine, rootId);
    slotCmd.do();

    engine.currentTime = 0;
    new KeySlotColorCommand(engine, slotCmd.slotId, 0xff0000ff).do();
    engine.currentTime = 1;
    new KeySlotColorCommand(engine, slotCmd.slotId, 0xff000000).do(); // Fade to transparent red.
    expect(slotColorTl(anim)!.keyframes).toHaveLength(2);

    engine.scrub(0.5);
    engine.tick(0);
    const c = engine.skeleton.pose.slots[0]!.color;
    expect(c & 0xff).toBe(0x80); // Linear ALPHA halfway (RGBA: alpha is the LOW byte).

    const del = new DeleteSlotColorKeyframeCommand(engine, slotCmd.slotId, 1);
    del.do();
    expect(slotColorTl(anim)!.keyframes).toHaveLength(1); // The t=0 key survives.
    del.undo();
    expect(slotColorTl(anim)!.keyframes).toHaveLength(2);
  });

  it('keys and applies draw order permutations (stepped)', () => {
    const { engine, anim } = animEngine();
    const data = engine.skeleton.data;
    const rootId = data.bones[0]!.id;
    for (let i = 0; i < 3; i++) new AddSlotCommand(engine, rootId).do();

    engine.currentTime = 0;
    new KeyDrawOrderCommand(engine).do(); // identity [0,1,2]
    engine.currentTime = 1;
    new KeyDrawOrderCommand(engine, [2, 0, 1]).do(); // explicit reorder at t=1

    expect(drawOrderTl(anim)!.keyframes[1]!.curve.type).toBe('stepped');

    engine.scrub(1);
    engine.tick(0);
    expect([...engine.skeleton.pose.slotOrder]).toEqual([2, 0, 1]);
    engine.scrub(0.5);
    engine.tick(0);
    expect([...engine.skeleton.pose.slotOrder]).toEqual([0, 1, 2]); // Stepped: holds key 0 until t=1.
    engine.scrub(0);
    engine.tick(0);
    expect([...engine.skeleton.pose.slotOrder]).toEqual([0, 1, 2]);

    const del = new DeleteDrawOrderKeyframeCommand(engine, 1);
    del.do();
    expect(drawOrderTl(anim)!.keyframes).toHaveLength(1); // The t=0 key survives.
    del.undo();
    expect(drawOrderTl(anim)!.keyframes).toHaveLength(2);
  });

  it('upsert semantics: re-keying the same time replaces, not appends', () => {
    const { engine, anim } = animEngine();
    const rootId = engine.skeleton.data.bones[0]!.id;
    const slotCmd = new AddSlotCommand(engine, rootId);
    slotCmd.do();
    engine.currentTime = 0.5;
    new KeySlotColorCommand(engine, slotCmd.slotId, RED).do();
    new KeySlotColorCommand(engine, slotCmd.slotId, 0x00ff00ff).do();
    expect(slotColorTl(anim)!.keyframes).toHaveLength(1);
    expect(slotColorTl(anim)!.keyframes[0]!.value).toBe(0x00ff00ff);
  });

  it("KeySlotColorCommand defaults to the slot's current pose color", () => {
    const { engine, anim } = animEngine();
    const data = engine.skeleton.data;
    const rootId = data.bones[0]!.id;
    const slotCmd = new AddSlotCommand(engine, rootId);
    slotCmd.do();
    data.slots[0]!.color = 0x11223344;
    engine.tick(0); // resetPose copies slot.color into the pose.
    new KeySlotColorCommand(engine, slotCmd.slotId).do();
    expect(slotColorTl(anim)!.keyframes[0]!.value).toBe(0x11223344);
  });
});

describe('HistoryManager + CompositeCommand', () => {
  it('one history entry for a multi-part command, undone in reverse', () => {
    const engine = new EditorEngine();
    const rootId = engine.skeleton.data.bones[0]!.id;
    const history = new HistoryManager();
    const slotCmd = new AddSlotCommand(engine, rootId);
    const attCmd = new AddAttachmentCommand(engine, slotCmd.slotId, {
      textureId: TEX,
      x: 0,
      y: 0,
      width: 8,
      height: 8,
    });
    history.execute(
      new CompositeCommand('Drop Image spot.png', [
        new AddTextureCommand(engine, TEX, 'spot.png'),
        slotCmd,
        attCmd,
      ]),
    );
    expect(history.canUndo).toBe(true);
    expect(engine.skeleton.data.slots).toHaveLength(1);

    history.undo();
    expect(engine.skeleton.data.slots).toHaveLength(0);
    expect(engine.skeleton.data.attachments).toHaveLength(0);
    expect(engine.document.assetManifest[TEX]).toBeUndefined();
    history.redo();
    expect(engine.skeleton.data.slots).toHaveLength(1);
    expect(engine.skeleton.data.slots[0]!.defaultAttachmentId).toBe(attCmd.attachmentId);
  });
});

describe('SetSlotBlendCommand (Phase 7)', () => {
  it('toggles additive blending with undo', () => {
    const engine = new EditorEngine();
    const rootId = engine.skeleton.data.bones[0]!.id;
    const add = new AddSlotCommand(engine, rootId);
    add.do();
    const cmd = new SetSlotBlendCommand(engine, add.slotId, 'add');
    cmd.do();
    expect(engine.skeleton.data.slots[0]!.blendMode).toBe('add');
    cmd.undo();
    expect(engine.skeleton.data.slots[0]!.blendMode ?? 'normal').toBe('normal');
    cmd.do();
    expect(engine.skeleton.data.slots[0]!.blendMode).toBe('add');
  });
});
