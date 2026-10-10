import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  validateEventPayload,
  runtimeEventPayload,
  formatEventPayload,
  validateAnimationEvents,
  deserializeProject,
  serializeProject,
  activeRigNode,
  LogicEventSampler,
  RigLogicPlayer,
  SceneLogicPlayer,
  exportSpineJson,
  projectFromLegacy,
  sceneTransform,
  PROJECT_SCHEMA_VERSION,
  type EventPayload,
  type TypedEventPayload,
  type SceneClip,
} from '../src/index';
import { RuntimePlayer } from '../../runtime/src/player';
import { makeBone, makeSkeletonData } from './helpers';
const payloads: TypedEventPayload[] = [
  { type: 'bool', value: true },
  { type: 'float', value: 0.1 },
  { type: 'int', value: -2147483648 },
  { type: 'string', value: 'سلام 🌿' },
];
function source() {
  const project = projectFromLegacy({
    skeleton: makeSkeletonData([makeBone('root', null)]),
    animations: [
      {
        name: 'events',
        duration: 0.1,
        loop: true,
        timelines: [
          {
            kind: 'event',
            keyframes: payloads.map((payload, i) => ({
              time: 0.05,
              eventName: `e${i}`,
              payload: structuredClone(payload),
              curve: { type: 'stepped' as const },
            })),
          },
        ],
      },
    ],
    assetManifest: {},
  });
  const board = project.artboards[0]!,
    rig = activeRigNode(project)!;
  const graph = {
    id: 'graph',
    name: 'Graph',
    enabled: true,
    entryStateId: 'state',
    parameters: [],
    states: [{ id: 'state', name: 'State', clip: 'events', loop: true }],
    transitions: [],
  };
  rig.logic = structuredClone(graph);
  board.logic = structuredClone(graph);
  board.clips = [
    {
      id: 'events',
      name: 'Events',
      duration: 0.1,
      fps: 30,
      loop: true,
      tracks: [],
      events: payloads.map((payload, i) => ({
        id: `event-${i}`,
        time: 0.05,
        name: `e${i}`,
        payload: structuredClone(payload),
      })),
    },
  ];
  return project;
}
describe('portable typed event payloads', () => {
  it('replays the actual editor-saved schema-11 typed scene and character keys without modifying native source', () => {
    const project = deserializeProject(readFileSync('fixtures/bbbproj-v11-typed-events.json', 'utf8')),
      before = structuredClone(project),
      board = structuredClone(project.artboards[0]!),
      rig = activeRigNode(project)!;
    const character = structuredClone(rig);
    const graph = {
      id: 'test-graph',
      name: 'Playback',
      enabled: true,
      entryStateId: 'state',
      parameters: [],
      states: [{ id: 'state', name: 'Entry', clip: board.clips![0]!.id, loop: true }],
      transitions: [],
    };
    board.logic = graph;
    character.logic = {
      ...structuredClone(graph),
      states: [{ ...graph.states[0]!, clip: character.animations[0]!.name }],
    };
    const scenePlayer = new SceneLogicPlayer(board),
      rigPlayer = new RigLogicPlayer(character);
    scenePlayer.update(1 / 120);
    rigPlayer.update(1 / 120);
    expect(scenePlayer.events.map((e) => [e.eventName, e.payload])).toEqual([
      ['UIConfirm', { type: 'bool', value: true }],
      ['LocalizedCue', { type: 'string', value: 'سلام 🌿' }],
    ]);
    expect(rigPlayer.events.map((e) => [e.eventName, e.payload])).toEqual([
      ['AttackHit', { type: 'int', value: 17 }],
    ]);
    expect(deserializeProject(serializeProject(project))).toEqual(before);
    expect(project).toEqual(before);
  });
  it('validates exact types/ranges without coercion, nesting or silent unknown fields', () => {
    for (const value of [...payloads, undefined, 1.5, 'scalar'])
      expect(() => validateEventPayload(value)).not.toThrow();
    const invalid: unknown[] = [
      null,
      false,
      [],
      {},
      NaN,
      Infinity,
      1e40,
      'x'.repeat(4097),
      { type: 'bool', value: 1 },
      { type: 'float', value: '1' },
      { type: 'float', value: Infinity },
      { type: 'float', value: 1e40 },
      { type: 'int', value: 1.5 },
      { type: 'int', value: 2147483648 },
      { type: 'int', value: -2147483649 },
      { type: 'string', value: false },
      { type: 'string', value: 'x'.repeat(4097) },
      { type: 'trigger', value: true },
      { type: 'float', value: 1, expression: 'code' },
      { type: 'int' },
      { type: 'string', value: { nested: 'not supported' } },
    ];
    for (const value of invalid)
      expect(() => validateEventPayload(value), JSON.stringify(value)).toThrow(/payload/i);
  });
  it('isolates runtime records and canonicalizes float while retaining authored precision', () => {
    const original = { type: 'float', value: 0.1 } as const;
    const emitted = runtimeEventPayload(original) as TypedEventPayload;
    expect(emitted).toEqual({ type: 'float', value: Math.fround(0.1) });
    expect(original.value).toBe(0.1);
    emitted.value = 99;
    expect(runtimeEventPayload(original)).toEqual({ type: 'float', value: Math.fround(0.1) });
    expect(formatEventPayload(original)).toBe('float: 0.1');
    expect(formatEventPayload(payloads[3])).toBe('string: سلام 🌿');
    expect(formatEventPayload(undefined)).toBe('');
    expect(formatEventPayload(2)).toBe('2');
    const sampler = new LogicEventSampler(0.1, [{ time: 0.05, eventName: 'e', payload: original }]);
    const first = sampler.collect(5, 6, true, false, 'c', 'c');
    (first[0]!.payload as TypedEventPayload).value = 12;
    expect(sampler.collect(17, 18, true, false, 'c', 'c')[0]!.payload).toEqual({
      type: 'float',
      value: Math.fround(0.1),
    });
  });
  it('round trips native source and produces identical payloads in scene Logic, rig Logic and raw playback', () => {
    const project = source(),
      before = structuredClone(project),
      rig = activeRigNode(project)!;
    expect(project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(deserializeProject(serializeProject(project))).toEqual(project);
    const players = [
      new SceneLogicPlayer(project.artboards[0]!),
      new RigLogicPlayer(rig),
      new RuntimePlayer({ skeleton: rig.skeleton, animations: rig.animations }),
    ];
    (players[2] as RuntimePlayer).setAnimation('events');
    const expected = payloads.map(runtimeEventPayload);
    for (const player of players) {
      const seen: (EventPayload | undefined)[] = [];
      player.onEvent((e) => seen.push(structuredClone(e.payload)));
      player.update(0.075);
      expect(seen).toEqual(expected);
      player.update(0);
      expect(seen).toHaveLength(4);
    }
    expect(project).toEqual(before);
  });
  it('rejects malformed typed data on dormant scene/rig clips before load and preserves immutable earlier fixtures', () => {
    for (const kind of ['scene', 'rig']) {
      const p = source();
      delete p.artboards[0]!.logic;
      delete activeRigNode(p)!.logic;
      const invalid = { type: 'int', value: 1.5 } as TypedEventPayload;
      if (kind === 'scene') p.artboards[0]!.clips![0]!.events[0]!.payload = invalid;
      else
        activeRigNode(p)!.animations[0]!.timelines[0]!.keyframes[0] = {
          time: 0.05,
          eventName: 'bad',
          payload: invalid,
          curve: { type: 'stepped' },
        } as never;
      expect(() => deserializeProject(JSON.stringify(p))).toThrow(/int payload/);
    }
    const oldText = readFileSync('fixtures/bbbproj-v10-logic.json', 'utf8');
    const migrated = deserializeProject(oldText);
    expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(readFileSync('fixtures/bbbproj-v10-logic.json', 'utf8')).toBe(oldText);
  });
  it('validates total event count/time/name across multiple timelines and rejects unbounded Logic loops at import', () => {
    const rig = activeRigNode(source())!,
      animation = rig.animations[0]!;
    for (const time of [-1, 0.11, NaN, Infinity]) {
      const a = structuredClone(animation);
      a.timelines[0]!.keyframes[0]!.time = time;
      expect(() => validateAnimationEvents([a])).toThrow(/time/);
    }
    const a = structuredClone(animation);
    a.timelines.push({
      kind: 'event',
      keyframes: new Array(509).fill(a.timelines[0]!.keyframes[0] as never),
    });
    expect(() => validateAnimationEvents([a])).toThrow(/512/);
    for (const kind of ['scene', 'rig']) {
      const p = source();
      if (kind === 'scene') {
        const clip = p.artboards[0]!.clips![0]!;
        clip.duration = 1e-6;
        clip.events = [{ id: 'e', time: 0, name: 'tiny' }];
      } else {
        const clip = activeRigNode(p)!.animations[0]!;
        clip.duration = 1e-6;
        clip.timelines = [
          { kind: 'event', keyframes: [{ time: 0, eventName: 'tiny', curve: { type: 'stepped' } }] },
        ];
      }
      expect(() => deserializeProject(JSON.stringify(p))).toThrow(/too short/);
    }
  });
  it('refuses compatibility export instead of losing typed semantics', () => {
    const p = source(),
      rig = activeRigNode(p)!;
    expect(() =>
      exportSpineJson({ skeleton: rig.skeleton, animations: rig.animations, assetManifest: {} }),
    ).toThrow(/typed event payload/);
    const clip = p.artboards[0]!.clips![0] as SceneClip;
    expect(clip.events[3]!.payload).toEqual(payloads[3]);
    expect(rig.transform).toEqual(sceneTransform());
  });
});
