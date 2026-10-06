import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { deserializeDocument, serializeDocument, Skeleton } from '@limber/core';
import { EditorEngine } from '../src/engine/EditorEngine';
import { AddBoneCommand } from '../src/commands/boneCommands';
import { AddTextureCommand } from '../src/commands/attachmentCommands';
import { AddAttachmentCommand } from '../src/commands/attachmentCommands';
import { AddSlotCommand } from '../src/commands/slotCommands';
import { AddMeshCommand, PaintWeightsCommand } from '../src/commands/meshCommands';
import { AddIKConstraintCommand } from '../src/commands/ikCommands';
import { AddAnimationCommand, KeyEventCommand, SetKeyframeCommand, upsertKeyframe } from '../src/commands/animationCommands';

// ---------------------------------------------------------------------------
// Minimal PNG encoder (RGBA, filter 0) — enough to bake a procedural texture
// for the demo project without a canvas dependency.
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  // Standard reflected table-driven CRC-32: index by the LOW byte, then fold
  // the rest of c back in. (Verified byte-for-byte against Python's
  // zlib.crc32 — the first version omitted the `& 0xff` + `>>> 8` fold.)
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Blocky "limb plate" texture: rounded-ish colored plate with transparent corners. */
function limbTexture(size = 128): Buffer {
  const rgba = new Uint8Array(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dx = (x - cx) / (size / 2);
      const dy = (y - cy) / (size / 2);
      const r = Math.hypot(dx, dy);
      if (r > 0.95) continue; // transparent
      const band = Math.floor(((x + y) / size) * 4) % 4;
      const [cr, cg, cb] = [
        [0x2d, 0x7d, 0xd6],
        [0x35, 0xd6, 0xa0],
        [0xf2, 0xb1, 0x3c],
        [0xef, 0x6c, 0x5a],
      ][band]!;
      rgba[i] = cr;
      rgba[i + 1] = cg;
      rgba[i + 2] = cb;
      rgba[i + 3] = 255;
    }
  }
  return encodePng(size, size, rgba);
}

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'examples', 'demo.limber.json');

describe('demo project generator', () => {
  it('builds a self-contained demo rig (mesh + weights + IK + animation) and saves it', () => {
    const engine = new EditorEngine();
    const rootId = engine.skeleton.data.bones[0]!.id;

    // --- arm chain ---
    const upper = new AddBoneCommand(engine, rootId, { x: 100, y: 0 }, { rotation: -0.45, length: 90 });
    upper.do();
    const forearm = new AddBoneCommand(engine, upper.boneId, { x: 90, y: 0 }, { rotation: 0.35, length: 80 });
    forearm.do();

    // --- texture + slot + region -> grid mesh ---
    const png = limbTexture();
    new AddTextureCommand(engine, 'demo-tex', 'demo-limb.png').do();
    const slot = new AddSlotCommand(engine, upper.boneId);
    slot.do();
    new AddAttachmentCommand(engine, slot.slotId, { textureId: 'demo-tex', x: 45, y: 0, width: 150, height: 110 }).do();
    const mesh = new AddMeshCommand(engine, slot.slotId, {
      textureId: 'demo-tex',
      x: 45,
      y: 0,
      width: 150,
      height: 110,
      cols: 4,
      rows: 3,
    });
    mesh.do();

    // --- skin: outer column of vertices follows the forearm ---
    const forearmIdx = engine.skeleton.boneIndexMap.get(forearm.boneId)!;
    const upperIdx = engine.skeleton.boneIndexMap.get(upper.boneId)!;
    const paint = new PaintWeightsCommand(engine, mesh.attachmentId);
    paint.open();
    const cols = 5;
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < cols; c++) {
        const v = r * cols + c;
        paint.update(v, forearmIdx, upperIdx, Math.max(0, (c - 1) / (cols - 2)) * 0.9);
      }
    }
    paint.commit();
    engine.skeleton.rebuild();

    // --- IK with a bent target ---
    const ik = new AddIKConstraintCommand(engine, forearm.boneId);
    ik.do();
    const target = engine.skeleton.data.bones.find((b) => b.id === ik.targetBoneId)!;
    target.setupPose.x = 170;
    target.setupPose.y = 130;
    engine.skeleton.rebuild();
    engine.tick(0);

    // --- a short animation: swing + event ---
    const anim = new AddAnimationCommand(engine, 'wave');
    anim.do();
    engine.setAnimation('wave');
    engine.mode = 'animate';
    engine.scrub(0);
    upsertKeyframe(engine.currentAnimation!, upper.boneId, 'rotation', 0, -0.45);
    upsertKeyframe(engine.currentAnimation!, upper.boneId, 'rotation', 0.6, 0.35);
    upsertKeyframe(engine.currentAnimation!, upper.boneId, 'rotation', 1.2, -0.45);
    upsertKeyframe(engine.currentAnimation!, forearm.boneId, 'rotation', 0, 0.35);
    upsertKeyframe(engine.currentAnimation!, forearm.boneId, 'rotation', 0.6, -0.2);
    upsertKeyframe(engine.currentAnimation!, forearm.boneId, 'rotation', 1.2, 0.35);
    // The IK TARGET carries the motion (rotation keys on an IK-pinned chain are
    // overwritten by the solver — animating the target is what makes it wave).
    new SetKeyframeCommand(engine, target.id, 'x', 0, 170).do();
    new SetKeyframeCommand(engine, target.id, 'y', 0, 130).do();
    new SetKeyframeCommand(engine, target.id, 'x', 0.6, 250).do();
    new SetKeyframeCommand(engine, target.id, 'y', 0.6, 40).do();
    new SetKeyframeCommand(engine, target.id, 'x', 1.2, 170).do();
    new SetKeyframeCommand(engine, target.id, 'y', 1.2, 130).do();
    engine.scrub(0.6); // Events at t=0 never fire (no crossing) — key mid-animation.
    new KeyEventCommand(engine, 'swoosh').do();
    engine.tick(0);

    // --- serialize self-contained (texture pixels as a data URL) ---
    const doc = engine.document;
    const manifest = { ...doc.assetManifest };
    manifest['demo-tex'] = { ...manifest['demo-tex']!, dataUrl: `data:image/png;base64,${png.toString('base64')}` };
    const json = serializeDocument({ ...doc, assetManifest: manifest });

    // Round-trip proof before writing the artifact.
    const restored = deserializeDocument(json);
    expect(() => new Skeleton(restored.skeleton)).not.toThrow();
    expect(restored.skeleton.ikConstraints).toHaveLength(1);
    const demoMesh = restored.skeleton.attachments.find((a) => a.id === mesh.attachmentId)!;
    expect(demoMesh.type).toBe('mesh');
    expect(demoMesh.weights).toBeDefined();
    expect(restored.animations[0]!.name).toBe('wave');
    expect(restored.animations[0]!.timelines.some((tl) => tl.kind === 'event')).toBe(true);
    expect(restored.assetManifest['demo-tex']!.dataUrl?.startsWith('data:image/png;base64,')).toBe(true);
    expect(json.length).toBeGreaterThan(2000);

    // The rig contains random UUIDs, so rewriting on every test run would
    // leave the working tree dirty forever. Write when missing; set
    // REGEN_DEMO=1 to refresh deliberately after changing the generator.
    if (!existsSync(OUT) || process.env.REGEN_DEMO === '1') {
      mkdirSync(dirname(OUT), { recursive: true });
      writeFileSync(OUT, json, 'utf8');
    }
  });
});
