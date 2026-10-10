import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PROJECT_FORMAT,
  PROJECT_SCHEMA_VERSION,
  sceneTransform,
  deserializeProject,
  RigLogicPlayer,
  SECONDARY_STEP_SECONDS as STEP,
  type BoneByBoneProject,
  type Animation,
  type RigNode,
} from '@limber/core';
import {
  compileRuntime,
  loadRuntime,
  encodeRuntime,
  NativeRigPlayer,
  RuntimePlayer,
  type NativeFiredEvent,
} from '@limber/runtime';
import { constraintFixture } from '../../../tools/constraint-fixtures.mjs';

function source(): BoneByBoneProject {
  const identity = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 };
  const region = (id: string) => ({
    id,
    name: id,
    type: 'region' as const,
    textureId: '',
    vertices: [-10, -10, 10, -10, 10, 10, -10, 10],
    uvs: [0, 0, 1, 0, 1, 1, 0, 1],
  });
  const clip = (name: string, x: number, rotation: number, scaleX: number, deform: number): Animation => ({
    name,
    duration: 0.2,
    loop: false,
    timelines: [
      ...Object.entries({ x, rotation, scaleX }).map(([property, value]) => ({
        kind: 'boneProperty' as const,
        boneId: 'root',
        property: property as 'x' | 'rotation' | 'scaleX',
        keyframes: [{ time: 0, value, curve: { type: 'stepped' as const } }],
      })),
      {
        kind: 'deform',
        attachmentId: 'a',
        keyframes: [
          { time: 0, offsets: [deform, 0, deform, 0, deform, 0, deform, 0], curve: { type: 'stepped' } },
        ],
      },
      {
        kind: 'event',
        keyframes: [
          {
            time: 0,
            eventName: `${name}-zero`,
            curve: { type: 'stepped' },
            payload: { type: 'int', value: 1 },
          },
          {
            time: 0.2,
            eventName: `${name}-end`,
            curve: { type: 'stepped' },
            payload: { type: 'float', value: 0.1 + 0.2 },
          },
        ],
      },
    ],
  });
  const from = clip('from', 100, (170 * Math.PI) / 180, 2, 10);
  const to = clip('to', 200, (-170 * Math.PI) / 180, 4, 20);
  from.timelines.push({
    kind: 'slotColor',
    slotId: 'slot',
    keyframes: [{ time: 0, value: 0xff0000ff, curve: { type: 'stepped' } }],
  });
  to.timelines.push(
    {
      kind: 'slotColor',
      slotId: 'slot',
      keyframes: [{ time: 0, value: 0x0000ff80, curve: { type: 'stepped' } }],
    },
    {
      kind: 'slotAttachment',
      slotId: 'slot',
      keyframes: [{ time: 0, attachmentId: 'b', curve: { type: 'stepped' } }],
    },
    { kind: 'drawOrder', keyframes: [{ time: 0, slotOrder: [1, 0], curve: { type: 'stepped' } }] },
  );
  return {
    format: PROJECT_FORMAT,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    projectId: 'native-character',
    name: 'Native character test',
    assetManifest: {},
    editor: { activeArtboardId: 'board', activeRigId: 'rig' },
    artboards: [
      {
        id: 'board',
        name: 'Character',
        width: 320,
        height: 240,
        nodes: [
          {
            id: 'rig',
            name: 'Character',
            type: 'rig',
            parentId: null,
            visible: true,
            opacity: 1,
            transform: sceneTransform(),
            skeleton: {
              bones: [
                {
                  id: 'root',
                  name: 'Root',
                  parentId: null,
                  length: 20,
                  setupPose: { ...identity, x: 10, y: 20 },
                },
              ],
              slots: [
                { id: 'slot', name: 'Slot', boneId: 'root', defaultAttachmentId: 'a', color: 0xffffffff },
                { id: 'other', name: 'Other', boneId: 'root', defaultAttachmentId: 'a', color: 0xffffffff },
              ],
              attachments: [region('a'), region('b')],
              ikConstraints: [],
              activeSkin: 'base',
              skins: [
                { name: 'base', attachments: { slot: 'a', other: 'a' } },
                { name: 'alt', attachments: { slot: 'b', other: 'a' } },
              ],
              markers: [
                {
                  id: 'hand',
                  name: 'Hand socket',
                  kind: 'socket',
                  boneId: 'root',
                  transform: { ...identity, x: 3, y: 4 },
                },
                { id: 'point', name: 'Point', kind: 'point', boneId: 'root', transform: identity },
              ],
            },
            animations: [from, to, clip('third', 300, 0, 1, 0)],
          },
        ],
      },
    ],
  };
}
function make(project = source()): {
  player: NativeRigPlayer;
  program: ReturnType<typeof compileRuntime>['program'];
} {
  const program = loadRuntime(encodeRuntime(compileRuntime(project).program));
  const rig = project.artboards[0]!.nodes.find((n) => n.type === 'rig')!;
  return { player: new NativeRigPlayer(program, rig.id), program };
}
function steps(player: NativeRigPlayer, count: number): void {
  for (let i = 0; i < count; i++) expect(player.step()).toBe(1);
}

describe('native character player', () => {
  it('loads a detached paused setup pose and Stop restores setup without changing authored data', () => {
    const original = source(),
      before = structuredClone(original),
      { player, program } = make(original);
    const programBefore = structuredClone(program);
    expect(player.playing).toBe(false);
    expect(player.getWorldTransforms()[4]).toBe(10);
    expect(player.update(1)).toBe(0);
    player.play('from');
    player.update(STEP);
    expect(player.getWorldTransforms()[4]).toBe(100);
    player.stop();
    expect(player.playing).toBe(false);
    expect(player.snapshot().clip).toBeNull();
    expect(player.currentTick).toBe(0);
    expect(player.getWorldTransforms()[4]).toBe(10);
    expect(original).toEqual(before);
    expect(program).toEqual(programBefore);
  });

  it('crossfades full pre-constraint channels with numeric, shortest-arc, RGBA and Deform goldens', () => {
    const { player } = make();
    player.play('from');
    player.update(STEP);
    player.play('to', { fadeDuration: 0.2 });
    expect(player.getWorldTransforms()[4]).toBe(100); // No setup attenuation at alpha 0.
    expect(player.getSlotAttachment('slot')).toBe('b');
    expect(player.getDrawOrder()).toEqual([1, 0]);
    player.pause();
    steps(player, 12);
    expect(player.getWorldTransforms()[4]).toBe(150);
    expect(player.skeleton.pose.bones[0]!.local.rotation).toBeCloseTo(Math.PI, 12);
    expect(player.skeleton.pose.bones[0]!.local.scaleX).toBe(3);
    expect(player.getSlotColor('slot')).toBe(0x800080c0);
    expect([...player.skeleton.pose.attachments.get('a')!.deform]).toEqual([15, 0, 15, 0, 15, 0, 15, 0]);
    expect(player.snapshot().blendProgress).toBe(0.5);
    steps(player, 12);
    expect(player.getWorldTransforms()[4]).toBe(200);
    expect(player.getSlotColor('slot')).toBe(0x0000ff80);
  });

  it('interrupts an existing fade from its actual held animation pose', () => {
    const { player } = make();
    player.play('from');
    player.play('to', { fadeDuration: 0.2 });
    player.pause();
    steps(player, 12);
    player.play('third', { fadeDuration: 0.2 });
    player.pause();
    steps(player, 12);
    expect(player.getWorldTransforms()[4]).toBe(225);
    expect(player.skeleton.pose.bones[0]!.local.scaleX).toBe(2);
    expect([...player.skeleton.pose.attachments.get('a')!.deform]).toEqual([7.5, 0, 7.5, 0, 7.5, 0, 7.5, 0]);
  });

  it('blends before a partially mixed primary constraint, avoiding a second application to the held pose', () => {
    const original = source(),
      rig = original.artboards[0]!.nodes[0] as RigNode;
    const identity = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 };
    rig.skeleton.bones.push({
      id: 'target',
      name: 'Target',
      parentId: null,
      length: 0,
      setupPose: { ...identity, x: 1000, y: 20 },
    });
    rig.skeleton.transformConstraints = [
      {
        id: 'follow',
        boneId: 'root',
        targetId: 'target',
        space: 'world',
        offset: identity,
        mixTranslation: 0.5,
        mixRotation: 0,
        mixScale: 0,
        mixShear: 0,
        order: 0,
      },
    ];
    const { player } = make(original);
    player.play('from');
    expect(player.getWorldTransforms()[4]).toBe(550);
    player.play('to', { fadeDuration: 0.2 });
    player.pause();
    steps(player, 12);
    expect(player.getWorldTransforms()[4]).toBe(575);
    player.play('third', { fadeDuration: 0.2 });
    player.pause();
    steps(player, 12);
    expect(player.getWorldTransforms()[4]).toBe(612.5);
  });

  it('queues FIFO clips after terminal events and the full post-completion delay', () => {
    const { player } = make(),
      delivered: NativeFiredEvent[] = [];
    player.onEvent((e) => delivered.push(e));
    player.play('from');
    player.queueAnimation('to', { delay: STEP * 2 });
    player.queueAnimation('third');
    player.pause();
    steps(player, 24);
    expect(player.snapshot().clip).toBe('from');
    expect(player.snapshot().time).toBe(0.2);
    expect(delivered.map((e) => e.eventName)).toEqual(['from-zero', 'from-end']);
    steps(player, 2);
    expect(player.snapshot().clip).toBe('from');
    player.step();
    expect(player.snapshot().clip).toBe('to');
    expect(player.snapshot().time).toBe(STEP);
    steps(player, 23);
    expect(player.snapshot().clip).toBe('to');
    player.step();
    expect(player.snapshot().clip).toBe('third');
    expect(delivered.map((e) => e.eventName)).toEqual([
      'from-zero',
      'from-end',
      'to-zero',
      'to-end',
      'third-zero',
    ]);
    expect(delivered.find((e) => e.eventName === 'from-end')!.payload).toEqual({
      type: 'float',
      value: Math.fround(0.1 + 0.2),
    });
  });

  it('finishes the current loop cycle before a queued clip and holds its endpoint during delay', () => {
    const { player } = make(),
      names: string[] = [];
    player.onEvent((e) => names.push(e.eventName));
    player.play('from', { loop: true });
    player.queueAnimation('to', { delay: STEP });
    player.pause();
    steps(player, 24);
    expect(player.snapshot().time).toBe(0.2);
    expect(names).toEqual(['from-zero', 'from-end']); // No discarded next-cycle zero event.
    player.step();
    expect(player.snapshot().time).toBe(0.2);
    player.step();
    expect(player.snapshot().clip).toBe('to');
    expect(names).toEqual(['from-zero', 'from-end', 'to-zero']);
  });

  it('orders an ordinary loop seam old-end before new-zero without duplicated zero-delta events', () => {
    const { player } = make(),
      events: NativeFiredEvent[] = [];
    player.onEvent((e) => events.push(e));
    player.play('from', { loop: true });
    expect(player.update(0)).toBe(0);
    expect(events).toEqual([]);
    player.pause();
    steps(player, 48);
    expect(events.map((e) => [e.eventName, e.cycle])).toEqual([
      ['from-zero', 0],
      ['from-end', 0],
      ['from-zero', 1],
      ['from-end', 1],
      ['from-zero', 2],
    ]);
    expect(player.snapshot().time).toBe(0);
    expect(player.playing).toBe(false);
  });

  it('preserves matrix/vertex/event output under accepted-tick display grouping', () => {
    const original = source(),
      before = structuredClone(original),
      a = make(original).player,
      b = make(original).player;
    const eventsA: NativeFiredEvent[] = [],
      eventsB: NativeFiredEvent[] = [];
    a.onEvent((e) => eventsA.push(e));
    b.onEvent((e) => eventsB.push(e));
    for (const player of [a, b]) {
      player.play('from');
      player.queueAnimation('to', { fadeDuration: 0.2 });
    }
    for (let i = 0; i < 60; i++) a.update(1 / 60);
    for (let i = 0; i < 10; i++) b.update(0.1);
    expect(b.snapshot()).toEqual(a.snapshot());
    expect(b.getWorldTransforms()).toEqual(a.getWorldTransforms());
    for (const id of ['a', 'b']) expect(b.getDeformedVertices(id)).toEqual(a.getDeformedVertices(id));
    expect(eventsB).toEqual(eventsA);
    expect(original).toEqual(before);
  });

  it('uses at most twelve accepted ticks and drops paused fractions without rebasing between Steps', () => {
    const { player } = make();
    player.play('from');
    expect(player.update(10)).toBe(12);
    expect(player.lastDiscardedSeconds).toBe(9.9);
    expect(player.update(STEP / 2)).toBe(0);
    player.play();
    expect(player.update(STEP / 2)).toBe(1); // Repeated Play is idempotent.
    player.update(STEP / 2);
    player.pause();
    player.play();
    expect(player.update(STEP / 2)).toBe(0); // Pause dropped the previous fraction.
    const before = player.snapshot();
    expect(() => player.step()).toThrow(/Pause/);
    expect(player.snapshot()).toEqual(before);
  });

  it('validates all play/queue requests atomically, including bounded queues', () => {
    const { player } = make();
    player.play('from');
    const before = player.snapshot(),
      pose = [...player.getWorldTransforms()];
    for (const request of [
      () => player.play('missing'),
      () => player.play('to', { fadeDuration: NaN }),
      () => player.queueAnimation('to', { delay: -1 }),
      () => player.play('to', { loop: 'yes' as unknown as boolean }),
    ]) {
      expect(request).toThrow();
      expect(player.snapshot()).toEqual(before);
      expect([...player.getWorldTransforms()]).toEqual(pose);
    }
    for (let i = 0; i < 256; i++) player.queueAnimation('to');
    const full = player.snapshot();
    expect(() => player.queueAnimation('third')).toThrow(/256/);
    expect(player.snapshot()).toEqual(full);
  });

  it('can start a queue from Stop and skin changes keep the newly started animation visible', () => {
    const { player } = make();
    player.play('from');
    player.stop();
    player.queueAnimation('to');
    expect(player.playing).toBe(true);
    player.setSkin('alt');
    expect(player.getWorldTransforms()[4]).toBe(200);
    expect(player.snapshot().clip).toBe('to');
  });

  it('keeps skin/attachment changes transient, restores timeline attachments and exposes composed sockets', () => {
    const original = source(),
      before = structuredClone(original),
      { player, program } = make(original),
      programBefore = structuredClone(program);
    expect(player.getSocket('hand')).toEqual([1, 0, 0, 1, 13, 24]);
    expect(player.getSocket('hand', [1, 0, 0, 1, 100, 200])).toEqual([1, 0, 0, 1, 113, 224]);
    expect(() => player.getSocket('point')).toThrow(/not a socket/);
    const marker = player.getMarker('hand');
    marker.marker.name = 'changed';
    expect(player.getMarker('hand').marker.name).toBe('Hand socket');
    player.setAttachment('slot', null);
    expect(player.getSlotAttachment('slot')).toBeNull();
    player.clearAttachmentOverride('slot');
    expect(player.getSlotAttachment('slot')).toBe('a');
    player.play('to');
    player.setAttachment('slot', 'a');
    player.update(STEP);
    expect(player.getSlotAttachment('slot')).toBe('a');
    player.clearAttachmentOverride('slot');
    expect(player.getSlotAttachment('slot')).toBe('b');
    player.setSkin('alt');
    player.stop();
    expect(player.getSlotAttachment('slot')).toBe('b');
    expect(player.getWorldTransforms()[4]).toBe(10);
    expect(() => player.setSkin('missing')).toThrow();
    expect(() => player.setAttachment('missing', 'a')).toThrow();
    expect(() => player.setAttachment('slot', 'missing')).toThrow();
    player.reset();
    expect(player.getSlotAttachment('slot')).toBe('a');
    expect(original).toEqual(before);
    expect(program).toEqual(programBefore);
  });

  it('isolates each event listener and halts stale delivery after callback Stop/reset', () => {
    const { player } = make(),
      seen: NativeFiredEvent[] = [];
    player.onEvent((event) => {
      if (typeof event.payload === 'object') event.payload.value = 99;
    });
    player.onEvent((event) => seen.push(event));
    player.play('from');
    player.update(STEP);
    expect(seen[0]!.payload).toEqual({ type: 'int', value: 1 });
    expect(player.events[0]!.payload).toEqual({ type: 'int', value: 1 });
    const copy = player.events[0]!;
    copy.eventName = 'changed';
    expect(player.events[0]!.eventName).toBe('from-zero');
    const stopped = make().player,
      delivered: string[] = [];
    stopped.onEvent((e) => {
      delivered.push(e.eventName);
      stopped.stop();
    });
    stopped.onEvent(() => delivered.push('stale'));
    stopped.play('from');
    expect(stopped.update(0.1)).toBe(1);
    expect(delivered).toEqual(['from-zero']);
    expect(stopped.currentTick).toBe(0);
    expect(stopped.playing).toBe(false);
  });

  it('rejects callback reentrancy and leaves callback-selected tracks paused after Step', () => {
    const { player } = make();
    player.onEvent(() => {
      expect(() => player.update(STEP)).toThrow(/reentrant/);
      expect(() => player.step()).toThrow(/reentrant/);
    });
    player.play('from');
    player.update(STEP);
    const switched = make().player;
    switched.onEvent(() => switched.play('to'));
    switched.play('from');
    switched.pause();
    expect(switched.step()).toBe(1);
    expect(switched.snapshot().clip).toBe('to');
    expect(switched.playing).toBe(false);
    expect(switched.update(STEP)).toBe(0);
  });

  it('handles zero-duration clips once, including queued entry events', () => {
    const original = source(),
      rig = original.artboards[0]!.nodes[0] as RigNode;
    rig.animations = [
      {
        name: 'static',
        duration: 0,
        loop: true,
        timelines: [
          { kind: 'event', keyframes: [{ time: 0, eventName: 'static-zero', curve: { type: 'stepped' } }] },
        ],
      },
      rig.animations[1]!,
    ];
    const { player } = make(original),
      names: string[] = [];
    player.onEvent((e) => names.push(e.eventName));
    player.play('static');
    player.queueAnimation('to');
    player.pause();
    player.step();
    expect(names).toEqual(['static-zero']);
    expect(player.snapshot().clip).toBe('static');
    player.step();
    expect(names).toEqual(['static-zero', 'to-zero']);
  });

  it('rejects unsafe event density at compile time and on explicit loop overrides before mutation', () => {
    const original = source(),
      rig = original.artboards[0]!.nodes[0] as RigNode;
    rig.animations = [
      {
        name: 'dense',
        duration: STEP / 900,
        loop: false,
        timelines: [
          {
            kind: 'event',
            keyframes: Array.from({ length: 5 }, (_, i) => ({
              time: 0,
              eventName: `cue-${i}`,
              curve: { type: 'stepped' as const },
            })),
          },
        ],
      },
    ];
    const { player } = make(original);
    player.play('dense');
    const before = player.snapshot();
    expect(() => player.play('dense', { loop: true })).toThrow(/4096/);
    expect(player.snapshot()).toEqual(before);
    rig.animations[0]!.loop = true;
    expect(() => compileRuntime(original)).toThrow(/4096/);
  });

  it('rejects unsafe Bezier bone overshoot before a native player can publish infinite pose values', () => {
    const original = source(),
      rig = original.artboards[0]!.nodes[0] as RigNode;
    const timeline = rig.animations[0]!.timelines.find(
      (t) => t.kind === 'boneProperty' && t.property === 'x',
    )!;
    if (timeline.kind !== 'boneProperty') throw new Error('Expected x timeline.');
    timeline.keyframes = [
      { time: 0, value: 0, curve: { type: 'bezier', c1: 0.3, c2: 1e40, c3: 0.7, c4: 1 } },
      { time: 0.2, value: 100, curve: { type: 'linear' } },
    ];
    expect(() => compileRuntime(original)).toThrow(/overshoot/);
  });

  it('preserves authored Logic behavior, typed parameters, routes and source across raw mode switches', () => {
    const project = deserializeProject(
      readFileSync(new URL('../../../fixtures/bbbproj-v13-interactive.json', import.meta.url), 'utf8'),
    );
    const before = structuredClone(project),
      rig = project.artboards[0]!.nodes.find((n): n is RigNode => n.type === 'rig')!;
    const program = compileRuntime(project).program,
      native = new NativeRigPlayer(program, rig.id),
      core = new RigLogicPlayer(rig);
    core.pause();
    expect(native.mode).toBe('logic');
    native.dispatch('click');
    core.dispatch('click');
    for (let i = 0; i < 120; i++) {
      native.step();
      core.step();
      expect(native.snapshot().logic).toEqual(core.snapshot());
      expect(native.getWorldTransforms()).toEqual(core.getWorldTransforms());
      for (const attachment of rig.skeleton.attachments)
        expect(native.getDeformedVertices(attachment.id)).toEqual(core.getDeformedVertices(attachment.id));
    }
    native.setLogicEnabled(false);
    expect(native.step()).toBe(0);
    const parameter = rig.logic!.parameters.find((p) => p.type === 'trigger')!;
    native.fire(parameter.name);
    native.setLogicEnabled(true);
    native.step();
    const snapshot = native.snapshot();
    expect(() => native.setBool(parameter.name, true)).toThrow();
    expect(native.snapshot()).toEqual(snapshot);
    native.play(rig.animations[0]!.name);
    expect(native.mode).toBe('animation');
    expect(() => native.fire(parameter.name)).toThrow(/Logic/);
    native.useLogic();
    expect(native.mode).toBe('logic');
    expect(native.currentTick).toBe(0);
    native.stop();
    expect(native.playing).toBe(false);
    native.reset();
    expect(native.currentTick).toBe(0);
    expect(project).toEqual(before);
  });

  it('exposes all typed Logic setters and rejects wrong types/domains without changing the session', () => {
    const original = source(),
      rig = original.artboards[0]!.nodes[0] as RigNode;
    rig.logic = {
      id: 'graph',
      name: 'Character graph',
      enabled: true,
      entryStateId: 'idle',
      parameters: [
        { id: 'bool', name: 'Bool', type: 'bool', initial: false },
        { id: 'float', name: 'Float', type: 'float', initial: 0 },
        { id: 'int', name: 'Int', type: 'int', initial: 1 },
        { id: 'string', name: 'String', type: 'string', initial: 'hello' },
        { id: 'go', name: 'Go', type: 'trigger', initial: false },
      ],
      states: [
        { id: 'idle', name: 'Idle', clip: null, loop: false },
        { id: 'active', name: 'Active', clip: 'from', loop: false },
      ],
      transitions: [
        {
          id: 'go-edge',
          from: 'idle',
          to: 'active',
          priority: 0,
          conditions: [{ parameterId: 'go', operator: 'fired' }],
          blendDuration: 0.1,
          interruption: 'higherPriority',
        },
      ],
      routes: [{ id: 'test', event: 'test', targetId: null, parameterId: 'string', value: 'سلام' }],
    };
    const before = structuredClone(original),
      { player } = make(original);
    player.setBool('Bool', true);
    player.setFloat('Float', 0.1 + 0.2);
    player.setInt('Int', -22);
    player.setString('String', 'changed');
    expect(player.dispatch('test')).toBe(1);
    player.fire('Go');
    player.step();
    expect(player.getParameter('Bool')).toBe(true);
    expect(player.getParameter('Float')).toBe(Math.fround(0.1 + 0.2));
    expect(player.getParameter('Int')).toBe(-22);
    expect(player.getParameter('String')).toBe('سلام');
    expect(player.getParameter('Go')).toBe(false);
    const state = player.snapshot();
    expect(() => player.setBool('Int', true)).toThrow();
    expect(() => player.setFloat('Float', Infinity)).toThrow();
    expect(() => player.setInt('Int', 1.2)).toThrow();
    expect(() => player.setString('String', 'a'.repeat(4097))).toThrow();
    expect(player.snapshot()).toEqual(state);
    player.reset();
    player.fire('Go');
    player.resetTrigger('Go');
    player.step();
    expect(player.snapshot().logic!.stateId).toBe('idle');
    expect(original).toEqual(before);
  });

  it('keeps the accepted Logic pose skinned and resumes after a host event callback throws', () => {
    const original = source(),
      rig = original.artboards[0]!.nodes[0] as RigNode;
    const x = rig.animations[1]!.timelines.find((t) => t.kind === 'boneProperty' && t.property === 'x')!;
    if (x.kind !== 'boneProperty') throw new Error('Expected x timeline.');
    x.keyframes = [
      { time: 0, value: 0, curve: { type: 'linear' } },
      { time: 0.2, value: 120, curve: { type: 'linear' } },
    ];
    rig.logic = {
      id: 'graph',
      name: 'Graph',
      enabled: true,
      entryStateId: 'active',
      parameters: [],
      states: [{ id: 'active', name: 'Active', clip: 'to', loop: false }],
      transitions: [],
    };
    const { player } = make(original);
    const unsubscribe = player.onEvent(() => {
      throw new Error('Host callback failed');
    });
    expect(() => player.step()).toThrow('Host callback failed');
    expect(player.playing).toBe(false);
    const matrix = player.getWorldTransforms();
    expect(matrix[4]).toBe(5);
    expect(player.getDeformedVertices('a')[0]).toBe(
      Math.fround(matrix[0]! * 10 - matrix[2]! * 10 + matrix[4]!),
    );
    unsubscribe();
    expect(player.step()).toBe(1);
    expect(player.currentTick).toBe(2);
  });

  for (const kind of ['Standard', 'Heavy'] as const)
    it(`${kind}: compiled raw playback matches all solver stages and continuous/Step vertices`, () => {
      const original = constraintFixture(kind),
        before = structuredClone(original),
        { player: a, program } = make(original);
      const rig = original.artboards[0]!.nodes.find((n): n is RigNode => n.type === 'rig')!;
      const b = new NativeRigPlayer(program, rig.id),
        legacy = new RuntimePlayer(structuredClone(rig));
      for (const player of [a, b]) player.play(rig.animations[0]!.name, { loop: false });
      legacy.setAnimation(rig.animations[0]!.name, { loop: false });
      b.pause();
      steps(b, 12);
      a.update(0.1);
      legacy.update(0.1);
      expect(a.getWorldTransforms()).toEqual(b.getWorldTransforms());
      expect(a.getWorldTransforms()).toEqual(legacy.getWorldTransforms());
      for (const attachment of rig.skeleton.attachments) {
        expect(a.getDeformedVertices(attachment.id)).toEqual(b.getDeformedVertices(attachment.id));
        expect(a.getDeformedVertices(attachment.id)).toEqual(legacy.getDeformedVertices(attachment.id));
      }
      expect(original).toEqual(before);
    }, 15000);
});
