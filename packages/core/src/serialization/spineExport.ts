import type { Animation, Curve, Timeline } from '../types/animation';
import type { AttachmentData, SkeletonData } from '../types/data';
import type { EditorDocument } from '../types/document';
import { createPose } from '../skeleton/pose';
import { solveFK } from '../skeleton/FKSolver';
import { Skeleton } from '../skeleton/Skeleton';
import { validateDeformTimelines } from '../animation/validateDeforms';
import { activeRigNode, type BoneByBoneProject } from '../project/model';

/** Guard before converting a project to the legacy rig-only export view. */
export function assertSpineProjectSupported(project: BoneByBoneProject): void {
  const board = project.artboards.find((a) => a.id === project.editor.activeArtboardId);
  if (board?.logic || activeRigNode(project)?.logic)
    throw new Error('Native Logic graphs cannot be represented by Spine export; save the native project.');
}

/**
 * Spine-runtime JSON export (skeleton format 4.1).
 *
 * Conversions (Limber → Spine):
 * - ids → NAMES everywhere (bones/slots/attachments are unique by name).
 * - Y-FLIP: Limber is y-down (Pixi), Spine is y-up. The conjugation
 *   F·L·F (F = diag(1,-1)) gives: y → −y, rotation → −rotation,
 *   shearX → −shearX, shearY → −shearY; scales and lengths are unchanged.
 *   Angles come out in DEGREES (Spine convention).
 * - Mesh vertices are REORDERED hull-first (Spine's `hull` is a COUNT and
 *   assumes the boundary ring is the vertex prefix). Rigid meshes export as
 *   plain pairs (slot-bone local, y-flipped); as soon as ANY vertex carries
 *   weights the whole mesh exports in the interleaved
 *   [count, boneIndex, x, y, weight, …] form, where each influence's (x, y)
 *   lives in ITS OWN bone's local space (Mᵢ⁻¹ · M_slot · v at setup).
 * - draw-order keys export as Spine's sequential slot "offsets" diffs.
 * - Our per-property timelines (x, y, scaleX, …) merge into Spine's packed
 *   translate/scale/shear tracks at the UNION of key times; a property without
 *   a key at that time holds its last keyed value (fidelity note: linear
 *   in-between sampling can differ when the pair's key times mismatch).
 *
 * Textures: attachment `path` = the manifest texture name (sans extension),
 * or the override from `uniqueTexturePaths` when exporting a bundle (so the
 * JSON paths and the packed atlas regions agree exactly).
 */

const SPINE_VERSION = '4.2.120';
const DEG = 180 / Math.PI;

interface Json {
  [k: string]: unknown;
}

export function exportSpineJson(
  doc: EditorDocument,
  texturePaths?: Map<string, string>,
  warnings?: string[],
): string {
  if (doc.skeleton.paths?.length || doc.skeleton.pathConstraints?.length)
    throw new Error(
      'Native paths require BoneByBone project save; this compatibility export cannot preserve their semantics.',
    );
  if (doc.skeleton.secondaryConstraints?.length)
    throw new Error(
      'Native secondary motion requires BoneByBone project save; this compatibility export cannot preserve its semantics.',
    );
  if (doc.skeleton.transformConstraints?.length)
    throw new Error(
      'Spine export does not support native transform follow constraints. Save the native .bbbproj to retain constraints.',
    );
  if (doc.skeleton.ikConstraints.some((c) => c.poleVectorId !== null || c.softness !== 0))
    throw new Error(
      'Spine export does not support native IK pole/soft-reach semantics. Save the native .bbbproj to retain constraints.',
    );
  if (doc.skeleton.attachments.some((attachment) => attachment.meshSourceId !== undefined))
    throw new Error(
      'Spine export does not support shared meshes yet. Detach shared meshes before exporting.',
    );
  validateDeformTimelines(doc.skeleton, doc.animations);
  if (doc.skeleton.attachments.some((attachment) => attachment.boneBindings)) {
    throw new Error(
      'Spine export does not support native mesh bindings. Save the native .bbbproj to retain bone bindings.',
    );
  }
  if (doc.skeleton.markers?.length) {
    const warning =
      'Spine export omits BoneByBone markers; keep the native .bbbproj for sockets and hit areas.';
    if (!warnings) throw new Error(warning);
    warnings.push(warning);
  }
  // Skeleton also re-validates — a corrupt document throws instead of
  // exporting silently-broken JSON.
  const skeleton = new Skeleton(doc.skeleton);
  const data = skeleton.data;
  const pose = createPose(data);
  solveFK(data, skeleton.boneIndexMap, pose);
  const wm = pose.worldMatrices;

  const boneName = new Map(data.bones.map((b) => [b.id, b.name]));
  const slotName = new Map(data.slots.map((s) => [s.id, s.name]));
  const attName = new Map(data.attachments.map((a) => [a.id, a.name]));

  const out: Json = {};

  // ---- skeleton header: world-space attachment bounds (setup pose) ----
  const bounds = attachmentBounds(data, skeleton, wm);
  if (bounds) {
    out.skeleton = {
      hash: '',
      spine: SPINE_VERSION,
      x: round(bounds.minX),
      y: round(-bounds.maxY), // Spine's rect origin is bottom-left, y-up.
      width: round(bounds.maxX - bounds.minX),
      height: round(bounds.maxY - bounds.minY),
    };
  }

  // ---- bones (already topologically sorted = parents first) ----
  out.bones = data.bones.map((b) => {
    const o: Json = { name: b.name };
    if (b.parentId !== null) o.parent = boneName.get(b.parentId)!;
    o.length = round(b.length);
    o.x = round(b.setupPose.x);
    o.y = round(-b.setupPose.y);
    o.rotation = round(-b.setupPose.rotation * DEG);
    o.scaleX = round(b.setupPose.scaleX);
    o.scaleY = round(b.setupPose.scaleY);
    o.shearX = round(-b.setupPose.shearX * DEG);
    o.shearY = round(-b.setupPose.shearY * DEG);
    return o;
  });

  // ---- slots (array order IS the default draw order) ----
  out.slots = data.slots.map((s) => {
    const o: Json = { name: s.name, bone: boneName.get(s.boneId)! };
    if (s.defaultAttachmentId !== null) o.attachment = attName.get(s.defaultAttachmentId) ?? null;
    o.color = colorString(s.color);
    if (s.blendMode === 'add') o.blend = 'add';
    return o;
  });

  // ---- ik ----
  if (data.ikConstraints.length > 0) {
    out.ik = data.ikConstraints.map((c, i) => ({
      name: `ik${i + 1}`,
      bones: c.bones.map((id) => boneName.get(id)!),
      target: boneName.get(c.targetId)!,
      bendDirection: c.bendDirection,
      mix: round(c.mix),
      softness: round(c.softness),
      order: c.order,
    }));
  }

  // ---- skins ----
  const skins: Json[] = [];
  const defaultAttachments: Json = {};
  for (const slot of data.slots) {
    if (slot.defaultAttachmentId === null) continue;
    const att = data.attachments.find((a) => a.id === slot.defaultAttachmentId);
    if (!att) continue;
    const perSlot = (defaultAttachments[slotName.get(slot.id)!] ??= {}) as Json;
    perSlot[att.name] = attachmentJson(att, slot.id, data, skeleton, wm, doc, texturePaths);
  }
  if (Object.keys(defaultAttachments).length > 0)
    skins.push({ name: 'default', attachments: defaultAttachments });
  for (const skin of data.skins) {
    if (skin.name === '' || skin.name === 'default') continue; // '' = none; 'default' merges above.
    const perSlotTree: Json = {};
    for (const [slotId, attId] of Object.entries(skin.attachments)) {
      const att = data.attachments.find((a) => a.id === attId);
      if (!att) continue;
      const perSlot = (perSlotTree[slotName.get(slotId) ?? slotId] ??= {}) as Json;
      perSlot[att.name] = attachmentJson(att, slotId, data, skeleton, wm, doc, texturePaths);
    }
    skins.push({ name: skin.name, attachments: perSlotTree });
  }
  if (skins.length > 0) out.skins = skins;

  // ---- events (definitions collected from every animation's keyframes) ----
  const eventDefs: Json = {};
  for (const anim of doc.animations) {
    for (const tl of anim.timelines) {
      if (tl.kind !== 'event') continue;
      for (const kf of tl.keyframes) {
        if (!(kf.eventName in eventDefs)) {
          eventDefs[kf.eventName] =
            typeof kf.payload === 'number' ? { int: kf.payload } : { string: String(kf.payload ?? '') };
        }
      }
    }
  }
  if (Object.keys(eventDefs).length > 0) out.events = eventDefs;

  // ---- animations ----
  const animations: Json = {};
  for (const anim of doc.animations) {
    animations[anim.name] = animationJson(anim, data, boneName, slotName, attName);
  }
  if (Object.keys(animations).length > 0) out.animations = animations;

  return JSON.stringify(out, null, 2);
}

// ---------------- helpers ----------------

function round(v: number): number {
  return Math.round(v * 1e5) / 1e5;
}

/** 0xRRGGBBAA packed → Spine "rrggbbaa" string. */
function colorString(c: number): string {
  return c.toString(16).padStart(8, '0').toLowerCase();
}

/** Setup-pose world bounds over every slot-visible attachment. */
function attachmentBounds(
  data: SkeletonData,
  skeleton: Skeleton,
  wm: Float32Array,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let any = false;
  for (const slot of data.slots) {
    if (!slot.defaultAttachmentId) continue;
    const att = skeleton.attachmentById.get(slot.defaultAttachmentId);
    if (!att) continue;
    const local = att.type === 'region' ? att.vertices : att.meshVertices;
    if (!local) continue;
    const bi = skeleton.boneIndexMap.get(slot.boneId)!;
    const o = bi * 6;
    for (let k = 0; k < local.length; k += 2) {
      const x = wm[o]! * local[k]! + wm[o + 2]! * local[k + 1]! + wm[o + 4]!;
      const y = wm[o + 1]! * local[k]! + wm[o + 3]! * local[k + 1]! + wm[o + 5]!;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      any = true;
    }
  }
  return any ? { minX, minY, maxX, maxY } : null;
}

/** Spine curve value: "stepped" | [c1,c2,c3,c4] | omitted (linear). */
function curveJson(curve: Curve, valueFlip: (v: number) => number): unknown {
  if (curve.type === 'stepped') return 'stepped';
  if (curve.type === 'linear') return 'linear';
  return [curve.c1 ?? 0, valueFlip(curve.c2 ?? 0), curve.c3 ?? 1, valueFlip(curve.c4 ?? 1)];
}

/** weightEntryAt over the interleaved array (kept local — core copy). */
function weightEntryOf(w: number[], vertexIndex: number): { start: number; count: number } | null {
  let p = 0;
  for (let v = 0; v <= vertexIndex; v++) {
    if (p >= w.length) return null;
    const count = w[p]! | 0;
    if (v === vertexIndex) return { start: p, count };
    p += 1 + count * 2;
  }
  return null;
}

/** Mesh vertex reorder: hull ring first (Spine convention), interior after. */
function hullFirstPermutation(att: AttachmentData): number[] {
  const count = (att.meshVertices?.length ?? 0) / 2;
  const hull = att.meshHull ?? Array.from({ length: count }, (_, i) => i);
  const perm = [...hull];
  const inHull = new Set(hull);
  for (let i = 0; i < count; i++) if (!inHull.has(i)) perm.push(i);
  return perm;
}

/**
 * One attachment in Spine JSON form. `slotId` picks the bone whose local space
 * the attachment's vertices live in (and the deform export tree position).
 */
function attachmentJson(
  att: AttachmentData,
  slotId: string,
  data: SkeletonData,
  skeleton: Skeleton,
  wm: Float32Array,
  doc: EditorDocument,
  texturePaths?: Map<string, string>,
): Json {
  const path =
    texturePaths?.get(att.textureId) ??
    (doc.assetManifest[att.textureId]?.name ?? att.textureId).replace(/\.[a-z0-9]+$/i, '');
  if (att.type === 'boundingBox' || att.type === 'clipping') {
    // Untextured polygons: plain slot-bone-local pairs (y-flipped). Spine's
    // type strings are lowercase.
    const vs = att.meshVertices ?? [];
    const verts: number[] = [];
    for (let k = 0; k < vs.length; k += 2) verts.push(round(vs[k]!), round(-vs[k + 1]!));
    const o: Json = {
      type: att.type === 'boundingBox' ? 'boundingbox' : 'clipping',
      name: att.name,
      vertexCount: vs.length / 2,
      vertices: verts,
    };
    if (att.type === 'clipping') {
      const endName = att.endSlotId ? data.slots.find((s) => s.id === att.endSlotId)?.name : undefined;
      if (endName) o.end = endName;
    }
    return o;
  }
  if (att.type === 'region') {
    const v = att.vertices ?? [0, 0, 1, 0, 1, 1, 0, 1];
    return {
      type: 'region',
      name: att.name,
      path,
      x: round((v[0]! + v[4]!) / 2),
      y: round(-(v[1]! + v[5]!) / 2),
      width: round(Math.abs(v[2]! - v[0]!)),
      height: round(Math.abs(v[5]! - v[1]!)),
      rotation: 0,
    };
  }

  const vertices = att.meshVertices ?? [];
  const uvs = att.meshUVs ?? [];
  const triangles = att.meshTriangles ?? [];
  const weights = att.weights;
  const slotBoneIndex = skeleton.boneIndexMap.get(data.slots.find((s) => s.id === slotId)!.boneId)!;
  const perm = hullFirstPermutation(att);
  const inverseIndex = new Map(perm.map((old, neu) => [old, neu]));
  const weighted = weights !== undefined;

  const outVerts: number[] = [];
  for (const old of perm) {
    const x = vertices[old * 2]!;
    const y = vertices[old * 2 + 1]!;
    if (!weighted) {
      outVerts.push(round(x), round(-y));
      continue;
    }
    const entry = weightEntryOf(weights, old);
    const count = entry?.count ?? 0;
    if (count === 0) {
      outVerts.push(1, slotBoneIndex, round(x), round(-y), 1);
      continue;
    }
    // Per-influence bone-local coordinates: Mᵢ⁻¹ · M_slot · v (setup pose).
    const wx = wm[slotBoneIndex * 6]! * x + wm[slotBoneIndex * 6 + 2]! * y + wm[slotBoneIndex * 6 + 4]!;
    const wy = wm[slotBoneIndex * 6 + 1]! * x + wm[slotBoneIndex * 6 + 3]! * y + wm[slotBoneIndex * 6 + 5]!;
    outVerts.push(count);
    let p = entry!.start + 1;
    for (let e = 0; e < count; e++) {
      const bi = weights[p]! | 0;
      const w = weights[p + 1]!;
      outVerts.push(bi);
      outVerts.push(...boneLocalOf(wm, bi, wx, wy).map((c) => round(c)));
      outVerts.push(round(w));
      p += 2;
    }
  }

  const remappedTriangles = triangles.map((t) => inverseIndex.get(t)!);
  const remappedUvs: number[] = [];
  for (const old of perm) remappedUvs.push(round(uvs[old * 2] ?? 0), round(uvs[old * 2 + 1] ?? 0));

  return {
    type: 'mesh',
    name: att.name,
    path,
    uvs: remappedUvs,
    vertices: outVerts,
    triangles: remappedTriangles,
    hull: att.meshHull?.length ?? vertices.length / 2,
  };
}

/** world point → bone `boneIndex`'s local space (2×3 inverse, no allocation API). */
function boneLocalOf(wm: Float32Array, boneIndex: number, wx: number, wy: number): [number, number] {
  const o = boneIndex * 6;
  const a = wm[o]!;
  const b = wm[o + 1]!;
  const c = wm[o + 2]!;
  const d = wm[o + 3]!;
  const det = a * d - b * c;
  const dx = wx - wm[o + 4]!;
  const dy = wy - wm[o + 5]!;
  return [(d * dx - c * dy) / det, (a * dy - b * dx) / det];
}

/** Our per-property timelines → Spine's packed bone tracks. */
function animationJson(
  anim: Animation,
  data: SkeletonData,
  boneName: Map<string, string>,
  slotName: Map<string, string>,
  attName: Map<string, string>,
): Json {
  const out: Json = {};

  // ---- bone tracks (4.2 semantics, verified against spine-core) ----
  // rotate/translate/shear keyframes are OFFSETS FROM THE SETUP POSE; scale is
  // ABSOLUTE. The y-flip conjugation applies to the DELTAS:
  //   translate: x: v−setup.x · y: −(v−setup.y)
  //   rotate/shear (degrees out): −(v−setup)·DEG · scale: v unchanged.
  const pairs: {
    a: 'x' | 'scaleX' | 'shearX';
    b: 'y' | 'scaleY' | 'shearY';
    track: string;
    fa: (v: number, setup: number) => number;
    fb: (v: number, setup: number) => number;
  }[] = [
    { a: 'x', b: 'y', track: 'translate', fa: (v, s) => v - s, fb: (v, s) => -(v - s) },
    { a: 'scaleX', b: 'scaleY', track: 'scale', fa: (v) => v, fb: (v) => v },
    { a: 'shearX', b: 'shearY', track: 'shear', fa: (v, s) => -(v - s) * DEG, fb: (v, s) => -(v - s) * DEG },
  ];
  const bones: Json = {};
  for (const bone of data.bones) {
    const tl = (prop: string) =>
      anim.timelines.find(
        (t): t is Extract<Timeline, { kind: 'boneProperty' }> =>
          t.kind === 'boneProperty' && t.boneId === bone.id && t.property === prop,
      );
    const rotate = tl('rotation');
    const perBone: Json = {};
    if (rotate) {
      const setupRot = bone.setupPose.rotation;
      perBone.rotate = rotate.keyframes.map((kf) => {
        // 4.2 JSON reads the single-value field as "value" (4.1's "angle" is
        // silently ignored — values collapse to 0; caught by the runtime test).
        const o: Json = { time: round(kf.time), value: round(-(kf.value - setupRot) * DEG) };
        if (kf.curve.type !== 'linear') o.curve = curveJson(kf.curve, (v) => -v * DEG);
        return o;
      });
    }
    for (const p of pairs) {
      const ta = tl(p.a);
      const tb = tl(p.b);
      if (!ta && !tb) continue;
      const times = [
        ...new Set([...(ta?.keyframes ?? []), ...(tb?.keyframes ?? [])].map((k) => round(k.time))),
      ].sort((x, y) => x - y);
      const track = times.map((t) => {
        const ka = heldKeyframe(ta, t);
        const kb = heldKeyframe(tb, t);
        const o: Json = { time: t };
        // Missing timeline ⇒ the raw value IS the setup value: offset tracks
        // collapse to 0 (hold setup) and absolute scale holds its setup value.
        o.x = round(p.fa(ka?.value ?? bone.setupPose[p.a], bone.setupPose[p.a]));
        o.y = round(p.fb(kb?.value ?? bone.setupPose[p.b], bone.setupPose[p.b]));
        // Curve only from a keyframe EXACTLY at this time — a held key's curve
        // must not leak onto the merged keyframe.
        const exact = [ta, tb]
          .flatMap((tl) => tl?.keyframes ?? [])
          .find((kf) => Math.abs(kf.time - t) < 1e-6);
        if (exact && exact.curve.type !== 'linear') {
          // Shared pair curve: value-space flip from the y component (approx —
          // one curve serves both axes in Spine).
          o.curve = curveJson(exact.curve, (v) => p.fb(v, 0));
        }
        return o;
      });
      perBone[p.track] = track;
    }
    if (Object.keys(perBone).length > 0) bones[bone.name] = perBone;
  }
  if (Object.keys(bones).length > 0) out.bones = bones;

  // ---- slot tracks ----
  const slots: Json = {};
  for (const slot of data.slots) {
    const perSlot: Json = {};
    const color = anim.timelines.find(
      (t): t is Extract<Timeline, { kind: 'slotColor' }> => t.kind === 'slotColor' && t.slotId === slot.id,
    );
    if (color) {
      perSlot.rgba = color.keyframes.map((kf) => ({
        time: round(kf.time),
        color: colorString(kf.value),
        ...(kf.curve.type === 'stepped' ? { curve: 'stepped' } : {}),
      }));
    }
    const attach = anim.timelines.find(
      (t): t is Extract<Timeline, { kind: 'slotAttachment' }> =>
        t.kind === 'slotAttachment' && t.slotId === slot.id,
    );
    if (attach) {
      perSlot.attachment = attach.keyframes.map((kf) => ({
        time: round(kf.time),
        name: kf.attachmentId === null ? null : (attName.get(kf.attachmentId) ?? null),
        ...(kf.curve.type === 'stepped' ? { curve: 'stepped' } : {}),
      }));
    }
    if (Object.keys(perSlot).length > 0) slots[slot.name] = perSlot;
  }
  if (Object.keys(slots).length > 0) out.slots = slots;

  // ---- draw order (sequential offsets vs the previous configuration) ----
  const drawOrder = anim.timelines.find(
    (t): t is Extract<Timeline, { kind: 'drawOrder' }> => t.kind === 'drawOrder',
  );
  if (drawOrder) {
    let prev = data.slots.map((_, i) => i); // identity = array order
    out['draw-order'] = drawOrder.keyframes.map((kf) => {
      const next = kf.slotOrder;
      const posOf = (arr: number[], slotIdx: number) => arr.indexOf(slotIdx);
      const offsets: { slot: number; offset: number }[] = [];
      for (let pos = 0; pos < next.length; pos++) {
        const s = next[pos]!;
        const old = posOf(prev, s);
        if (old !== pos) offsets.push({ slot: s, offset: pos - old });
      }
      offsets.sort((x, y) => x.offset - y.offset);
      prev = [...next];
      const o: Json = { time: round(kf.time) };
      if (offsets.length > 0) o.offsets = offsets;
      return o;
    });
  }

  // ---- deform ----
  const deform: Json = {};
  for (const tl of anim.timelines) {
    if (tl.kind !== 'deform') continue;
    const att = data.attachments.find((a) => a.id === tl.attachmentId);
    if (!att) continue;
    // A deform track hangs under the slot(s) that can show the attachment.
    const slotId =
      data.slots.find((s) => s.defaultAttachmentId === tl.attachmentId)?.id ??
      data.slots.find((s) => data.skins.some((sk) => sk.attachments[s.id] === tl.attachmentId))?.id;
    if (!slotId) continue;
    const tree = (deform['default'] ??= {}) as Json;
    const perSlot = (tree[slotName.get(slotId)!] ??= {}) as Json;
    perSlot[att.name] = tl.keyframes.map((kf) => {
      const o: Json = { time: round(kf.time) };
      if (kf.offsets) {
        const v: number[] = [];
        for (let k = 0; k < kf.offsets.length; k += 2)
          v.push(round(kf.offsets[k]!), round(-kf.offsets[k + 1]!));
        o.vertices = v;
      }
      if (kf.curve.type === 'stepped') o.curve = 'stepped';
      return o;
    });
  }
  if (Object.keys(deform).length > 0) out.deform = deform;

  // ---- events ----
  const events = anim.timelines.find((t): t is Extract<Timeline, { kind: 'event' }> => t.kind === 'event');
  if (events) {
    out.events = events.keyframes.map((kf) => {
      const o: Json = { time: round(kf.time), name: kf.eventName };
      if (typeof kf.payload === 'number') o.int = kf.payload;
      else if (typeof kf.payload === 'string') o.string = kf.payload;
      return o;
    });
  }

  return out;
}

/** The keyframe at exactly `t`, else the last one before it (held value). */
function heldKeyframe(
  tl: Extract<Timeline, { kind: 'boneProperty' }> | undefined,
  t: number,
): (Extract<Timeline, { kind: 'boneProperty' }>['keyframes'][number] & { time: number }) | undefined {
  if (!tl) return undefined;
  let held;
  for (const kf of tl.keyframes) {
    if (Math.abs(kf.time - t) < 1e-6) return kf;
    if (kf.time < t) held = kf;
    else break;
  }
  return held;
}
