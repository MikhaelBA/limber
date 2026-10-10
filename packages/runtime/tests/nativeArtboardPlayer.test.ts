import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  deserializeProject,
  SceneLogicPlayer,
  RigLogicPlayer,
  expandUIComponents,
  sceneTransform,
  uiLayout,
  SECONDARY_STEP_SECONDS as STEP,
  type BoneByBoneProject,
  type RigNode,
  type SceneNode,
} from '@limber/core';
import {
  compileRuntime,
  NativeRuntimeAsset,
  NativeArtboardPlayer,
  NativeRigPlayer,
  NativeScenePlayer,
  type NativeArtboardEvent,
} from '@limber/runtime';
import { constraintFixture } from '../../../tools/constraint-fixtures.mjs';

const work = vi.hoisted(() => ({ skinning: 0, expansions: 0 }));
vi.mock('@limber/core', async (importOriginal) => {
  const core = await importOriginal<typeof import('@limber/core')>();
  return {
    ...core,
    expandUIComponents: (...args: Parameters<typeof core.expandUIComponents>) => {
      work.expansions++;
      return core.expandUIComponents(...args);
    },
    updateSkinning: (...args: Parameters<typeof core.updateSkinning>) => {
      work.skinning++;
      return core.updateSkinning(...args);
    },
  };
});
function source(): BoneByBoneProject {
  return deserializeProject(
    readFileSync(new URL('../../../fixtures/bbbproj-v13-interactive.json', import.meta.url), 'utf8'),
  );
}
function normalized(nodes: SceneNode[]): SceneNode[] {
  const copy = structuredClone(nodes);
  for (const node of copy)
    if (node.type === 'rig') for (const state of node.logic?.states ?? []) delete state.position;
  return copy;
}
function rig(project: BoneByBoneProject): RigNode {
  return project.artboards[0]!.nodes.find((node): node is RigNode => node.type === 'rig')!;
}
function interactingSource(): BoneByBoneProject {
  const project = source(),
    board = project.artboards[0]!,
    character = rig(project);
  // A scene entry event triggers the rig on the next global tick; its entry event changes UI next tick.
  board.clips![0]!.events = [
    { id: 'scene-cue', time: 0, name: 'scene-cue', payload: { type: 'int', value: 7 } },
  ];
  character.animations[0]!.timelines.push({
    kind: 'event',
    keyframes: [
      {
        time: 0,
        eventName: 'rig-cue',
        payload: { type: 'string', value: 'Ready 🦊' },
        curve: { type: 'stepped' },
      },
    ],
  });
  return project;
}

describe('validated native assets and artboard orchestration', () => {
  it('constructs 500 independent characters without repeating whole-scene expansion for each lookup', () => {
    const project = source(),
      template = rig(project),
      board = project.artboards[0]!;
    delete board.logic;
    board.clips = [];
    project.components = [];
    project.assetManifest = {};
    project.editor.activeRigId = null;
    delete template.logic;
    template.animations = [];
    template.skeleton = {
      bones: [
        {
          id: 'root',
          name: 'Root',
          parentId: null,
          length: 20,
          setupPose: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 },
        },
      ],
      slots: [],
      attachments: [],
      skins: [],
      activeSkin: '',
      ikConstraints: [],
    };
    board.nodes = Array.from({ length: 500 }, (_, index) => ({
      ...structuredClone(template),
      id: `actor-${index}`,
      transform: { ...sceneTransform(), x: index },
    }));
    const program = compileRuntime(project).program,
      before = structuredClone(program),
      asset = new NativeRuntimeAsset(program);
    work.expansions = 0;
    const first = new NativeArtboardPlayer(asset);
    expect(work.expansions).toBe(2); // One mutable scene publication, one immutable authored rig lookup table.
    work.expansions = 0;
    const second = new NativeArtboardPlayer(asset);
    expect(work.expansions).toBe(1);
    expect(first.getRigIds()).toHaveLength(500);
    expect(first.evaluate().find((entry) => entry.node.id === 'actor-499')!.world[4]).toBe(499);
    expect(first.getRig('actor-499').skeleton).not.toBe(second.getRig('actor-499').skeleton);
    expect(program).toEqual(before);
  });
  it('shares validated assets while isolating the input, publications and every playback instance', () => {
    const program = compileRuntime(source()).program,
      asset = new NativeRuntimeAsset(program);
    program.artboards[0]!.nodes.length = 0;
    const published = asset.getProgram();
    published.artboards[0]!.nodes.length = 0;
    const texture = asset.getTexture('demo-tex');
    texture.base64 = '';
    const a = new NativeArtboardPlayer(asset),
      b = new NativeArtboardPlayer(asset);
    expect(a.getView().nodes.length).toBeGreaterThan(0);
    expect(asset.getTexture('demo-tex').base64.length).toBeGreaterThan(0);
    expect(a.getRig('rig-character').skeleton).not.toBe(b.getRig('rig-character').skeleton);
    a.setString('caption', 'Changed');
    a.getRig('rig-character').fire('open');
    a.step();
    expect(b.getParameter('caption')).toBe('سلام 🌿');
    expect(b.getRig('rig-character').snapshot().logic!.stateId).toBe('rig-idle');
    // Even a caller violating the read-only view contract cannot alter the shared asset.
    a.getView().nodes[0]!.transform.x = 987;
    expect(new NativeScenePlayer(asset).getView().nodes[0]!.transform.x).not.toBe(987);
    expect(() => new NativeArtboardPlayer(Object.create(NativeRuntimeAsset.prototype))).toThrow(/validation/);
    expect(() => asset.getTexture('missing')).toThrow(/texture/);
  });

  it('matches source scene/character Logic, matrices, vertices and UI routes on every accepted tick', () => {
    const project = source(),
      before = structuredClone(project),
      native = new NativeArtboardPlayer(compileRuntime(project).program);
    const coreScene = new SceneLogicPlayer(project.artboards[0]!, project.components),
      coreRig = new RigLogicPlayer(rig(project));
    coreScene.pause();
    coreRig.pause();
    const label = native.getView().nodes.find((node) => node.type === 'text')!;
    expect(native.dispatch('click', label.id)).toBe(coreScene.dispatch('click', 'instance'));
    expect(native.getRig('rig-character').dispatch('click')).toBe(coreRig.dispatch('click', null));
    for (let n = 1; n <= 120; n++) {
      expect(native.step()).toBe(1);
      coreScene.step();
      coreRig.step();
      expect(native.currentTick).toBe(n);
      expect(native.scene.snapshot().logic).toEqual(coreScene.snapshot());
      expect(native.getRig('rig-character').snapshot().logic).toEqual(coreRig.snapshot());
      expect(normalized(native.getView().nodes)).toEqual(
        normalized(expandUIComponents(project, coreScene.getView()).artboard.nodes),
      );
      expect(native.getRig('rig-character').getWorldTransforms()).toEqual(
        coreRig.skeleton.pose.worldMatrices,
      );
      for (const [id, state] of coreRig.skeleton.pose.attachments)
        expect(native.getRig('rig-character').getDeformedVertices(id)).toEqual(state.verts);
    }
    expect(project).toEqual(before);
  });

  it('commits all owners before root and child callbacks and defers cross-owner inputs to the next tick', () => {
    const player = new NativeArtboardPlayer(compileRuntime(interactingSource()).program),
      character = player.getRig('rig-character');
    const observations: unknown[] = [];
    player.onEvent((event) => {
      observations.push([
        'root',
        event.ownerId,
        event.artboardTick,
        player.scene.currentTick,
        character.currentTick,
      ]);
      if (event.eventName === 'scene-cue') character.fire('open');
      if (event.eventName === 'rig-cue') player.setString('caption', 'Ready');
    });
    player.scene.onEvent(() => observations.push(['scene', player.scene.currentTick, character.currentTick]));
    character.onEvent(() => observations.push(['rig', player.scene.currentTick, character.currentTick]));
    player.fire('pressed');
    player.step();
    expect(character.snapshot().logic!.stateId).toBe('rig-idle');
    expect(observations).toEqual([
      ['root', 'board', 1, 1, 1],
      ['scene', 1, 1],
    ]);
    player.step();
    expect(character.snapshot().logic!.stateId).toBe('rig-active');
    expect(player.getView().nodes.find((node) => node.type === 'text')!.text).toBe('سلام 🌿');
    expect(observations.slice(2)).toEqual([
      ['root', 'rig-character', 2, 2, 2],
      ['rig', 2, 2],
    ]);
    player.step();
    expect(player.getView().nodes.find((node) => node.type === 'text')!.text).toBe('Ready');
  });

  it('preserves cross-owner callback state, global event order and poses across six frame groupings', () => {
    const program = compileRuntime(interactingSource()).program;
    const run = (delta: number, frames: number) => {
      const player = new NativeArtboardPlayer(program),
        events: NativeArtboardEvent[] = [];
      player.onEvent((event) => {
        events.push(event);
        if (event.eventName === 'scene-cue') player.getRig('rig-character').fire('open');
        if (event.eventName === 'rig-cue') player.setString('caption', 'Ready');
      });
      player.fire('pressed');
      player.play();
      for (let n = 0; n < frames; n++) player.update(delta);
      return {
        snapshot: player.snapshot(),
        events,
        scene: player.evaluate(),
        world: [...player.getRig('rig-character').getWorldTransforms()],
        verts: [...player.getRig('rig-character').skeleton.pose.attachments].map(([id, state]) => [
          id,
          [...state.verts],
        ]),
      };
    };
    const expected = run(STEP, 120);
    for (const [delta, frames] of [
      [STEP / 2, 240],
      [1 / 60, 60],
      [1 / 40, 40],
      [1 / 30, 30],
      [0.1, 10],
    ])
      expect(run(delta!, frames!)).toEqual(expected);
  });

  it('routes scene-owned expanded hits separately from explicit viewport character signals', () => {
    const player = new NativeArtboardPlayer(compileRuntime(source()).program);
    const label = player.getView().nodes.find((node) => node.type === 'text')!;
    player.dispatch('click', label.id);
    player.step();
    expect(player.scene.snapshot().logic!.stateId).toBe('active');
    expect(player.getRig('rig-character').snapshot().logic!.stateId).toBe('rig-idle');
    player.getRig('rig-character').dispatch('click');
    player.step();
    expect(player.getRig('rig-character').snapshot().logic!.stateId).toBe('rig-active');
    expect(() => player.dispatch('click', 'missing')).toThrow(/Unknown runtime node/);
  });

  it('publishes complete root/child frame events and clears them on held frames without skinning', () => {
    const player = new NativeArtboardPlayer(compileRuntime(interactingSource()).program);
    player.fire('pressed');
    player.getRig('rig-character').fire('open');
    player.play();
    player.update(0.1);
    expect(player.events.map((event) => event.ownerId)).toEqual(['board', 'rig-character']);
    expect(player.scene.events.map((event) => event.eventName)).toEqual(['scene-cue']);
    expect(player.getRig('rig-character').events.map((event) => event.eventName)).toEqual(['rig-cue']);
    work.skinning = 0;
    player.update(0);
    expect(player.events).toEqual([]);
    expect(player.scene.events).toEqual([]);
    expect(player.getRig('rig-character').events).toEqual([]);
    expect(work.skinning).toBe(0);
  });

  it('keeps authored character event order when all owners emit on the same global tick', () => {
    const project = interactingSource(),
      other = structuredClone(rig(project));
    other.id = 'second-character';
    project.artboards[0]!.nodes.push(other);
    const player = new NativeArtboardPlayer(compileRuntime(project).program),
      delivered: string[] = [];
    player.onEvent((event) => delivered.push(event.ownerId));
    player.fire('pressed');
    for (const id of player.getRigIds()) player.getRig(id).fire('open');
    player.step();
    expect(delivered).toEqual(['board', 'rig-character', 'second-character']);
    expect(player.events.every((event) => event.artboardTick === 1)).toBe(true);
  });

  it('finalizes callback Stop setup once and reset clears transient attachment choices', () => {
    const project = interactingSource(),
      character = rig(project);
    const asset = new NativeRuntimeAsset(compileRuntime(project).program),
      player = new NativeArtboardPlayer(asset);
    const slot = character.skeleton.slots[0]!.id,
      child = player.getRig(character.id),
      initialAttachment = child.getSlotAttachment(slot);
    child.setAttachment(slot, null);
    player.onEvent(() => player.stop());
    player.fire('pressed');
    player.play();
    work.skinning = 0;
    player.update(0.1);
    expect(work.skinning).toBe(1);
    expect(child.getSlotAttachment(slot)).toBe(null);
    player.reset();
    expect(child.getSlotAttachment(slot)).toBe(initialAttachment);
  });

  it('blocks owned-child advancement and root reentrancy before state or event buffers change', () => {
    const player = new NativeArtboardPlayer(compileRuntime(interactingSource()).program);
    player.onEvent(() => {
      const state = player.snapshot(),
        events = player.events;
      expect(() => player.update(STEP)).toThrow(/reentrant/);
      expect(() => player.step()).toThrow(/reentrant/);
      expect(() => player.scene.update(STEP)).toThrow(/owned scene/);
      expect(() => player.getRig('rig-character').step()).toThrow(/owned character/);
      expect(player.snapshot()).toEqual(state);
      expect(player.events).toEqual(events);
    });
    player.fire('pressed');
    player.step();
  });

  for (const command of ['stop', 'reset', 'pause'] as const)
    it(`${command} from a callback cancels stale root and child listeners`, () => {
      const player = new NativeArtboardPlayer(compileRuntime(interactingSource()).program),
        delivered: string[] = [];
      player.onEvent(() => {
        delivered.push('first');
        player[command]();
      });
      player.onEvent(() => delivered.push('stale-root'));
      player.scene.onEvent(() => delivered.push('stale-child'));
      player.fire('pressed');
      player.play();
      expect(player.update(0.1)).toBe(1);
      expect(delivered).toEqual(['first']);
      expect(player.playing).toBe(false);
      expect(player.getRig('rig-character').playing).toBe(false);
      expect(player.events).toEqual([]);
      expect(player.currentTick).toBe(command === 'pause' ? 1 : 0);
    });

  it('a child callback changing the root session also cancels remaining child listeners', () => {
    const player = new NativeArtboardPlayer(compileRuntime(interactingSource()).program),
      delivered: string[] = [];
    const character = player.getRig('rig-character');
    character.onEvent(() => {
      delivered.push('first');
      player.useLogic();
    });
    character.onEvent(() => delivered.push('stale'));
    character.fire('open');
    player.play();
    expect(player.update(0.1)).toBe(1);
    expect(delivered).toEqual(['first']);
  });

  it('changing a different owner discards that owner’s queued events without losing valid scene events', () => {
    const player = new NativeArtboardPlayer(compileRuntime(interactingSource()).program),
      delivered: string[] = [];
    player.onEvent((event) => {
      delivered.push(event.ownerId);
      if (event.ownerId === 'board') player.getRig('rig-character').stop();
    });
    player.getRig('rig-character').onEvent(() => delivered.push('stale-child'));
    player.fire('pressed');
    player.getRig('rig-character').fire('open');
    player.step();
    expect(delivered).toEqual(['board']);
  });

  it('isolates event copies, finalizes a throwing callback’s accepted pose and allows continued playback', () => {
    const program = compileRuntime(interactingSource()).program;
    const player = new NativeArtboardPlayer(program),
      reference = new NativeArtboardPlayer(program),
      original: unknown[] = [];
    player.onEvent((event) => {
      event.ownerId = 'mutated';
      if (typeof event.payload === 'object' && event.payload.type === 'int') event.payload.value = 99;
    });
    player.onEvent((event) => original.push(event));
    const off = player.onEvent(() => {
      throw new Error('host failure');
    });
    for (const current of [player, reference]) {
      current.fire('pressed');
      current.getRig('rig-character').fire('open');
      current.play();
    }
    expect(() => player.update(STEP)).toThrow('host failure');
    reference.update(STEP);
    expect(original[0]).toMatchObject({ ownerId: 'board', artboardTick: 1, payload: { value: 7 } });
    expect(player.currentTick).toBe(1);
    expect(player.getRig('rig-character').getWorldTransforms()).toEqual(
      reference.getRig('rig-character').getWorldTransforms(),
    );
    for (const [id, state] of reference.getRig('rig-character').skeleton.pose.attachments)
      expect(player.getRig('rig-character').getDeformedVertices(id)).toEqual(state.verts);
    off();
    expect(player.update(STEP)).toBe(1);
    expect(player.currentTick).toBe(2);
  });

  it('preserves fractions on idempotent play, bounds stalls and retains viewport through Stop/Reset', () => {
    const player = new NativeArtboardPlayer(compileRuntime(source()).program, { autoplay: true });
    player.resize(900, 300, { left: 20, right: 30, top: 0, bottom: 0 });
    expect(player.update(STEP / 2)).toBe(0);
    player.play();
    expect(player.update(STEP / 2)).toBe(1);
    expect(player.update(10)).toBe(12);
    expect(player.lastDiscardedSeconds).toBe(9.9);
    const before = player.snapshot();
    expect(() => player.step()).toThrow(/Pause/);
    expect(() => player.play('missing')).toThrow(/Unknown/);
    expect(player.snapshot()).toEqual(before);
    player.stop();
    expect(player.currentTick).toBe(0);
    player.setString('caption', 'Changed');
    player.reset();
    expect(player.getParameter('caption')).toBe('سلام 🌿');
    expect(player.getView()).toMatchObject({ width: 900, height: 300, safeArea: { left: 20, right: 30 } });
  });

  it('disabled scene Logic holds while the artboard clock and characters continue', () => {
    const player = new NativeArtboardPlayer(compileRuntime(source()).program);
    player.setLogicEnabled(false);
    player.play();
    player.update(0.1);
    expect(player.currentTick).toBe(12);
    expect(player.scene.currentTick).toBe(0);
    expect(player.getRig('rig-character').currentTick).toBe(12);
  });

  it('Step remains paused even when a callback starts a new root or child session', () => {
    const player = new NativeArtboardPlayer(compileRuntime(interactingSource()).program);
    player.onEvent(() => {
      player.play();
      player.getRig('rig-character').play('wave');
    });
    player.fire('pressed');
    expect(player.step()).toBe(1);
    expect(player.playing).toBe(false);
    expect(player.scene.playing).toBe(false);
    expect(player.getRig('rig-character').playing).toBe(false);
    expect(player.getRig('rig-character').snapshot().clip).toBe('wave');
  });

  it('creates independent characters inside reusable UI instances and composes sockets with responsive scene world matrices', () => {
    const project = source(),
      character = rig(project),
      board = project.artboards[0]!;
    character.skeleton.markers = [
      {
        id: 'socket',
        name: 'Socket',
        kind: 'socket',
        boneId: character.skeleton.bones[0]!.id,
        transform: { x: 7, y: 9, rotation: 0.2, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 },
      },
    ];
    const componentRig = structuredClone(character);
    componentRig.id = 'component-character';
    delete componentRig.logic; // Component-local Logic is explicitly outside the current source contract.
    project.components!.push({
      id: 'actor',
      name: 'Actor',
      revision: 1,
      width: 200,
      height: 200,
      nodes: [componentRig],
      exposed: [],
    });
    for (const [id, x] of [
      ['left-actor', -100],
      ['right-actor', 100],
    ] as const)
      board.nodes.push({
        id,
        name: id,
        type: 'instance',
        componentId: 'actor',
        width: 200,
        height: 200,
        parentId: null,
        visible: true,
        opacity: 1,
        transform: { ...sceneTransform(), x },
        layout: uiLayout(200, 200),
        overrides: {},
      });
    const asset = new NativeRuntimeAsset(compileRuntime(project).program),
      player = new NativeArtboardPlayer(asset);
    const idA = JSON.stringify(['left-actor', componentRig.id]),
      idB = JSON.stringify(['right-actor', componentRig.id]);
    expect(player.getRigIds()).toEqual([character.id, idA, idB]);
    player.getRig(idA).play('wave');
    player.step();
    expect(player.getRig(idA).snapshot().clip).toBe('wave');
    expect(player.getRig(idB).snapshot().clip).toBe(null);
    player.resize(1200, 700);
    const entry = player.evaluate().find((entry) => entry.node.id === idA)!;
    expect(player.getSocket(idA, 'socket')).toEqual(player.getRig(idA).getSocket('socket', entry.world));
    expect(player.getSocket(idA, 'socket')).not.toEqual(player.getRig(idA).getSocket('socket'));
    expect(new NativeRigPlayer(asset, idA).currentTick).toBe(0);
    expect(() => player.getRig('missing')).toThrow(/Unknown runtime character/);
  });

  for (const kind of ['Standard', 'Heavy'] as const)
    it(`${kind}: one skinning pass per displayed frame preserves all constraint/spring/vertex parity`, () => {
      const project = constraintFixture(kind),
        character = rig(project),
        program = compileRuntime(project).program;
      const player = new NativeArtboardPlayer(program),
        reference = new NativeRigPlayer(program, character.id);
      player.getRig(character.id).play(character.animations[0]!.name, { loop: false });
      reference.play(character.animations[0]!.name, { loop: false });
      reference.pause();
      player.play();
      work.skinning = 0;
      expect(player.update(0.1)).toBe(12);
      expect(work.skinning).toBe(1);
      work.skinning = 0;
      expect(player.update(STEP / 2)).toBe(0);
      expect(work.skinning).toBe(0);
      for (let n = 0; n < 12; n++) reference.step();
      expect(player.getRig(character.id).getWorldTransforms()).toEqual(reference.getWorldTransforms());
      for (const attachment of character.skeleton.attachments)
        expect(player.getRig(character.id).getDeformedVertices(attachment.id)).toEqual(
          reference.getDeformedVertices(attachment.id),
        );
      const buffers = [...player.getRig(character.id).skeleton.pose.attachments.values()].map(
        (state) => state.verts,
      );
      player.update(0.1);
      expect(
        [...player.getRig(character.id).skeleton.pose.attachments.values()].map((state) => state.verts),
      ).toEqual(buffers);
      buffers.forEach((buffer, i) =>
        expect([...player.getRig(character.id).skeleton.pose.attachments.values()][i]!.verts).toBe(buffer),
      );
      // Debug stepping must retain spring inertia between Steps, with one publication per Step.
      const stepped = new NativeArtboardPlayer(program);
      stepped.getRig(character.id).play(character.animations[0]!.name, { loop: false });
      stepped.pause();
      for (let n = 0; n < 24; n++) stepped.step();
      expect(stepped.getRig(character.id).getWorldTransforms()).toEqual(
        player.getRig(character.id).getWorldTransforms(),
      );
      for (const attachment of character.skeleton.attachments)
        expect(stepped.getRig(character.id).getDeformedVertices(attachment.id)).toEqual(
          player.getRig(character.id).getDeformedVertices(attachment.id),
        );
    }, 15000);
});
