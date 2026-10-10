import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  deserializeProject,
  sampleSceneClip,
  SceneLogicPlayer,
  RigLogicPlayer,
  Skeleton,
  resetPose,
  applyTimeline,
  solveFK,
  solveConstraints,
  updateSkinning,
  type BoneByBoneProject,
  type RigNode,
  type SceneNode,
} from '@limber/core';
import {
  compileRuntime,
  diagnoseRuntimeCompilation,
  encodeRuntime,
  loadRuntime,
  serializeRuntime,
  validateRuntimeProgram,
  RuntimeFormatError,
  RUNTIME_MAX_BYTES,
  type RuntimeProgram,
} from '@limber/runtime';
import { materializeRuntimeProject } from '../src/native/adapt';

const fixtureRoot = new URL('../../../fixtures/', import.meta.url);
const corpus = [
  ...readdirSync(fixtureRoot)
    .filter((name) => /^bbbproj.*\.json$/.test(name))
    .map((name) => [name, new URL(name, fixtureRoot)] as const),
  [
    'Fox-Adventurer',
    new URL('../../../examples/fox-adventurer/Fox-Adventurer.bbbproj', import.meta.url),
  ] as const,
];
function source(name = 'bbbproj-v13-interactive.json'): BoneByBoneProject {
  return deserializeProject(readFileSync(new URL(name, fixtureRoot), 'utf8'));
}
function program(name?: string): RuntimeProgram {
  return compileRuntime(source(name)).program;
}
function visualNodes(nodes: SceneNode[]): SceneNode[] {
  const result = structuredClone(nodes);
  for (const node of result)
    if (node.type === 'rig') for (const state of node.logic?.states ?? []) delete state.position;
  return result;
}
function diagnostic(callback: () => unknown, code: string, objectId?: string): void {
  try {
    callback();
    throw new Error('Expected runtime rejection.');
  } catch (error) {
    expect(error).toBeInstanceOf(RuntimeFormatError);
    const finding = (error as RuntimeFormatError).diagnostic;
    expect(finding.code).toBe(code);
    expect(finding.severity).toBe('error');
    expect(finding.explanation.length).toBeGreaterThan(5);
    expect(finding.remedy.length).toBeGreaterThan(5);
    if (objectId !== undefined) expect(finding.objectId).toBe(objectId);
  }
}

describe('native runtime v1 compilation and strict ingestion', () => {
  it('reads the independent stored v1 wire fixture and recompiles without shipping adapter metadata', () => {
    const loaded = loadRuntime(readFileSync(new URL('bbb-v1-minimal.bbb', fixtureRoot), 'utf8'));
    const adapted = materializeRuntimeProject(loaded).project;
    expect(compileRuntime(adapted).program).toEqual(loaded);
    const clip = adapted.artboards[0]!.clips![0]!;
    expect(sampleSceneClip(adapted.artboards[0]!, clip, 0.1).transforms.box!.x).toBe(30);
    expect(loaded.artboards[0]!.clips![0]!.events[0]!.payload).toEqual({ type: 'string', value: 'رسید 🦊' });
  });
  it.each(corpus)('validates the %s corpus and preserves the authored source', (_name, path) => {
    const original = deserializeProject(readFileSync(path, 'utf8'));
    const before = structuredClone(original);
    if (
      Object.values(original.assetManifest).some((meta) => meta.dataUrl?.startsWith('data:image/svg+xml;'))
    ) {
      diagnostic(() => compileRuntime(original), 'UNSUPPORTED_IMAGE');
      expect(original).toEqual(before);
      return; // SVG rasterization belongs to the worker asset stage; no fake pixel conversion.
    }
    const result = compileRuntime(original);
    const compact = serializeRuntime(result.program),
      pretty = serializeRuntime(result.program, { pretty: true });
    expect(compileRuntime(original)).toEqual(result);
    expect(loadRuntime(compact)).toEqual(result.program);
    expect(loadRuntime(pretty)).toEqual(result.program);
    expect(loadRuntime(encodeRuntime(result.program))).toEqual(result.program);
    const adapted = materializeRuntimeProject(loadRuntime(compact)).project;
    for (const board of original.artboards) {
      const shipped = adapted.artboards.find((b) => b.id === board.id)!;
      for (const clip of board.clips ?? [])
        for (const fraction of [0, 0.25, 0.5, 1])
          expect(
            sampleSceneClip(
              shipped,
              shipped.clips!.find((c) => c.id === clip.id)!,
              clip.duration * fraction,
            ),
          ).toEqual(sampleSceneClip(board, clip, clip.duration * fraction));
      for (const rig of board.nodes.filter((n): n is RigNode => n.type === 'rig')) {
        const runtimeRig = shipped.nodes.find((n) => n.id === rig.id) as RigNode;
        expect(runtimeRig.animations).toEqual(rig.animations);
        const a = new Skeleton(structuredClone(rig.skeleton)),
          b = new Skeleton(structuredClone(runtimeRig.skeleton));
        for (const animation of rig.animations)
          for (const fraction of [0, 0.25, 0.5, 1]) {
            for (const skeleton of [a, b]) {
              resetPose(skeleton.data, skeleton.pose);
              for (const timeline of animation.timelines)
                if (timeline.kind !== 'event')
                  applyTimeline(
                    timeline,
                    skeleton,
                    animation.duration * fraction,
                    0,
                    1,
                    null,
                    animation.name,
                  );
              solveFK(skeleton.data, skeleton.boneIndexMap, skeleton.pose);
              solveConstraints(skeleton);
              updateSkinning(skeleton);
            }
            expect(b.pose.worldMatrices).toEqual(a.pose.worldMatrices);
            expect(b.pose.slots).toEqual(a.pose.slots);
            expect(b.pose.slotOrder).toEqual(a.pose.slotOrder);
            for (const [id, state] of a.pose.attachments)
              expect(b.pose.attachments.get(id)!.verts).toEqual(state.verts);
          }
      }
    }
    expect(original).toEqual(before);
  });

  it('strips editor metadata, unknown nested source fields and derived linked geometry', () => {
    const original = source('bbbproj-v6-shared-mesh.json');
    const rig = original.artboards[0]!.nodes.find((n): n is RigNode => n.type === 'rig')!;
    const linked = rig.skeleton.attachments.find((a) => a.meshSourceId)!;
    const owner = rig.skeleton.attachments.find((a) => a.id === linked.meshSourceId)!;
    linked.meshVertices = owner.meshVertices;
    linked.meshUVs = owner.meshUVs;
    linked.meshTriangles = owner.meshTriangles;
    linked.meshHull = owner.meshHull;
    Object.assign(original, { internalNotes: 'private', privateRecovery: { secret: 'private' } });
    Object.assign(rig.skeleton.bones[0]!, { selected: true, sourcePath: 'C:/private/art.psd' });
    Object.assign(rig.animations[0]!, { editorZoom: 42 });
    const before = structuredClone(original),
      shipped = compileRuntime(original).program;
    const json = serializeRuntime(shipped);
    expect(json).not.toMatch(
      /internalNotes|privateRecovery|sourcePath|selected|editorZoom|assetManifest|schemaVersion|activeArtboard/,
    );
    const shippedRig = shipped.artboards[0]!.nodes.find((n) => n.type === 'rig')!;
    expect(shippedRig.type).toBe('rig');
    if (shippedRig.type !== 'rig') throw new Error('Missing rig.');
    const shippedLink = shippedRig.skeleton.attachments.find((a) => a.id === linked.id)!;
    expect(shippedLink.meshSourceId).toBe(linked.meshSourceId);
    expect(shippedLink).not.toHaveProperty('meshVertices');
    expect(shippedLink).not.toHaveProperty('meshTriangles');
    expect(shippedRig.skeleton.attachments.find((a) => a.id === owner.id)!.meshVertices).toEqual(
      owner.meshVertices,
    );
    shippedRig.skeleton.bones[0]!.setupPose.x += 100;
    expect(original).toEqual(before);
  });

  it('omits scene selection identities/fps, graph positions and component revisions', () => {
    const original = source();
    original.artboards[0]!.logic!.states[0]!.position = { x: 123, y: 456 };
    const shipped = program();
    const withPositions = compileRuntime(original).program;
    expect(withPositions).toEqual(shipped);
    const json = serializeRuntime(shipped);
    expect(json).not.toMatch(/"(?:fps|revision|position|editor)":/);
    for (const board of shipped.artboards)
      for (const clip of board.clips ?? []) {
        for (const track of clip.tracks) {
          expect(track).not.toHaveProperty('id');
          for (const key of track.keys) expect(key).not.toHaveProperty('id');
        }
        for (const event of clip.events) expect(event).not.toHaveProperty('id');
      }
    for (const component of shipped.components) expect(component).not.toHaveProperty('revision');
  });

  it('defaults to authored artboard order and supports an explicit runtime entry point', () => {
    const original = source('bbbproj-v1-demo.json');
    const second = { ...structuredClone(original.artboards[0]!), id: 'second', nodes: [] };
    original.artboards.push(second);
    original.editor = { activeArtboardId: 'second', activeRigId: null };
    expect(compileRuntime(original).program.defaultArtboardId).toBe(original.artboards[0]!.id);
    expect(compileRuntime(original, { defaultArtboardId: 'second' }).program.defaultArtboardId).toBe(
      'second',
    );
    diagnostic(
      () => compileRuntime(original, { defaultArtboardId: 'missing' }),
      'BROKEN_REFERENCE',
      'missing',
    );
  });

  it('preserves scene bindings, routes, typed events and fixed-step character poses', () => {
    const original = source(),
      adapted = materializeRuntimeProject(program()).project;
    const sourceBoard = original.artboards.find((b) => b.logic)!,
      runtimeBoard = adapted.artboards.find((b) => b.id === sourceBoard.id)!;
    const a = new SceneLogicPlayer(sourceBoard, original.components),
      b = new SceneLogicPlayer(runtimeBoard, adapted.components);
    a.pause();
    b.pause();
    const aEvents: unknown[] = [],
      bEvents: unknown[] = [];
    a.onEvent((e) => aEvents.push(e));
    b.onEvent((e) => bEvents.push(e));
    for (const route of sourceBoard.logic!.routes ?? []) {
      a.dispatch(route.event, route.targetId);
      b.dispatch(route.event, route.targetId);
    }
    for (let i = 0; i < 240; i++) {
      a.step();
      b.step();
      expect(b.getPose()).toEqual(a.getPose());
      // Runtime metadata differs intentionally; rendered nodes/overrides do not.
      expect(visualNodes(b.getView().nodes)).toEqual(visualNodes(a.getView().nodes));
      expect(b.snapshot()).toEqual(a.snapshot());
    }
    expect(bEvents).toEqual(aEvents);
    const rigs = original.artboards.flatMap((board) =>
      board.nodes.filter((n): n is RigNode => n.type === 'rig' && !!n.logic),
    );
    for (const rig of rigs) {
      const shipped = adapted.artboards
        .flatMap((board) => board.nodes)
        .find((n) => n.id === rig.id) as RigNode;
      const x = new RigLogicPlayer(rig),
        y = new RigLogicPlayer(shipped);
      x.pause();
      y.pause();
      for (let i = 0; i < 240; i++) {
        x.step();
        y.step();
        expect(y.getWorldTransforms()).toEqual(x.getWorldTransforms());
        for (const attachment of rig.skeleton.attachments)
          expect(y.getDeformedVertices(attachment.id)).toEqual(x.getDeformedVertices(attachment.id));
      }
    }
  });

  it('reserves authored IDs before generating deterministic internal sampling identities', () => {
    const shipped = program();
    shipped.id = '@runtime:0';
    shipped.artboards[0]!.clips![0]!.id = '@runtime:1';
    for (const state of shipped.artboards[0]!.logic!.states)
      if (state.clip !== null) state.clip = '@runtime:1';
    const first = materializeRuntimeProject(shipped),
      second = materializeRuntimeProject(shipped);
    expect(first).toEqual(second);
    const ids = [...first.ephemeralOwners.keys()];
    expect(ids).not.toContain('@runtime:0');
    expect(ids).not.toContain('@runtime:1');
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateRuntimeProgram(shipped)).toEqual(shipped);
  });

  it('rejects renamed source, unknown versions, malformed JSON and invalid UTF-8', () => {
    diagnostic(() => loadRuntime(JSON.stringify(source())), 'WRONG_FORMAT');
    diagnostic(() => loadRuntime('{'), 'INVALID_JSON');
    diagnostic(() => loadRuntime(Uint8Array.from([0xc3, 0x28])), 'INVALID_UTF8');
    diagnostic(() => validateRuntimeProgram({ ...program(), version: 2 }), 'UNSUPPORTED_VERSION');
    diagnostic(() => loadRuntime(' '.repeat(RUNTIME_MAX_BYTES + 1)), 'RESOURCE_LIMIT');
  });

  it('rejects duplicate texture records, absent references and inaccurate asset inventories', () => {
    const shipped = program('bbbproj-v1-demo.json'),
      before = structuredClone(shipped);
    shipped.textures.push(structuredClone(shipped.textures[0]!));
    diagnostic(() => validateRuntimeProgram(shipped), 'DUPLICATE_ASSET');
    before.textures[0]!.id = 'unreferenced';
    diagnostic(() => validateRuntimeProgram(before), 'MISSING_PIXELS');
    const unused = program('bbbproj-v1-demo.json');
    unused.textures.push({ ...unused.textures[0]!, id: 'unused' });
    diagnostic(() => validateRuntimeProgram(unused), 'UNUSED_ASSET', 'unused');
  });

  it('rejects source-only graph positions, derived mesh aliases and extra typed payload fields', () => {
    const positioned = program();
    Object.assign(positioned.artboards[0]!.logic!.states[0]!, { position: { x: 0, y: 0 } });
    diagnostic(() => validateRuntimeProgram(positioned), 'UNKNOWN_FIELD');
    const shared = program('bbbproj-v6-shared-mesh.json');
    const rig = shared.artboards[0]!.nodes.find((n) => n.type === 'rig')!;
    if (rig.type !== 'rig') throw new Error('Expected linked rig.');
    const link = rig.skeleton.attachments.find((a) => a.meshSourceId)!;
    link.meshVertices = [0, 0];
    diagnostic(() => validateRuntimeProgram(shared), 'DERIVED_GEOMETRY', link.id);
    const payload = program();
    const event = payload.artboards[0]!.clips![0]!.events.find((e) => typeof e.payload === 'object')!;
    Object.assign(event.payload!, { hidden: true });
    diagnostic(() => validateRuntimeProgram(payload), 'UNKNOWN_FIELD');
  });

  it('rejects invalid weight index order and clipping end slots before constructing a player', () => {
    const shipped = program('bbbproj-v1-demo.json');
    const rig = shipped.artboards[0]!.nodes.find((n) => n.type === 'rig')!;
    if (rig.type !== 'rig') throw new Error('Expected rig.');
    rig.skeleton.bones.reverse();
    diagnostic(() => validateRuntimeProgram(shipped), 'INVALID_BONE_ORDER', rig.id);
    rig.skeleton.bones.reverse();
    rig.skeleton.attachments.push({
      id: 'clip',
      name: 'Clip',
      type: 'clipping',
      textureId: '',
      meshVertices: [0, 0, 10, 0, 10, 10, 0, 10],
      meshHull: [0, 1, 2, 3],
      endSlotId: 'missing',
    });
    shipped.features.push('rig-clipping');
    shipped.features.sort();
    diagnostic(() => validateRuntimeProgram(shipped), 'BROKEN_REFERENCE', rig.id);
  });

  it('handles large canonical base64 without recursive regex exhaustion', () => {
    const shipped = program('bbbproj-v1-demo.json');
    const texture = shipped.textures[0]!;
    if (texture.type !== 'image') throw new Error('Expected embedded image.');
    const unpadded = texture.base64.replace(/=+$/, '');
    // Valid MIME signature/encoding does not claim that this image body decodes.
    texture.base64 = unpadded.slice(0, 32) + 'A'.repeat(1024 * 1024);
    const validatedTexture = validateRuntimeProgram(shipped).textures[0]!;
    if (validatedTexture.type !== 'image') throw new Error('Expected embedded image.');
    expect(validatedTexture.base64).toBe(texture.base64);
    texture.base64 = unpadded.slice(0, 32) + 'AB==';
    diagnostic(() => validateRuntimeProgram(shipped), 'INVALID_IMAGE_ENCODING');
  });

  it('rejects unknown fields deeply, unknown types and unsafe scalar values', () => {
    const shipped = program();
    const before = structuredClone(shipped);
    Object.assign(shipped.artboards[0]!.nodes[0]!, { editorOnly: true });
    diagnostic(() => validateRuntimeProgram(shipped), 'UNKNOWN_FIELD', shipped.artboards[0]!.nodes[0]!.id);
    expect(shipped.artboards[0]!.nodes[0]).toHaveProperty('editorOnly', true);
    const nan = structuredClone(before);
    nan.artboards[0]!.nodes[0]!.opacity = NaN;
    diagnostic(() => validateRuntimeProgram(nan), 'INVALID_STRUCTURE');
    const badText = structuredClone(before);
    badText.name = '\uD800';
    diagnostic(() => validateRuntimeProgram(badText), 'INVALID_STRUCTURE');
    const badType = structuredClone(before);
    Object.assign(badType.artboards[0]!.nodes[0]!, { type: 'script' });
    diagnostic(() => validateRuntimeProgram(badType), 'INVALID_STRUCTURE');
    Object.assign(before.artboards[0]!.nodes[0]!.transform, { internal: 'bad' });
    diagnostic(() => validateRuntimeProgram(before), 'UNKNOWN_FIELD');
  });

  it('verifies exact capability requirements, including disabled authored graphs', () => {
    const shipped = program();
    expect(shipped.features).toContain('logic');
    shipped.features.push('unknown' as RuntimeProgram['features'][number]);
    diagnostic(() => validateRuntimeProgram(shipped), 'UNSUPPORTED_FEATURE');
    shipped.features.pop();
    shipped.features = shipped.features.filter((f) => f !== 'logic');
    diagnostic(() => validateRuntimeProgram(shipped), 'FEATURE_MISMATCH');
    const original = source();
    original.artboards.find((b) => b.logic)!.logic!.enabled = false;
    expect(compileRuntime(original).program.features).toContain('logic');
  });

  it('drops unused assets and rejects missing pixels, source atlases and forged images', () => {
    const original = source('bbbproj-v1-demo.json');
    const id = Object.keys(original.assetManifest)[0]!;
    original.assetManifest.unused = {
      name: 'secret.psd',
      source: 'embedded',
      dataUrl: original.assetManifest[id]!.dataUrl,
    };
    const shipped = compileRuntime(original).program;
    expect(shipped.textures.map((t) => t.id)).not.toContain('unused');
    expect(serializeRuntime(shipped)).not.toContain('secret.psd');
    const noPixels = structuredClone(original);
    delete noPixels.assetManifest[id]!.dataUrl;
    diagnostic(() => compileRuntime(noPixels), 'MISSING_PIXELS', id);
    expect(diagnoseRuntimeCompilation(noPixels)[0]!.code).toBe('MISSING_PIXELS');
    const atlas = structuredClone(original);
    atlas.assetManifest[id]!.source = 'atlas';
    diagnostic(() => compileRuntime(atlas), 'SOURCE_ATLAS_UNSUPPORTED', id);
    const texture = shipped.textures[0]!;
    if (texture.type !== 'image') throw new Error('Expected embedded image.');
    texture.base64 = 'abcd';
    diagnostic(() => validateRuntimeProgram(shipped), 'INVALID_IMAGE_SIGNATURE', shipped.textures[0]!.id);
    texture.base64 = 'abc';
    diagnostic(() => validateRuntimeProgram(shipped), 'INVALID_IMAGE_ENCODING');
  });

  it('rejects broken scene/rig references, malformed colors and draw-order keys before publication', () => {
    const shipped = program('bbbproj-v5-bind-mesh.json');
    const rig = shipped.artboards[0]!.nodes.find((n) => n.type === 'rig')!;
    if (rig.type !== 'rig') throw new Error('Missing fixture rig.');
    rig.animations[0]!.timelines.push({
      kind: 'boneProperty',
      boneId: 'missing',
      property: 'x',
      keyframes: [],
    });
    diagnostic(() => validateRuntimeProgram(shipped), 'BROKEN_REFERENCE', rig.id);
    rig.animations[0]!.timelines.pop();
    rig.animations[0]!.timelines.push({
      kind: 'slotColor',
      slotId: rig.skeleton.slots[0]!.id,
      keyframes: [{ time: 0, curve: { type: 'linear' }, value: -1 }],
    });
    diagnostic(() => validateRuntimeProgram(shipped), 'INVALID_COLOR');
    rig.animations[0]!.timelines.pop();
    rig.animations[0]!.timelines.push({
      kind: 'drawOrder',
      keyframes: [{ time: 0, curve: { type: 'stepped' }, slotOrder: [99] }],
    });
    diagnostic(() => validateRuntimeProgram(shipped), 'INVALID_DRAW_ORDER');
    const broken = program();
    broken.artboards[0]!.clips![0]!.tracks[0]!.nodeId = 'missing';
    diagnostic(() => validateRuntimeProgram(broken), 'BROKEN_REFERENCE', 'missing');
  });
});
