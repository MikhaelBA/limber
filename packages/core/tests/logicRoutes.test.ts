import { describe, expect, it } from 'vitest';
import {
  SceneLogicPlayer,
  RigLogicPlayer,
  LogicMachine,
  validateProject,
  serializeProject,
  type LogicGraph,
  type LogicRoute,
} from '../src/index';
import { logicBindingsFixture } from '../../../tools/logic-bindings-fixture.mjs';
import { logicSourceFixture } from '../../../tools/logic-fixtures.mjs';
function source() {
  const p = logicBindingsFixture(),
    board = p.artboards[0]!,
    graph = board.logic!;
  graph.parameters.push({ id: 'pressed', name: 'pressed', type: 'trigger', initial: false });
  graph.states.push({ id: 'active', name: 'Active', clip: null, loop: false });
  graph.transitions.push({
    id: 'press',
    from: 'entry',
    to: 'active',
    priority: 0,
    conditions: [{ parameterId: 'pressed', operator: 'fired' }],
    blendDuration: 0.1,
    interruption: 'none',
  });
  graph.routes = [
    { id: 'click-label', targetId: 'instance', event: 'click', parameterId: 'label', value: 'Clicked 🌿' },
    { id: 'click-trigger', targetId: 'instance', event: 'click', parameterId: 'pressed' },
    { id: 'focus-alpha', targetId: null, event: 'focus', parameterId: 'alpha', value: 0.1 },
    { id: 'blur-alpha', targetId: null, event: 'blur', parameterId: 'alpha', value: 0.9 },
  ];
  return p;
}
describe('portable typed interaction routes', () => {
  it('bakes routes, sends typed authored-order batches and publishes only at the next tick', () => {
    const p = source(),
      before = serializeProject(p),
      player = new SceneLogicPlayer(p.artboards[0]!, p.components);
    expect(player.dispatch('click', 'direct')).toBe(0);
    expect(player.dispatch('click', 'instance')).toBe(2);
    expect(player.snapshot().stateId).toBe('entry');
    expect(player.getParameter('label')).toBe('سلام 🌿');
    player.update(1 / 120);
    expect(player.snapshot().stateId).toBe('active');
    expect(player.getParameter('pressed')).toBe(false);
    expect(player.getParameter('label')).toBe('Clicked 🌿');
    expect(player.inputRouter.recentDispatches()[0]).toEqual({
      tick: 0,
      sequence: 0,
      event: 'click',
      targetId: 'instance',
      routeIds: ['click-label', 'click-trigger'],
      inputs: [
        { name: 'label', type: 'string', value: 'Clicked 🌿' },
        { name: 'pressed', type: 'trigger', value: true },
      ],
    });
    expect(serializeProject(p)).toBe(before);
    p.artboards[0]!.logic!.routes![2]!.value = 0.8;
    player.dispatch('focus');
    player.update(1 / 120);
    expect(player.getParameter('alpha')).toBe(Math.fround(0.1));
  });
  it('preflights invalid batches and queue overflow without enqueueing a prefix or logging a receipt', () => {
    const p = source(),
      graph = p.artboards[0]!.logic!,
      player = new SceneLogicPlayer(p.artboards[0]!, p.components);
    for (let i = 0; i < 1023; i++) player.setBool('shown', true);
    expect(() => player.dispatch('click', 'instance')).toThrow(/1024/);
    expect(player.inputRouter.recentDispatches()).toEqual([]);
    player.update(1 / 120);
    expect(player.getParameter('label')).toBe('سلام 🌿');
    expect(player.snapshot().stateId).toBe('entry');
    const machine = new LogicMachine(graph, new Map());
    expect(() =>
      machine.applyInputs([
        { name: 'label', type: 'string', value: 'partial' },
        { name: 'alpha', type: 'float', value: 2 },
      ]),
    ).toThrow();
    machine.step();
    expect(machine.getParameter('label')).toBe('سلام 🌿');
    expect(() => machine.applyInputs(null as never)).toThrow();
  });
  it('retains paused/disabled route input, clears pending inputs/receipt history on reset', () => {
    const p = source(),
      player = new SceneLogicPlayer(p.artboards[0]!, p.components);
    player.pause();
    player.dispatch('click', 'instance');
    player.update(1);
    expect(player.snapshot().tick).toBe(0);
    player.play();
    player.setEnabled(false);
    player.update(1);
    expect(player.snapshot().tick).toBe(0);
    player.setEnabled(true);
    player.update(1 / 120);
    expect(player.snapshot().stateId).toBe('active');
    player.dispatch('focus');
    player.reset();
    player.update(1 / 120);
    expect(player.getParameter('alpha')).toBe(0.5);
    expect(player.inputRouter.recentDispatches()).toEqual([]);
  });
  it('preserves callback tick/sequence, parameters and full bound poses under six display groupings', () => {
    const p = source(),
      board = p.artboards[0]!;
    board.clips = [
      {
        id: 'timed',
        name: 'Timed',
        duration: 1,
        loop: false,
        fps: 30,
        tracks: [],
        events: [0.25, 0.5, 0.75].map((time, i) => ({
          id: `event-${i}`,
          time,
          name: ['focus', 'blur', 'click'][i]!,
        })),
      },
    ];
    board.logic!.states[0]!.clip = 'timed';
    const results = [10, 60, 120, 144, 240, 1000].map((fps) => {
      const player = new SceneLogicPlayer(board, p.components);
      player.onEvent((event) =>
        player.dispatch(
          event.eventName as 'focus' | 'blur' | 'click',
          event.eventName === 'click' ? 'instance' : null,
        ),
      );
      for (let i = 0; i < fps; i++) player.update(1 / fps);
      return {
        snapshot: player.snapshot(),
        view: player.getView(),
        trace: player.inputRouter.recentDispatches(),
      };
    });
    for (const result of results) expect(result).toEqual(results[0]);
    expect(results[0]!.trace.map((entry) => entry.tick)).toEqual([30, 60, 90]);
    expect(results[0]!.snapshot.stateId).toBe('active');
    expect(results[0]!.snapshot.parameters.alpha).toBe(Math.fround(0.9));
  });
  it('bounds and isolates receipt history and validates unknown dispatch signals', () => {
    const p = source(),
      player = new SceneLogicPlayer(p.artboards[0]!, p.components);
    for (let i = 0; i < 260; i++) {
      player.dispatch('focus');
      player.update(1 / 120);
    }
    const trace = player.inputRouter.recentDispatches();
    expect(trace).toHaveLength(256);
    expect(trace[0]!.sequence).toBe(4);
    trace[0]!.inputs[0]!.value = 1;
    expect(player.inputRouter.recentDispatches()[0]!.inputs[0]!.value).toBe(0.1);
    expect(() => player.dispatch('executeCode' as never)).toThrow();
    expect(() => player.dispatch('click', '')).toThrow();
    expect(player.inputRouter.recentDispatches()).toHaveLength(256);
    expect(player.inputRouter.recentDispatches(0)).toEqual([]);
    expect(player.inputRouter.recentDispatches(2).map((r) => r.sequence)).toEqual([258, 259]);
    for (const limit of [-1, 0.5, 257])
      expect(() => player.inputRouter.recentDispatches(limit)).toThrow(/Trace limit/);
  });
  it('bounds total traced writes when a signal has many routes', () => {
    const p = source(),
      graph = p.artboards[0]!.logic!;
    graph.routes = Array.from({ length: 256 }, (_, index) => ({
      id: `route-${index}`,
      targetId: null,
      event: 'test',
      parameterId: 'alpha',
      value: 0.25,
    }));
    const player = new SceneLogicPlayer(p.artboards[0]!, p.components);
    for (let i = 0; i < 20; i++) {
      player.dispatch('test');
      player.update(1 / 120);
    }
    const trace = player.inputRouter.recentDispatches();
    expect(trace).toHaveLength(4);
    expect(trace[0]!.sequence).toBe(16);
    expect(trace.reduce((sum, record) => sum + record.inputs.length, 0)).toBe(1024);
    expect(player.getParameter('alpha')).toBe(0.25);
  });
  it('rejects malformed routes, incompatible bound values and missing native references even while disabled', () => {
    const mutations: ((g: LogicGraph) => void)[] = [
      (g) => {
        g.routes = null as never;
      },
      (g) => {
        g.routes![0]!.id = 'entry';
      },
      (g) => {
        g.routes![0]!.event = 'eval' as never;
      },
      (g) => {
        g.routes![0]!.targetId = 'missing';
      },
      (g) => {
        g.routes![0]!.parameterId = 'missing';
      },
      (g) => {
        g.routes![0]!.value = true;
      },
      (g) => {
        g.routes![1]!.value = false;
      },
      (g) => {
        g.routes![2]!.value = 1.0000000001;
      },
      (g) => {
        g.routes![0] = { ...g.routes![0]!, code: 'ignored' } as never;
      },
      (g) => {
        g.routes = new Array(257).fill(g.routes![0]) as LogicRoute[];
      },
    ];
    for (const mutate of mutations) {
      const p = source();
      p.artboards[0]!.logic!.enabled = false;
      mutate(p.artboards[0]!.logic!);
      const before = structuredClone(p);
      expect(() => validateProject(p)).toThrow();
      expect(p).toEqual(before);
    }
  });
  it('allows only viewport targets in rig graphs and shares the same typed route queue', () => {
    const p = logicSourceFixture(),
      board = p.artboards[0]!,
      rig = board.nodes[0]!;
    if (rig.type !== 'rig') throw new Error('Missing rig');
    rig.logic!.routes = [{ id: 'rig-click', targetId: null, event: 'click', parameterId: 'rig-open' }];
    const player = new RigLogicPlayer(rig);
    player.dispatch('click');
    player.update(1 / 120);
    expect(player.snapshot().stateId).toBe('rig-active');
    rig.logic!.routes[0]!.targetId = rig.id;
    expect(() => validateProject(p)).toThrow(/own artboard/);
    expect(() => new RigLogicPlayer(rig)).toThrow();
  });
});
