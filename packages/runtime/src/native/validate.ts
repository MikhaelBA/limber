import {
  validateProject,
  LogicEventSampler,
  SECONDARY_STEP_SECONDS,
  type Curve,
  type RigNode,
} from '@limber/core';
import { materializeRuntimeProject } from './adapt';
import { deriveRuntimeFeatures, referencedRuntimeTextures } from './features';
import {
  RUNTIME_FEATURES,
  RuntimeFormatError,
  runtimeFail,
  type RuntimeProgram,
  type RuntimeTexture,
} from './model';
import { projectRuntimeShape } from './shape';
import { nativeDurationTicks } from './timing';
import { validateNativeEventWork } from './eventWork';

/** Checks canonical encoding and image signatures. Pixel decoding is a renderer/worker responsibility. */
export function validateRuntimeTexture(texture: RuntimeTexture): void {
  const { base64, id, mime } = texture;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  if (!base64.length || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64))
    runtimeFail(
      'INVALID_IMAGE_ENCODING',
      'Image pixels require canonical, nonempty base64.',
      id,
      'Reimport the image and export its embedded pixels again.',
    );
  if (
    (base64.endsWith('==') && alphabet.indexOf(base64.at(-3)!) & 15) ||
    (base64.endsWith('=') && !base64.endsWith('==') && alphabet.indexOf(base64.at(-2)!) & 3)
  )
    runtimeFail('INVALID_IMAGE_ENCODING', 'Image base64 has nonzero padding bits.', id);
  const bytes: number[] = [];
  for (let i = 0; i < Math.min(base64.length, 32); i += 4) {
    const n =
      alphabet.indexOf(base64[i]!) * 262144 +
      alphabet.indexOf(base64[i + 1]!) * 4096 +
      Math.max(0, alphabet.indexOf(base64[i + 2]!)) * 64 +
      Math.max(0, alphabet.indexOf(base64[i + 3]!));
    bytes.push(n >>> 16, (n >>> 8) & 255, n & 255);
  }
  const signature = (start: number, values: number[]) => values.every((v, i) => bytes[start + i] === v);
  const valid =
    mime === 'image/png'
      ? signature(0, [137, 80, 78, 71, 13, 10, 26, 10]) && base64.length >= 44
      : mime === 'image/jpeg'
        ? signature(0, [255, 216, 255]) && base64.length >= 8
        : signature(0, [82, 73, 70, 70]) && signature(8, [87, 69, 66, 80]) && base64.length >= 24;
  if (!valid)
    runtimeFail(
      'INVALID_IMAGE_SIGNATURE',
      `Embedded pixels do not match ${mime}.`,
      id,
      'Reimport a valid PNG, JPEG or WebP image.',
    );
}

function validateRuntimeRig(rig: RigNode): void {
  const { skeleton, animations } = rig;
  const names = new Set<string>();
  const bones = new Set(skeleton.bones.map((b) => b.id)),
    slots = new Set(skeleton.slots.map((s) => s.id));
  const attachments = new Set(skeleton.attachments.map((a) => a.id));
  const fail = (code: string, message: string): never => runtimeFail(code, message, rig.id);
  const boneOrder = new Map(skeleton.bones.map((bone, i) => [bone.id, i]));
  for (const [index, bone] of skeleton.bones.entries()) {
    if (!bone.id.trim() || !bone.name.trim()) fail('INVALID_ID', 'Bone IDs and names must be nonempty.');
    if (bone.parentId !== null && (boneOrder.get(bone.parentId) ?? Infinity) >= index)
      fail('INVALID_BONE_ORDER', 'Runtime bones must preserve parent-before-child weight index order.');
  }
  for (const slot of skeleton.slots) {
    if (!slot.id.trim() || !slot.name.trim()) fail('INVALID_ID', 'Slot IDs and names must be nonempty.');
    if (!Number.isInteger(slot.color) || slot.color < 0 || slot.color > 0xffffffff)
      fail('INVALID_COLOR', 'Setup slot color must be unsigned 0xRRGGBBAA.');
  }
  for (const attachment of skeleton.attachments) {
    if (!attachment.id.trim() || !attachment.name.trim())
      fail('INVALID_ID', 'Attachment IDs and names must be nonempty.');
    if (attachment.type === 'clipping' && attachment.endSlotId != null && !slots.has(attachment.endSlotId))
      fail('BROKEN_REFERENCE', 'Clipping end slot is missing from its rig.');
  }
  const curve = (curve: Curve) => {
    if (curve.type === 'bezier' && [curve.c1 ?? 1 / 3, curve.c3 ?? 2 / 3].some((n) => n < 0 || n > 1))
      fail('INVALID_CURVE', 'Bezier time handles must be within [0,1].');
  };
  for (const animation of animations) {
    if (!animation.name.trim() || names.has(animation.name))
      fail('DUPLICATE_CLIP_NAME', 'Rig clip names must be nonempty and unique.');
    names.add(animation.name);
    if (animation.duration < 0) fail('INVALID_CLIP', 'Rig clip duration must be nonnegative.');
    nativeDurationTicks(animation.duration, 'Rig clip duration');
    const events = new LogicEventSampler(
      Math.max(animation.duration, SECONDARY_STEP_SECONDS),
      animation.timelines.flatMap((t) => (t.kind === 'event' ? t.keyframes : [])),
    );
    events.validateLoop(animation.loop && animation.duration > 0);
    validateNativeEventWork(
      animation.duration,
      animation.timelines.reduce((count, t) => count + (t.kind === 'event' ? t.keyframes.length : 0), 0),
      animation.loop || !!rig.logic?.states.some((state) => state.clip === animation.name && state.loop),
      rig.id,
    );
    const targets = new Set<string>();
    for (const timeline of animation.timelines) {
      const target = JSON.stringify([
        timeline.kind,
        'boneId' in timeline
          ? timeline.boneId
          : 'slotId' in timeline
            ? timeline.slotId
            : 'attachmentId' in timeline
              ? timeline.attachmentId
              : '',
        'property' in timeline ? timeline.property : '',
      ]);
      if (timeline.kind !== 'event' && targets.has(target))
        fail('DUPLICATE_TRACK', 'Rig clip repeats a timeline target.');
      targets.add(target);
      if (
        ('boneId' in timeline && !bones.has(timeline.boneId)) ||
        ('slotId' in timeline && !slots.has(timeline.slotId)) ||
        ('attachmentId' in timeline && !attachments.has(timeline.attachmentId))
      )
        fail('BROKEN_REFERENCE', 'Rig timeline references a missing bone, slot or attachment.');
      let previous = -1;
      for (const key of timeline.keyframes) {
        if (
          key.time < 0 ||
          key.time > animation.duration ||
          (timeline.kind === 'event' ? key.time < previous : key.time <= previous)
        )
          fail('INVALID_KEY_TIME', 'Rig keys must be ordered and stay within clip duration.');
        previous = key.time;
        curve(key.curve);
        if (
          'value' in key &&
          timeline.kind === 'slotColor' &&
          (!Number.isInteger(key.value) || key.value < 0 || key.value > 0xffffffff)
        )
          fail('INVALID_COLOR', 'Slot color must be packed unsigned 0xRRGGBBAA.');
        if ('value' in key && timeline.kind === 'boneProperty' && !Number.isFinite(Math.fround(key.value)))
          fail('INVALID_NUMBER', 'Bone keys must fit finite Float32 pose precision.');
        if ('attachmentId' in key && key.attachmentId !== null && !attachments.has(key.attachmentId))
          fail('BROKEN_REFERENCE', 'Attachment key references a missing attachment.');
        if (
          'slotOrder' in key &&
          (key.slotOrder.length !== skeleton.slots.length ||
            new Set(key.slotOrder).size !== skeleton.slots.length ||
            key.slotOrder.some((n) => !Number.isInteger(n) || n < 0 || n >= skeleton.slots.length))
        )
          fail('INVALID_DRAW_ORDER', 'Draw order must be a full permutation of rig slots.');
      }
      if (timeline.kind === 'boneProperty')
        for (let i = 0; i + 1 < timeline.keyframes.length; i++) {
          const from = timeline.keyframes[i]!,
            to = timeline.keyframes[i + 1]!;
          if (
            from.curve.type === 'bezier' &&
            [from.curve.c2 ?? 1 / 3, from.curve.c4 ?? 1].some(
              (mix) => !Number.isFinite(Math.fround(from.value + (to.value - from.value) * mix)),
            )
          )
            fail('INVALID_NUMBER', 'Bone Bezier overshoot exceeds finite pose precision.');
        }
    }
  }
}

/** Validate and detach before returning any program to consumers. No source data is mutated. */
export function validateRuntimeProgram(input: unknown): RuntimeProgram {
  if (!input || typeof input !== 'object' || !('format' in input) || input.format !== 'bonebybone-runtime')
    runtimeFail(
      'WRONG_FORMAT',
      'Expected a compiled BoneByBone runtime program.',
      null,
      'Compile the source .bbbproj rather than renaming it to .bbb.',
    );
  if (!('version' in input) || input.version !== 1)
    runtimeFail(
      'UNSUPPORTED_VERSION',
      'This runtime accepts only the native v1 schema.',
      null,
      'Use a compatible runtime or recompile with the supported exporter.',
    );
  const program = projectRuntimeShape(input, true) as RuntimeProgram;
  for (const feature of program.features)
    if (!RUNTIME_FEATURES.includes(feature))
      runtimeFail(
        'UNSUPPORTED_FEATURE',
        `Runtime v1 does not support ${feature}.`,
        program.id,
        'Use a compatible runtime or remove the unsupported feature before export.',
      );
  const required = deriveRuntimeFeatures(program);
  if (JSON.stringify(required) !== JSON.stringify(program.features))
    runtimeFail(
      'FEATURE_MISMATCH',
      'Feature requirements must exactly match the sorted derived capabilities.',
      program.id,
      'Recompile the source project; do not edit the feature manifest by hand.',
    );
  const textures = new Set<string>();
  for (const texture of program.textures) {
    if (!texture.id.trim() || textures.has(texture.id))
      runtimeFail('DUPLICATE_ASSET', 'Texture IDs must be nonempty and unique.', texture.id);
    textures.add(texture.id);
    validateRuntimeTexture(texture);
  }
  const referenced = referencedRuntimeTextures(program);
  for (const id of referenced)
    if (!textures.has(id))
      runtimeFail(
        'MISSING_PIXELS',
        'A referenced image has no shipping pixels.',
        id,
        'Embed the referenced image in the source project and export again.',
      );
  for (const id of textures)
    if (!referenced.has(id))
      runtimeFail(
        'UNUSED_ASSET',
        'The runtime contains an unreferenced texture.',
        id,
        'Recompile to remove unused source assets.',
      );
  if (!program.artboards.some((board) => board.id === program.defaultArtboardId))
    runtimeFail('BROKEN_REFERENCE', 'Default runtime artboard does not exist.', program.defaultArtboardId);
  const { project, ephemeralOwners } = materializeRuntimeProject(program);
  try {
    for (const board of project.artboards)
      for (const clip of board.clips ?? []) {
        nativeDurationTicks(clip.duration, 'Scene clip duration');
        validateNativeEventWork(
          clip.duration,
          clip.events.length,
          clip.loop || !!board.logic?.states.some((state) => state.clip === clip.id && state.loop),
          clip.id,
        );
      }
    for (const container of [...project.artboards, ...(project.components ?? [])])
      for (const node of container.nodes) if (node.type === 'rig') validateRuntimeRig(node);
    validateProject(project);
  } catch (error) {
    if (error instanceof RuntimeFormatError) throw error;
    const code =
      error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
        ? error.code
        : 'INVALID_DATA';
    const rawId =
      error && typeof error === 'object' && 'objectId' in error && typeof error.objectId === 'string'
        ? error.objectId
        : null;
    runtimeFail(
      code,
      error instanceof Error ? error.message : 'Runtime semantic validation failed.',
      rawId === null ? program.id : (ephemeralOwners.get(rawId) ?? rawId),
    );
  }
  return program;
}
