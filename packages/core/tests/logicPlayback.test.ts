import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  SceneLogicPlayer,
  RigLogicPlayer,
  Skeleton,
  sceneTransform,
  deserializeProject,
  activeRigNode,
  LOGIC_STEP_SECONDS as step,
  type Artboard,
  type RigNode,
  type LogicGraph,
  type Animation,
} from '../src/index';
import { makeBone, makeSkeletonData } from './helpers';
import { constraintFixture } from '../../../tools/constraint-fixtures.mjs';
function graph(entryClip: string | null = null): LogicGraph {
  return {
    id: 'graph',
    name: 'Graph',
    enabled: true,
    entryStateId: 'idle',
    parameters: [
      { id: 'go', name: 'go', type: 'trigger', initial: false },
      { id: 'hit', name: 'hit', type: 'trigger', initial: false },
      { id: 'count', name: 'count', type: 'int', initial: 0 },
    ],
    states: [
      { id: 'idle', name: 'Idle', clip: entryClip, loop: true },
      { id: 'move', name: 'Move', clip: 'move', loop: false },
      { id: 'hit-state', name: 'Hit', clip: 'hit', loop: false },
    ],
    transitions: [
      {
        id: 'go-edge',
        from: 'idle',
        to: 'move',
        priority: 10,
        conditions: [{ parameterId: 'go', operator: 'fired' }],
        blendDuration: 0.1,
        interruption: 'higherPriority',
      },
      {
        id: 'hit-edge',
        from: null,
        to: 'hit-state',
        priority: 0,
        conditions: [{ parameterId: 'hit', operator: 'fired' }],
        blendDuration: 0.1,
        interruption: 'none',
      },
    ],
  };
}
function scene(): Artboard {
  return {
    id: 'board',
    name: 'Board',
    width: 200,
    height: 200,
    logic: graph(),
    nodes: [
      {
        id: 'node',
        name: 'Node',
        type: 'group',
        parentId: null,
        visible: true,
        opacity: 0.5,
        transform: { ...sceneTransform(), x: 20 },
      },
    ],
    clips: ['move', 'hit'].map((id) => ({
      id,
      name: id,
      duration: 1,
      loop: false,
      fps: 30,
      tracks: [
        {
          id: `${id}-x`,
          nodeId: 'node',
          property: 'x',
          keys: [{ id: `${id}-key`, time: 0, value: id === 'move' ? 100 : 0, curve: { type: 'stepped' } }],
        },
      ],
      events: [
        { id: `${id}-entry`, time: 0, name: `${id}-entry` },
        { id: `${id}-late`, time: step * 2, name: `${id}-late`, payload: 'سلام' },
      ],
    })),
  };
}
function rig(): RigNode {
  const skeleton = makeSkeletonData([makeBone('root', null, { x: 20 })]);
  skeleton.slots = [
    { id: 'slot', name: 'Slot', boneId: 'root', defaultAttachmentId: 'mesh', color: 0xff0000ff },
  ];
  skeleton.attachments = [
    {
      id: 'mesh',
      name: 'Mesh',
      type: 'mesh',
      textureId: '',
      meshVertices: [0, 0, 10, 0, 10, 10, 0, 10],
      meshTriangles: [0, 1, 2, 0, 2, 3],
      meshUVs: [0, 0, 1, 0, 1, 1, 0, 1],
      meshHull: [0, 1, 2, 3],
    },
  ];
  skeleton.attachments.push({
    ...structuredClone(skeleton.attachments[0]!),
    id: 'mesh-alt',
    name: 'Alternate',
  });
  skeleton.skins = [{ name: 'alternate', attachments: { slot: 'mesh-alt' } }];
  const animations: Animation[] = ['move', 'hit'].map((name) => ({
    name,
    duration: 1,
    loop: false,
    timelines: [
      {
        kind: 'boneProperty',
        boneId: 'root',
        property: 'x',
        keyframes: [{ time: 0, value: name === 'move' ? 100 : 0, curve: { type: 'stepped' } }],
      },
      {
        kind: 'deform',
        attachmentId: 'mesh',
        keyframes: [
          { time: 0, offsets: new Array(8).fill(name === 'move' ? 8 : 0), curve: { type: 'stepped' } },
        ],
      },
      {
        kind: 'event',
        keyframes: [
          { time: 0, eventName: `${name}-entry`, curve: { type: 'stepped' } },
          { time: step * 2, eventName: `${name}-late`, payload: 'سلام', curve: { type: 'stepped' } },
        ],
      },
    ],
  }));
  return {
    id: 'rig',
    name: 'Rig',
    type: 'rig',
    parentId: null,
    transform: sceneTransform(),
    visible: true,
    opacity: 1,
    skeleton,
    animations,
    logic: graph(),
  };
}
const sceneX = (p: SceneLogicPlayer) => p.getPose().transforms.node!.x;
const rigX = (p: RigLogicPlayer) => p.skeleton.pose.bones[0]!.local.x;
describe('Logic scene/character fixed-step posing adapters', () => {
  it('matches independent scene and rig blend/interrupt goldens and source preservation', () => {
    const board = scene(),
      owner = rig(),
      before = structuredClone({ board, owner });
    const s = new SceneLogicPlayer(board),
      r = new RigLogicPlayer(owner);
    for (const p of [s, r]) {
      expect(p.events).toEqual([]);
      p.fire('go');
      for (let tick = 0; tick < 6; tick++) p.update(step);
      expect(p.snapshot().transition?.progress).toBe(0.5);
      p.pause();
      expect(p.update(4)).toBe(0);
      p.play();
    }
    expect(sceneX(s)).toBe(60);
    expect(rigX(r)).toBe(60);
    expect(r.skeleton.pose.attachments.get('mesh')!.deform).toEqual(new Float32Array(8).fill(4));
    expect(r.getDeformedVertices('mesh')).toEqual(new Float32Array([64, 4, 74, 4, 74, 14, 64, 14]));
    for (const p of [s, r]) {
      p.fire('hit');
      for (let tick = 0; tick < 3; tick++) p.update(step);
      expect(p.snapshot().transition?.progress).toBe(0.25);
      p.update(0);
      p.update(step / 2);
    }
    expect(sceneX(s)).toBe(45);
    expect(rigX(r)).toBe(45);
    expect(r.skeleton.pose.attachments.get('mesh')!.deform).toEqual(new Float32Array(8).fill(3));
    expect({ board, owner }).toEqual(before);
    for (const p of [s, r]) {
      p.reset();
      expect(p.snapshot().tick).toBe(0);
      expect(p.events).toEqual([]);
    }
    expect(sceneX(s)).toBe(20);
    expect(rigX(r)).toBe(20);
  });
  it('freezes and restores an in-flight blend across disable, preserves pending input and resets fractions', () => {
    const s = new SceneLogicPlayer(scene()),
      r = new RigLogicPlayer(rig());
    for (const p of [s, r]) {
      p.fire('go');
      for (let n = 0; n < 6; n++) p.update(step);
      p.update(step / 2);
      p.setEnabled(false);
      expect(p.snapshot().tick).toBe(6);
      p.setInt('count', 7);
      expect(p.update(10)).toBe(0);
      expect(p.events).toEqual([]);
      expect(p.getParameter('count')).toBe(0);
    }
    expect(sceneX(s)).toBe(20);
    expect(rigX(r)).toBe(20);
    for (const p of [s, r]) p.setEnabled(true);
    expect(sceneX(s)).toBe(60);
    expect(rigX(r)).toBe(60);
    for (const p of [s, r]) {
      expect(p.update(step / 2)).toBe(0);
      expect(p.snapshot().tick).toBe(6);
      expect(p.update(step / 2)).toBe(1);
      expect(p.snapshot().tick).toBe(7);
      expect(p.getParameter('count')).toBe(7);
      expect(p.events).toEqual([]);
    }
    expect(sceneX(s)).toBeCloseTo(20 + (80 * 7) / 12, 12);
    expect(rigX(r)).toBeCloseTo(20 + (80 * 7) / 12, 12);
  });
  it('keeps skin selection transient and respects disabled/setup posing', () => {
    const source = rig(),
      before = structuredClone(source),
      p = new RigLogicPlayer(source);
    p.fire('go');
    p.update(step);
    const posed = structuredClone(p.skeleton.pose);
    expect(() => p.setSkin('missing')).toThrow(/Unknown skin/);
    expect(p.skeleton.pose).toEqual(posed);
    p.setEnabled(false);
    p.setSkin('alternate');
    expect(p.skeleton.pose.slots[0]!.attachmentId).toBe('mesh-alt');
    expect(rigX(p)).toBe(20);
    p.setEnabled(true);
    expect(p.skeleton.pose.slots[0]!.attachmentId).toBe('mesh-alt');
    p.setSkin('');
    expect(p.skeleton.pose.slots[0]!.attachmentId).toBe('mesh');
    expect(source).toEqual(before);
    expect(p.skeleton.data.activeSkin).toBe('');
  });
  it('rejects mismatched injected owners and detects in-place structural publication before posing', () => {
    const source = rig(),
      target = new Skeleton(source.skeleton);
    const p = new RigLogicPlayer(source, target);
    expect(p.skeleton).toBe(target);
    const other = new Skeleton(structuredClone(source.skeleton)),
      before = structuredClone(other.pose);
    expect(() => new RigLogicPlayer(source, other)).toThrow(/published source/);
    expect(other.pose).toEqual(before);
    target.replaceData(structuredClone(target.data));
    const published = structuredClone(target.pose);
    expect(() => p.update(0)).toThrow(/republished/);
    expect(target.pose).toEqual(published);
    expect(() => p.setEnabled(false)).toThrow(/republished/);
    expect(target.pose).toEqual(published);
    expect(() => p.setSkin('')).toThrow(/republished/);
  });
  it('emits destination events once on accepted steps, without outgoing/held/stall events', () => {
    for (const p of [new SceneLogicPlayer(scene()), new RigLogicPlayer(rig())]) {
      const fired: string[] = [];
      p.onEvent((e) => fired.push(e.eventName));
      p.fire('go');
      for (const delta of [0, -1, NaN, Infinity, step / 2]) expect(p.update(delta)).toBe(0);
      expect(fired).toEqual([]);
      p.update(step / 2);
      expect(fired).toEqual(['move-entry']);
      expect(p.events.map((e) => e.eventName)).toEqual(['move-entry']);
      p.update(0);
      expect(p.events).toEqual([]);
      p.fire('hit');
      expect(p.update(10)).toBe(12);
      expect(p.lastDiscardedSeconds).toBe(9.9);
      expect(fired).toEqual(['move-entry', 'hit-entry', 'hit-late']);
      p.update(0);
      expect(p.events).toEqual([]);
      p.pause();
      p.update(5);
      p.play();
      p.setEnabled(false);
      p.update(5);
      p.reset();
      expect(fired).toEqual(['move-entry', 'hit-entry', 'hit-late']);
    }
  });
  it('applies event-triggered input at the next step and cancels stale dispatch after callback reset', () => {
    for (const make of [() => new SceneLogicPlayer(scene()), () => new RigLogicPlayer(rig())]) {
      const p = make(),
        trace: string[] = [];
      p.onEvent((e) => {
        trace.push(`${p.snapshot().tick}:${e.eventName}`);
        if (e.eventName === 'move-entry') p.fire('hit');
      });
      p.fire('go');
      p.update(0.1);
      expect(trace).toEqual(['1:move-entry', '2:hit-entry', '3:hit-late']);
      const q = make(),
        seen: string[] = [];
      q.onEvent((e) => {
        seen.push(e.eventName);
        q.reset();
      });
      q.onEvent(() => seen.push('stale-listener'));
      q.fire('go');
      expect(q.update(0.1)).toBe(1);
      expect(q.snapshot().tick).toBe(0);
      expect(q.events).toEqual([]);
      expect(seen).toEqual(['move-entry']);
      const reentrant = make();
      const unsubscribe = reentrant.onEvent(() => reentrant.update(step));
      reentrant.fire('go');
      expect(() => reentrant.update(step)).toThrow(/reentrant/);
      unsubscribe();
      expect(reentrant.update(step)).toBe(1);
    }
  });
  it('samples entry without events and exactly crosses loop/clamp seams in both adapters', () => {
    const board = scene(),
      owner = rig();
    board.logic = graph('move');
    owner.logic = graph('move');
    board.clips![0]!.duration = 0.1;
    board.clips![0]!.events = [
      { id: 'end', time: 0.1, name: 'end' },
      { id: 'start', time: 0, name: 'start' },
    ];
    owner.animations[0]!.duration = 0.1;
    owner.animations[0]!.timelines = [
      {
        kind: 'event',
        keyframes: [
          { time: 0.1, eventName: 'end', curve: { type: 'stepped' } },
          { time: 0, eventName: 'start', curve: { type: 'stepped' } },
        ],
      },
    ];
    for (const loop of [true, false]) {
      board.logic.states[0]!.loop = loop;
      owner.logic.states[0]!.loop = loop;
      for (const p of [new SceneLogicPlayer(board), new RigLogicPlayer(owner)]) {
        expect(p.events).toEqual([]);
        const fired: string[] = [];
        p.onEvent((e) => fired.push(`${e.eventName}:${e.cycle}`));
        for (let n = 0; n < 3; n++) p.update(0.1);
        expect(fired).toEqual(
          loop
            ? ['start:0', 'end:0', 'start:1', 'end:1', 'start:2', 'end:2', 'start:3']
            : ['start:0', 'end:0'],
        );
        expect(p.snapshot().clipTime).toBe(loop ? 0 : 0.1);
      }
    }
  });
  it('replays the saved scene/rig fixture with exact display grouping parity and unchanged source', () => {
    const project = deserializeProject(readFileSync('fixtures/bbbproj-v10-logic.json', 'utf8')),
      before = structuredClone(project),
      owner = activeRigNode(project)!;
    let reference: unknown;
    for (const hz of [10, 60, 120, 144, 240, 1000]) {
      const s = new SceneLogicPlayer(project.artboards[0]!),
        r = new RigLogicPlayer(owner),
        events: string[] = [];
      for (const [label, p] of [
        ['s', s],
        ['r', r],
      ] as const) {
        p.onEvent((e) => events.push(`${label}:${e.clipId}:${e.cycle}:${e.eventName}`));
        p.fire('open');
      }
      for (let n = 0; n < hz; n++) {
        s.update(1 / hz);
        r.update(1 / hz);
      }
      const result = {
        s: s.snapshot(),
        r: r.snapshot(),
        pose: s.getPose(),
        matrices: r.getWorldTransforms().slice(),
        vertices: [...r.skeleton.pose.attachments].map(([id, a]) => [id, a.verts.slice()]),
        events,
      };
      if (!reference) reference = structuredClone(result);
      else expect(result, `display ${hz}Hz`).toEqual(reference);
    }
    expect(project).toEqual(before);
  });
  it('replays accepted-tick inputs through all primary/spring constraints with exact matrices and weighted vertices', () => {
    for (const kind of ['Standard', 'Heavy'] as const) {
      const project = constraintFixture(kind),
        source = activeRigNode(project)!;
      const move = source.animations[0]!;
      move.name = 'move';
      const hit = structuredClone(source.animations[1]!);
      hit.name = 'hit';
      source.animations = [move, hit];
      source.logic = graph('move');
      source.logic.states[1]!.loop = true;
      source.logic.states[2]!.loop = true;
      // Independent tick inputs: entry -> Move at 1, interrupt -> Hit at 4.
      // Event callbacks enqueue exactly the same next-step input across frame groupings.
      move.timelines.push({
        kind: 'event',
        keyframes: [{ time: step * 3, eventName: 'input-hit', curve: { type: 'stepped' } }],
      });
      const before = structuredClone(project);
      let reference: unknown;
      for (const hz of [10, 60, 120, 144, 240, 1000]) {
        const p = new RigLogicPlayer(source),
          trace: unknown[] = [];
        p.onEvent((e) => {
          trace.push([p.snapshot().tick, e.eventName, e.cycle, p.getWorldTransforms().slice()]);
          if (e.eventName === 'input-hit') p.fire('hit');
        });
        p.fire('go');
        for (let n = 0; n < hz; n++) p.update(1 / hz);
        const result = {
          state: p.snapshot(),
          matrices: p.getWorldTransforms().slice(),
          vertices: [...p.skeleton.pose.attachments].map(([id, a]) => [
            id,
            a.verts.slice(),
            a.deform.slice(),
          ]),
          trace,
        };
        expect(p.snapshot().stateId).toBe('hit-state');
        expect(p.getWorldTransforms().every(Number.isFinite)).toBe(true);
        expect(trace).toHaveLength(1);
        if (!reference) reference = structuredClone(result);
        else expect(result, `${kind} ${hz}Hz`).toEqual(reference);
      }
      expect(project).toEqual(before);
    }
  }, 15000);
  it('uses the shared independently predicted critical spring response and rebases explicitly', () => {
    const source = rig();
    source.logic = graph('move');
    source.skeleton.secondaryConstraints = [
      {
        id: 'spring',
        boneId: 'root',
        preset: 'soft',
        frequency: 1 / Math.PI,
        damping: 1,
        mix: 1,
        maxAngle: Math.PI,
        order: 0,
      },
    ];
    source.animations[0]!.timelines = [
      {
        kind: 'boneProperty',
        boneId: 'root',
        property: 'rotation',
        keyframes: [
          { time: 0, value: 0, curve: { type: 'stepped' } },
          { time: step, value: 1, curve: { type: 'linear' } },
        ],
      },
    ];
    const before = structuredClone(source),
      p = new RigLogicPlayer(source),
      stepped = new RigLogicPlayer(source);
    stepped.pause();
    for (let tick = 0; tick < 12; tick++) {
      expect(stepped.step()).toBe(1);
      expect(stepped.playing).toBe(false);
    }
    p.update(0.1);
    expect(stepped.snapshot()).toEqual(p.snapshot());
    expect(stepped.skeleton.pose).toEqual(p.skeleton.pose);
    expect(stepped.getWorldTransforms()).toEqual(p.getWorldTransforms());
    const heading = () => Math.atan2(p.getWorldTransforms()[1]!, p.getWorldTransforms()[0]!);
    expect(heading()).toBeCloseTo(1 - (1 + 0.2) * Math.exp(-0.2), 6);
    const held = p.getWorldTransforms().slice();
    p.update(0);
    p.update(step / 2);
    expect(p.getWorldTransforms()).toEqual(held);
    p.resetSecondaryMotion();
    p.update(0);
    expect(heading()).toBeCloseTo(1, 6);
    expect(source).toEqual(before);
  });
  it('steps paused inputs/events exactly once and preserves lifecycle isolation', () => {
    const p = new SceneLogicPlayer(scene());
    const before = p.snapshot();
    expect(() => p.step()).toThrow(/Pause/);
    expect(p.snapshot()).toEqual(before);
    p.pause();
    p.fire('go');
    p.setEnabled(false);
    expect(p.step()).toBe(0);
    expect(p.currentTick).toBe(0);
    p.setEnabled(true);
    const trace: string[] = [];
    p.onEvent((event) => {
      trace.push(event.eventName);
      expect(() => p.step()).toThrow(/reentrant/);
      if (event.eventName === 'move-late') p.reset();
    });
    expect(p.step()).toBe(1);
    expect(p.snapshot().stateId).toBe('move');
    expect(p.playing).toBe(false);
    expect(trace).toEqual(['move-entry']);
    expect(p.step()).toBe(1);
    expect(trace).toEqual(['move-entry', 'move-late']);
    expect(p.currentTick).toBe(0);
    expect(p.snapshot().stateId).toBe('idle');
    expect(p.playing).toBe(false);
    expect(p.events).toEqual([]);
    expect(p.step()).toBe(1);
    expect(p.currentTick).toBe(1);
  });
  it('chooses destination attachment/draw order immediately, including incomplete blends', () => {
    const source = rig();
    source.skeleton.slots.push({
      id: 'other',
      name: 'Other',
      boneId: 'root',
      defaultAttachmentId: 'mesh-alt',
      color: 0xffffffff,
    });
    source.animations[0]!.timelines.push(
      {
        kind: 'slotAttachment',
        slotId: 'slot',
        keyframes: [{ time: 0, attachmentId: null, curve: { type: 'stepped' } }],
      },
      { kind: 'drawOrder', keyframes: [{ time: 0, slotOrder: [1, 0], curve: { type: 'stepped' } }] },
    );
    const p = new RigLogicPlayer(source);
    p.fire('go');
    p.update(step);
    expect(p.snapshot().transition?.progress).toBeCloseTo(1 / 12, 12);
    expect(p.skeleton.pose.slots[0]!.attachmentId).toBeNull();
    expect(p.skeleton.pose.slotOrder).toEqual([1, 0]);
    p.fire('hit');
    p.update(step);
    expect(p.skeleton.pose.slots[0]!.attachmentId).toBe('mesh');
    expect(p.skeleton.pose.slotOrder).toEqual([0, 1]);
  });
  it('keeps disabled authored entry dormant and rejects unsupported event loops before posing', () => {
    const board = scene(),
      owner = rig();
    board.logic!.enabled = false;
    owner.logic!.enabled = false;
    board.logic!.entryStateId = 'move';
    owner.logic!.entryStateId = 'move';
    const s = new SceneLogicPlayer(board),
      r = new RigLogicPlayer(owner);
    expect(sceneX(s)).toBe(20);
    expect(rigX(r)).toBe(20);
    for (const p of [s, r]) {
      expect(p.update(0.1)).toBe(0);
      p.setEnabled(true);
    }
    expect(sceneX(s)).toBe(100);
    expect(rigX(r)).toBe(100);
    const tiny = rig();
    tiny.logic = graph('move');
    tiny.animations[0]!.duration = step / 1001;
    tiny.animations[0]!.timelines = [
      { kind: 'event', keyframes: [{ time: 0, eventName: 'e', curve: { type: 'stepped' } }] },
    ];
    const target = new Skeleton(tiny.skeleton),
      before = structuredClone(target.pose);
    expect(() => new RigLogicPlayer(tiny, target)).toThrow(/too short/);
    expect(target.pose).toEqual(before);
    const finiteTiny = rig();
    finiteTiny.logic = graph('move');
    finiteTiny.animations[0]!.duration = 1e-13;
    finiteTiny.animations[0]!.timelines = [];
    const p = new RigLogicPlayer(finiteTiny);
    p.update(step);
    expect(p.snapshot().clipTime).toBeGreaterThan(0);
    expect(p.snapshot().clipTime).toBeLessThan(1e-13);
  });
});
