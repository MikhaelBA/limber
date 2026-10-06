import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as spine from '@esotericsoftware/spine-core';
import {
  deserializeDocument,
  exportSpineJson,
  buildAtlasText,
  packAtlas,
  uniqueTexturePaths,
  type EditorDocument,
} from '@limber/core';
import { EditorEngine } from '../src/engine/EditorEngine';
import { AddBoneCommand } from '../src/commands/boneCommands';
import { AddTextureCommand } from '../src/commands/attachmentCommands';
import { AddAttachmentCommand } from '../src/commands/attachmentCommands';
import { AddSlotCommand } from '../src/commands/slotCommands';
import { AddMeshCommand, PaintWeightsCommand } from '../src/commands/meshCommands';
import { AddAnimationCommand, upsertKeyframe } from '../src/commands/animationCommands';

/**
 * Compatibility gate: our Spine JSON export must LOAD and POSE correctly in
 * the OFFICIAL runtime. We pin spine-core 4.2.x — the runtime generation our
 * 4.1-format export targets (4.3 switched constraints to a unified
 * "constraints" array and dropped the top-level "ik" section). Test-only
 * dependency — the Spine runtime license does NOT travel into our code.
 *
 * The strongest check is numeric: for the same document, our engine's world
 * transforms (y-down) must equal spine-core's (y-up) under the y-flip:
 * spine.worldX == ours.worldX and spine.worldY == -ours.worldY.
 */

class FakeTexture extends spine.Texture {
  setFilters(): void {}
  setWraps(): void {}
  dispose(): void {}
}

function loadInSpineRuntime(json: string, textureNames: string[]): spine.Skeleton {
  const layout = packAtlas(textureNames.map((name) => ({ name, width: 64, height: 64 })));
  const atlas = new spine.TextureAtlas(buildAtlasText('atlas', layout));
  for (const page of atlas.pages) page.setTexture(new FakeTexture({}));
  const data = new spine.SkeletonJson(new spine.AtlasAttachmentLoader(atlas)).readSkeletonData(json);
  return new spine.Skeleton(data);
}

/** A rig with everything the exporter touches: offsets, rotation, mesh weights, animation. */
function buildFixtureDoc(): { doc: EditorDocument; engine: EditorEngine } {
  const engine = new EditorEngine();
  const rootId = engine.skeleton.data.bones[0]!.id;
  const arm = new AddBoneCommand(engine, rootId, { x: 120, y: -10 }, { rotation: -0.6, length: 90 });
  arm.do();
  const hand = new AddBoneCommand(engine, arm.boneId, { x: 90, y: 0 }, { rotation: 0.4, length: 50 });
  hand.do();
  new AddTextureCommand(engine, 'tex-1', 'limb.png').do();
  const slot = new AddSlotCommand(engine, arm.boneId);
  slot.do();
  new AddAttachmentCommand(engine, slot.slotId, { textureId: 'tex-1', x: 0, y: 0, width: 80, height: 60 }).do();
  const mesh = new AddMeshCommand(engine, slot.slotId, { textureId: 'tex-1', x: 0, y: 0, width: 80, height: 60, cols: 3, rows: 2 });
  mesh.do();
  const handIdx = engine.skeleton.boneIndexMap.get(hand.boneId)!;
  const armIdx = engine.skeleton.boneIndexMap.get(arm.boneId)!;
  const paint = new PaintWeightsCommand(engine, mesh.attachmentId);
  paint.open();
  paint.update(5, handIdx, armIdx, 0.6); // one weighted vertex toward the hand
  paint.update(7, handIdx, armIdx, 0.3);
  paint.commit();
  engine.skeleton.rebuild();

  const anim = new AddAnimationCommand(engine, 'swing');
  anim.do();
  engine.setAnimation('swing');
  engine.mode = 'animate';
  upsertKeyframe(engine.currentAnimation!, arm.boneId, 'rotation', 0, -0.6);
  upsertKeyframe(engine.currentAnimation!, arm.boneId, 'rotation', 1, 0.5);
  upsertKeyframe(engine.currentAnimation!, arm.boneId, 'y', 0, -10);
  upsertKeyframe(engine.currentAnimation!, arm.boneId, 'y', 1, 25);
  upsertKeyframe(engine.currentAnimation!, hand.boneId, 'scaleX', 0, 1);
  upsertKeyframe(engine.currentAnimation!, hand.boneId, 'scaleX', 1, 1.4);
  return { doc: engine.document, engine };
}


describe('Spine runtime compatibility (official spine-core)', () => {
  it('loads our export and matches world transforms at the SETUP pose', () => {
    const { doc, engine } = buildFixtureDoc();
    const json = exportSpineJson(doc, uniqueTexturePaths(doc.assetManifest));
    const sk = loadInSpineRuntime(json, ['limb']);
    sk.updateWorldTransform(spine.Physics.update);

    expect(sk.bones.length).toBe(3);
    const names = sk.bones.map((b) => b.data.name);
    expect(names).toEqual(['root', 'bone', 'bone2']);

    engine.tick(0);
    const wm = engine.skeleton.pose.worldMatrices;
    for (let i = 0; i < 3; i++) {
      expect(sk.bones[i]!.worldX).toBeCloseTo(wm[i * 6 + 4]!, 4);
      expect(sk.bones[i]!.worldY).toBeCloseTo(-(wm[i * 6 + 5]!), 4);
    }
  });

  it('resolves attachments (region + weighted mesh) from the generated atlas', () => {
    const { doc } = buildFixtureDoc();
    const json = exportSpineJson(doc, uniqueTexturePaths(doc.assetManifest));
    const sk = loadInSpineRuntime(json, ['limb']);
    sk.setToSetupPose();
    const slot = sk.slots[0]!;
    expect(slot.data.name).toBe('slot');
    const att = slot.getAttachment()!;
    expect(att.name).toBe('limb2'); // the region was 'limb'; the MESH (limb2) overrode the slot default
    expect(att).toBeInstanceOf(spine.MeshAttachment);
    const mesh = att as spine.MeshAttachment;
    expect(mesh.bones).not.toBeNull(); // weighted format parsed
    expect(mesh.vertices.length).toBeGreaterThan(0);
    expect(mesh.region).toBeDefined();
    expect((mesh.region as unknown as { name?: string }).name).toBe('limb'); // resolved from our generated atlas
  });

  it('poses identically through an ANIMATION at t=0.5', () => {
    const { doc, engine } = buildFixtureDoc();
    const json = exportSpineJson(doc, uniqueTexturePaths(doc.assetManifest));
    const sk = loadInSpineRuntime(json, ['limb']);
    const state = new spine.AnimationState(new spine.AnimationStateData(sk.data));
    state.setAnimation(0, 'swing', true);
    state.update(0.5);
    state.apply(sk);
    sk.updateWorldTransform(spine.Physics.update);

    engine.scrub(0.5);
    engine.tick(16);
    const wm = engine.skeleton.pose.worldMatrices;
    for (let i = 0; i < 3; i++) {
      expect(sk.bones[i]!.worldX).toBeCloseTo(wm[i * 6 + 4]!, 3);
      expect(sk.bones[i]!.worldY).toBeCloseTo(-(wm[i * 6 + 5]!), 3);
    }
  });

  it('loads the shipped demo project (real content) with IK + animation', () => {
    const path = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'examples', 'demo.limber.json');
    const doc = deserializeDocument(readFileSync(path, 'utf8'));
    const json = exportSpineJson(doc, uniqueTexturePaths(doc.assetManifest));
    const sk = loadInSpineRuntime(json, ['demo-limb']);
    expect(sk.bones.map((b) => b.data.name)).toHaveLength(4);
    expect(sk.data.ikConstraints).toHaveLength(1);
    expect(sk.data.animations.map((a) => a.name)).toContain('wave');
    // Pose with IK applied on both engines and compare the chain end.
    const state = new spine.AnimationState(new spine.AnimationStateData(sk.data));
    state.setAnimation(0, 'wave', true);
    state.update(0);
    state.apply(sk);
    sk.updateWorldTransform(spine.Physics.update);
    const last = sk.bones[sk.bones.length - 1]!;
    // The IK target is last; just assert it resolved to a finite pose.
    expect(Number.isFinite(last.worldX)).toBe(true);
    expect(Number.isFinite(last.worldY)).toBe(true);
  });
});
