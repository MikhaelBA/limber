import type { AttachmentData, BoneData, SkeletonData } from '../types/data';
import type { Animation, BonePropertyTimeline, Curve, Timeline } from '../types/animation';
import type { EditorDocument } from '../types/document';
import { Skeleton } from '../skeleton/Skeleton';
import { solveFK } from '../skeleton/FKSolver';
import { validateDeformTimelines } from '../animation/validateDeforms';
import { validateAnimationEvents } from '../animation/eventPayload';
import { invertAffine, multiplyAffine } from '../math/affine';

type Obj = Record<string, unknown>;
const rad = Math.PI / 180;
const linear: Curve = { type: 'linear' };
const stepped: Curve = { type: 'stepped' };
function fail(message: string): never {
  throw new Error(`Spine import: ${message}`);
}
function obj(value: unknown, label: string): Obj {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`);
  return value as Obj;
}
function list(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) fail(`${label} must be an array.`);
  return value;
}
function str(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) fail(`${label} must be a nonempty name.`);
  return value;
}
function num(value: unknown, fallback = 0): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(Math.fround(value))) fail('Invalid numeric value.');
  return value;
}
function nums(value: unknown, label: string): number[] {
  return list(value, label).map((v) => num(v));
}
function color(value: unknown, fallback = 0xffffffff): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[\da-f]{6}([\da-f]{2})?$/i.test(value)) fail('Invalid RGBA color.');
  return parseInt(value.length === 6 ? `${value}ff` : value, 16);
}
function absent(value: Obj, fields: string[], label: string): void {
  for (const field of fields)
    if (
      value[field] !== undefined &&
      value[field] !== false &&
      value[field] !== 0 &&
      !(Array.isArray(value[field]) && !value[field].length)
    )
      fail(`${label}: ${field} is not supported yet.`);
}
function frames(value: unknown): Obj[] {
  let previous = -1;
  return list(value, 'Keyframes').map((v) => {
    const k = obj(v, 'Keyframe'),
      time = num(k.time);
    if (time < 0 || time <= previous) fail('Key times must increase strictly from zero.');
    previous = time;
    return k;
  });
}
function curve(k: Obj, next: Obj | undefined, a = 0, b = 1, channel = 0): Curve {
  if (k.curve === undefined || !next) return linear;
  if (k.curve === 'stepped') return stepped;
  const points = nums(k.curve, 'Bezier curve'),
    offset = channel * 4;
  if (points.length < offset + 4 || points.length % 4) fail('Incomplete Bezier controls.');
  const dt = num(next.time) - num(k.time),
    dv = b - a;
  if (!dv) {
    if (points[offset + 1] !== a || points[offset + 3] !== a)
      fail('Bezier with equal endpoints and varying value controls cannot be preserved yet.');
    return linear;
  }
  const c: Curve = {
    type: 'bezier',
    c1: (points[offset]! - num(k.time)) / dt,
    c2: (points[offset + 1]! - a) / dv,
    c3: (points[offset + 2]! - num(k.time)) / dt,
    c4: (points[offset + 3]! - a) / dv,
  };
  if (c.c1! < 0 || c.c1! > 1 || c.c3! < 0 || c.c3! > 1)
    fail('Bezier time controls leave their key interval.');
  return c;
}

export interface SpineImportResult {
  document: EditorDocument;
  /** Texture ID -> local image or atlas region name. No network URLs are loaded. */
  images: Map<string, string>;
  skin: string;
}

function skins(root: Obj): Map<string, Obj> {
  const result = new Map<string, Obj>();
  for (const v of list(root.skins ?? [], 'Spine skins')) {
    const skin = obj(v, 'Skin'),
      name = str(skin.name, 'Skin name');
    if (result.has(name)) fail(`Duplicate skin "${name}".`);
    absent(skin, ['bones', 'ik', 'transform', 'path', 'physics'], `Skin "${name}"`);
    result.set(name, obj(skin.attachments ?? {}, 'Skin attachments'));
  }
  return result;
}
export function spineSkinNames(json: string): string[] {
  const root = obj(JSON.parse(json), 'Spine JSON');
  const header = obj(root.skeleton, 'Spine header');
  if (!/^4\.2\./.test(str(header.spine, 'Spine version')))
    fail('Use a Spine 4.2 JSON export. Other versions and .spine/.skel files are not supported yet.');
  return [...skins(root).keys()];
}

/** Import one selected Spine skin plus default fallback into an editable native rig.
 * Refuse incompatible semantics rather than silently discarding animation data.
 */
export function importSpineJson(json: string, selectedSkin = 'default'): SpineImportResult {
  spineSkinNames(json);
  const root = obj(JSON.parse(json), 'Spine JSON'),
    available = skins(root);
  if (available.size && !available.has(selectedSkin)) fail(`Skin "${selectedSkin}" was not found.`);
  absent(root, ['ik', 'transform', 'path', 'physics'], 'Skeleton constraints');
  const skeleton: SkeletonData = {
    bones: [],
    slots: [],
    attachments: [],
    ikConstraints: [],
    skins: [],
    activeSkin: '',
  };
  const boneMap = new Map<string, BoneData>();
  for (const v of list(root.bones, 'Spine bones')) {
    const b = obj(v, 'Bone'),
      name = str(b.name, 'Bone name');
    if (boneMap.has(name)) fail(`Duplicate bone "${name}".`);
    if (b.parent !== undefined && !boneMap.has(str(b.parent, 'Bone parent')))
      fail(`Missing or unordered parent of "${name}".`);
    if ((b.transform ?? b.inherit ?? 'normal') !== 'normal')
      fail(`Bone "${name}" uses unsupported transform inheritance.`);
    absent(b, ['skin'], `Bone "${name}"`);
    if (num(b.shearX) || num(b.shearY))
      fail(`Bone "${name}" uses Spine shear, which has different native semantics.`);
    const bone: BoneData = {
      id: `spine:bone:${name}`,
      name,
      parentId: b.parent === undefined ? null : boneMap.get(String(b.parent))!.id,
      length: num(b.length),
      setupPose: {
        x: num(b.x),
        y: -num(b.y),
        rotation: -num(b.rotation) * rad,
        scaleX: num(b.scaleX, 1),
        scaleY: num(b.scaleY, 1),
        shearX: 0,
        shearY: 0,
      },
      ...(b.color === undefined ? {} : { color: color(b.color) >>> 8 }),
    };
    boneMap.set(name, bone);
    skeleton.bones.push(bone);
  }
  const rawSlots = list(root.slots ?? [], 'Spine slots').map((v) => obj(v, 'Slot'));
  for (const s of rawSlots) {
    const name = str(s.name, 'Slot name'),
      bone = boneMap.get(str(s.bone, 'Slot bone'));
    if (!bone) fail(`Missing bone for slot "${name}".`);
    if (skeleton.slots.some((s) => s.name === name)) fail(`Duplicate slot "${name}".`);
    absent(s, ['dark'], `Slot "${name}"`);
    const blend = s.blend ?? 'normal';
    if (!['normal', 'additive', 'add'].includes(String(blend)))
      fail(`Slot "${name}" uses unsupported ${String(blend)} blend.`);
    skeleton.slots.push({
      id: `spine:slot:${name}`,
      name,
      boneId: bone.id,
      color: color(s.color),
      defaultAttachmentId: null,
      blendMode: blend === 'normal' ? 'normal' : 'add',
    });
  }
  const setup = new Skeleton(skeleton);
  solveFK(skeleton, setup.boneIndexMap, setup.pose);
  const wm = setup.pose.worldMatrices,
    inv = new Float64Array(wm.length);
  for (let i = 0; i < skeleton.bones.length; i++)
    if (!invertAffine(inv, i * 6, wm, i * 6)) fail('Singular setup bones cannot be imported.');
  const images = new Map<string, string>(),
    manifest: EditorDocument['assetManifest'] = Object.create(null);
  const attachmentMap = new Map<string, AttachmentData>();
  const weightedRows = new Map<string, { bi: number; x: number; y: number; weight: number }[][]>();
  const merged: Obj = Object.create(null);
  for (const tree of [available.get('default'), available.get(selectedSkin)]) {
    for (const [slot, value] of Object.entries(tree ?? {}))
      merged[slot] = { ...obj(merged[slot] ?? {}, 'Slot attachments'), ...obj(value, 'Slot attachments') };
  }
  for (const [slotName, value] of Object.entries(merged)) {
    const slot = skeleton.slots.find((s) => s.name === slotName);
    if (!slot) fail(`Attachment references missing slot "${slotName}".`);
    const slotIndex = setup.boneIndexMap.get(slot.boneId)!;
    for (const [key, v] of Object.entries(obj(value, 'Attachments'))) {
      const a = obj(v, 'Attachment'),
        type = a.type ?? 'region';
      if (!['region', 'mesh', 'boundingbox', 'clipping'].includes(String(type)))
        fail(`Attachment "${key}" uses unsupported ${String(type)}.`);
      absent(a, ['sequence', 'parent'], `Attachment "${key}"`);
      if (a.color !== undefined && color(a.color) !== 0xffffffff && (type === 'region' || type === 'mesh'))
        fail(`Attachment "${key}" has an unsupported attachment tint.`);
      const id = `spine:attachment:${JSON.stringify([slotName, key])}`;
      const textured = type === 'region' || type === 'mesh';
      const path = str(a.path ?? a.name ?? key, 'Image path'),
        textureId = textured ? `spine:texture:${path}` : '';
      if (textured) {
        images.set(textureId, path);
        manifest[textureId] = { name: `${path}.png`, source: 'embedded' };
      }
      const attachment: AttachmentData = {
        id,
        name: key,
        textureId,
        type: type === 'boundingbox' ? 'boundingBox' : (type as AttachmentData['type']),
      };
      if (type === 'region') {
        const width = num(a.width),
          height = num(a.height),
          r = -num(a.rotation) * rad;
        if (width <= 0 || height <= 0) fail(`Region "${key}" needs positive dimensions.`);
        attachment.vertices = [];
        for (const [x, y] of [
          [-width / 2, -height / 2],
          [width / 2, -height / 2],
          [width / 2, height / 2],
          [-width / 2, height / 2],
        ]) {
          const sx = x! * num(a.scaleX, 1),
            sy = y! * num(a.scaleY, 1);
          attachment.vertices.push(
            Math.cos(r) * sx - Math.sin(r) * sy + num(a.x),
            Math.sin(r) * sx + Math.cos(r) * sy - num(a.y),
          );
        }
        attachment.uvs = [0, 0, 1, 0, 1, 1, 0, 1];
      } else {
        const uv = type === 'mesh' ? nums(a.uvs, 'Mesh UVs') : [],
          count = type === 'mesh' ? uv.length / 2 : num(a.vertexCount);
        if (!Number.isInteger(count) || count < 3) fail(`Invalid vertex count for "${key}".`);
        const vertices = nums(a.vertices, 'Vertices');
        if (vertices.length === count * 2) attachment.meshVertices = vertices.map((v, i) => (i % 2 ? -v : v));
        else {
          const rows: { bi: number; x: number; y: number; weight: number }[][] = [];
          const weights: number[] = [],
            local: number[] = [],
            used = new Set<number>();
          let p = 0;
          for (let vi = 0; vi < count; vi++) {
            const n = vertices[p++]!;
            if (!Number.isInteger(n) || n < 1 || n > skeleton.bones.length)
              fail(`Malformed weights for "${key}".`);
            const row: { bi: number; x: number; y: number; weight: number }[] = [];
            let world: number[] | undefined;
            weights.push(n);
            for (let j = 0; j < n; j++) {
              const bi = vertices[p++]!,
                x = vertices[p++]!,
                y = -vertices[p++]!,
                weight = vertices[p++]!;
              if (
                !Number.isInteger(bi) ||
                bi < 0 ||
                bi >= skeleton.bones.length ||
                !Number.isFinite(x + y + weight) ||
                weight < 0
              )
                fail(`Malformed influence in "${key}".`);
              const o = bi * 6,
                pt = [wm[o]! * x + wm[o + 2]! * y + wm[o + 4]!, wm[o + 1]! * x + wm[o + 3]! * y + wm[o + 5]!];
              if (world && Math.hypot(pt[0]! - world[0]!, pt[1]! - world[1]!) > 0.05)
                fail(
                  `Mesh "${key}" has different per-influence bind positions; native weights cannot preserve it yet.`,
                );
              world ??= pt;
              used.add(bi);
              weights.push(bi, weight);
              row.push({ bi, x, y, weight });
            }
            const o = slotIndex * 6;
            local.push(
              inv[o]! * world![0]! + inv[o + 2]! * world![1]! + inv[o + 4]!,
              inv[o + 1]! * world![0]! + inv[o + 3]! * world![1]! + inv[o + 5]!,
            );
            rows.push(row);
          }
          if (p !== vertices.length) fail(`Extra or truncated weighted vertices for "${key}".`);
          attachment.meshVertices = local;
          attachment.weights = weights;
          attachment.boneBindings = [...used].map((bi) => {
            const bind = new Float64Array(6);
            multiplyAffine(bind, 0, inv, bi * 6, wm, slotIndex * 6);
            return { boneId: skeleton.bones[bi]!.id, matrix: [...bind] };
          });
          weightedRows.set(id, rows);
        }
        if (type === 'mesh') {
          attachment.meshUVs = uv;
          attachment.meshTriangles = nums(a.triangles, 'Mesh triangles');
          const hull = num(a.hull);
          if (!Number.isInteger(hull) || hull < 0 || hull > count) fail(`Invalid hull for "${key}".`);
          if (hull) attachment.meshHull = Array.from({ length: hull }, (_, i) => i);
        }
        if (type === 'clipping') {
          const end = a.end === undefined ? null : skeleton.slots.find((s) => s.name === a.end);
          if (a.end !== undefined && !end) fail(`Missing clipping end slot for "${key}".`);
          // Native end is exclusive, Spine's end slot is included in clipping.
          const endIndex = end ? skeleton.slots.indexOf(end) : skeleton.slots.length;
          attachment.endSlotId = skeleton.slots[endIndex + 1]?.id ?? null;
        }
      }
      attachmentMap.set(JSON.stringify([slotName, key]), attachment);
      skeleton.attachments.push(attachment);
    }
  }
  const resolve = (slot: string, key: unknown): string | null => {
    if (key === null || key === undefined) return null;
    const a = attachmentMap.get(JSON.stringify([slot, str(key, 'Attachment key')]));
    if (!a) fail(`Missing attachment "${String(key)}" in slot "${slot}" for skin "${selectedSkin}".`);
    return a.id;
  };
  for (let i = 0; i < rawSlots.length; i++)
    skeleton.slots[i]!.defaultAttachmentId = resolve(skeleton.slots[i]!.name, rawSlots[i]!.attachment);
  new Skeleton(skeleton);
  const animations: Animation[] = [];
  for (const [name, v] of Object.entries(obj(root.animations ?? {}, 'Animations'))) {
    const a = obj(v, 'Animation');
    for (const kind of Object.keys(a))
      if (!['bones', 'slots', 'attachments', 'events', 'drawOrder'].includes(kind))
        fail(`Animation "${name}" has unsupported ${kind} timelines.`);
    const timelines: Timeline[] = [];
    for (const [boneName, boneTracks] of Object.entries(obj(a.bones ?? {}, 'Bone tracks'))) {
      const bone = boneMap.get(boneName);
      if (!bone) fail(`Missing animated bone "${boneName}".`);
      for (const [kind, value] of Object.entries(obj(boneTracks, 'Bone tracks'))) {
        const spec: Record<
          string,
          { fields: string[]; props: BonePropertyTimeline['property'][]; defaults: number[] }
        > = {
          rotate: { fields: ['value'], props: ['rotation'], defaults: [0] },
          translate: { fields: ['x', 'y'], props: ['x', 'y'], defaults: [0, 0] },
          translatex: { fields: ['value'], props: ['x'], defaults: [0] },
          translatey: { fields: ['value'], props: ['y'], defaults: [0] },
          scale: { fields: ['x', 'y'], props: ['scaleX', 'scaleY'], defaults: [1, 1] },
          scalex: { fields: ['value'], props: ['scaleX'], defaults: [1] },
          scaley: { fields: ['value'], props: ['scaleY'], defaults: [1] },
        };
        const s = spec[kind];
        if (!s) fail(`Bone "${boneName}" has unsupported ${kind} animation.`);
        const keys = frames(value);
        s.props.forEach((property, channel) => {
          if (
            timelines.some(
              (t) => t.kind === 'boneProperty' && t.boneId === bone.id && t.property === property,
            )
          )
            fail(`Overlapping ${property} timelines in "${name}".`);
          const raw = keys.map((k) => num(k[s.fields[channel]!], s.defaults[channel]!));
          const scale = property.startsWith('scale');
          const factor = property === 'rotation' ? -rad : property === 'y' ? -1 : 1;
          timelines.push({
            kind: 'boneProperty',
            boneId: bone.id,
            property,
            keyframes: keys.map((k, i) => ({
              time: num(k.time),
              value: scale ? raw[i]! * bone.setupPose[property] : bone.setupPose[property] + raw[i]! * factor,
              curve: curve(k, keys[i + 1], raw[i]!, raw[i + 1] ?? raw[i]!, channel),
            })),
          });
        });
      }
    }
    for (const [slotName, slotTracks] of Object.entries(obj(a.slots ?? {}, 'Slot tracks'))) {
      const slot = skeleton.slots.find((s) => s.name === slotName);
      if (!slot) fail(`Missing animated slot "${slotName}".`);
      for (const [kind, value] of Object.entries(obj(slotTracks, 'Slot tracks'))) {
        const keys = frames(value);
        if (kind === 'attachment')
          timelines.push({
            kind: 'slotAttachment',
            slotId: slot.id,
            keyframes: keys.map((k) => ({
              time: num(k.time),
              attachmentId: resolve(slotName, k.name),
              curve: stepped,
            })),
          });
        else if (kind === 'rgba') {
          if (keys.some((k) => k.curve !== undefined && k.curve !== 'stepped'))
            fail(`Slot "${slotName}" has unsupported Bezier color interpolation.`);
          timelines.push({
            kind: 'slotColor',
            slotId: slot.id,
            keyframes: keys.map((k) => ({
              time: num(k.time),
              value: color(k.color),
              curve: k.curve === 'stepped' ? stepped : linear,
            })),
          });
        } else fail(`Slot "${slotName}" has unsupported ${kind} animation.`);
      }
    }
    for (const [skinName, skinTracks] of Object.entries(obj(a.attachments ?? {}, 'Attachment tracks'))) {
      if (skinName !== selectedSkin && skinName !== 'default') continue;
      for (const [slotName, slotTracks] of Object.entries(obj(skinTracks, 'Attachment slot tracks'))) {
        for (const [key, attachmentTracks] of Object.entries(obj(slotTracks, 'Attachment tracks'))) {
          // Default deformation only applies when that attachment was not overridden by the selected skin.
          if (
            skinName === 'default' &&
            selectedSkin !== 'default' &&
            Object.hasOwn(obj(available.get(selectedSkin)?.[slotName] ?? {}, 'Skin attachments'), key)
          )
            continue;
          const id = resolve(slotName, key)!;
          const attachment = skeleton.attachments.find((at) => at.id === id)!;
          for (const [kind, value] of Object.entries(obj(attachmentTracks, 'Attachment timelines'))) {
            if (kind !== 'deform' || !attachment.meshVertices)
              fail(`Attachment "${key}" has unsupported ${kind} animation.`);
            const keys = frames(value),
              rows = weightedRows.get(id),
              size = rows ? rows.flat().length * 2 : attachment.meshVertices.length;
            timelines.push({
              kind: 'deform',
              attachmentId: id,
              keyframes: keys.map((k, i) => {
                const sparse = nums(k.vertices ?? [], 'Deform vertices'),
                  offset = num(k.offset);
                if (!Number.isInteger(offset) || offset < 0 || offset + sparse.length > size)
                  fail(`Invalid deform range in "${key}".`);
                const values = Array<number>(size).fill(0);
                values.splice(offset, sparse.length, ...sparse);
                let offsets = values.map((v, j) => (j % 2 ? -v : v));
                if (rows) {
                  offsets = [];
                  let p = 0;
                  const slot = skeleton.slots.find((s) => s.name === slotName)!,
                    so = setup.boneIndexMap.get(slot.boneId)! * 6;
                  for (const row of rows) {
                    let target: number[] | undefined;
                    for (const influence of row) {
                      const x = values[p++]!,
                        y = -values[p++]!,
                        o = influence.bi * 6;
                      const wx = wm[o]! * x + wm[o + 2]! * y,
                        wy = wm[o + 1]! * x + wm[o + 3]! * y;
                      const local = [
                        inv[so]! * wx + inv[so + 2]! * wy,
                        inv[so + 1]! * wx + inv[so + 3]! * wy,
                      ];
                      if (target && Math.hypot(local[0]! - target[0]!, local[1]! - target[1]!) > 0.02)
                        fail(
                          `"${key}" has independent per-influence deformation; native Deform cannot preserve it yet.`,
                        );
                      target ??= local;
                    }
                    offsets.push(...target!);
                  }
                }
                return {
                  time: num(k.time),
                  offsets: sparse.length ? offsets : null,
                  curve: curve(k, keys[i + 1]),
                };
              }),
            });
          }
        }
      }
    }
    if (a.drawOrder !== undefined)
      timelines.push({
        kind: 'drawOrder',
        keyframes: frames(a.drawOrder).map((k) => {
          const order = Array<number>(skeleton.slots.length).fill(-1),
            unchanged: number[] = [];
          let original = 0;
          for (const v of list(k.offsets ?? [], 'Draw order offsets')) {
            const o = obj(v, 'Draw order offset'),
              index = skeleton.slots.findIndex((s) => s.name === o.slot),
              delta = num(o.offset);
            if (
              index < original ||
              !Number.isInteger(delta) ||
              index + delta < 0 ||
              index + delta >= order.length ||
              order[index + delta] !== -1
            )
              fail('Invalid draw order offsets.');
            while (original < index) unchanged.push(original++);
            order[index + delta] = original++;
          }
          while (original < order.length) unchanged.push(original++);
          for (let j = order.length - 1; j >= 0; j--) if (order[j] === -1) order[j] = unchanged.pop()!;
          return { time: num(k.time), slotOrder: order, curve: stepped };
        }),
      });
    if (a.events !== undefined)
      timelines.push({
        kind: 'event',
        keyframes: frames(a.events).map((k) => {
          const eventName = str(k.name, 'Event name'),
            defs = obj(root.events ?? {}, 'Events');
          if (!Object.hasOwn(defs, eventName)) fail(`Missing event definition "${eventName}".`);
          const payload = { ...obj(defs[eventName], 'Event definition'), ...k };
          absent(payload, ['audio', 'volume', 'balance'], `Event "${eventName}"`);
          const values = [
            num(payload.int),
            num(payload.float),
            typeof payload.string === 'string' ? payload.string : '',
          ].filter((v) => v !== 0 && v !== '');
          if (values.length > 1)
            fail(`Event "${eventName}" has multiple payload fields; native events support one scalar.`);
          return {
            time: num(k.time),
            eventName,
            curve: stepped,
            payload: values[0] ?? 0,
          };
        }),
      });
    animations.push({
      name,
      duration: Math.max(0, ...timelines.flatMap((t) => t.keyframes.map((k) => k.time))),
      loop: true,
      timelines,
    });
  }
  validateDeformTimelines(skeleton, animations);
  validateAnimationEvents(animations);
  return { document: { skeleton, animations, assetManifest: manifest }, images, skin: selectedSkin };
}
