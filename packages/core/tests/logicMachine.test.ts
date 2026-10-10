import { describe, it, expect } from 'vitest';
import {
  LogicMachine,
  validateLogicGraph,
  LogicValidationError,
  FixedStepClock,
  LOGIC_STEP_SECONDS,
  validateRecordedLogicInputs,
  type LogicGraph,
  type LogicTransition,
  type RecordedLogicInput,
} from '../src/index';
const catalog = new Map(
  ['idle', 'walk', 'attack', 'hit'].map((id) => [id, { duration: id === 'attack' ? 0.25 : 1 }]),
);
const edge = (patch: Partial<LogicTransition> = {}): LogicTransition => ({
  id: 'walk-edge',
  from: 'idle-state',
  to: 'walk-state',
  priority: 10,
  conditions: [{ parameterId: 'speed', operator: 'gt', value: 0.1 }],
  blendDuration: 0.1,
  interruption: 'higherPriority',
  ...patch,
});
const graph = (): LogicGraph => ({
  id: 'graph',
  name: 'Locomotion',
  enabled: true,
  entryStateId: 'idle-state',
  parameters: [
    { id: 'speed', name: 'speed', type: 'float', initial: 0 },
    { id: 'enabled', name: 'enabled', type: 'bool', initial: true },
    { id: 'coins', name: 'coins', type: 'int', initial: 0 },
    { id: 'label', name: 'label', type: 'string', initial: 'سلام' },
    { id: 'attack-trigger', name: 'attack', type: 'trigger', initial: false },
    { id: 'hit-trigger', name: 'hit', type: 'trigger', initial: false },
  ],
  states: ['idle', 'walk', 'attack', 'hit'].map((id) => ({
    id: `${id}-state`,
    name: id,
    clip: id,
    loop: id === 'idle' || id === 'walk',
  })),
  transitions: [
    edge(),
    edge({
      id: 'attack-edge',
      from: null,
      to: 'attack-state',
      priority: 1,
      conditions: [{ parameterId: 'attack-trigger', operator: 'fired' }],
      blendDuration: 0.05,
    }),
    edge({
      id: 'hit-edge',
      from: null,
      to: 'hit-state',
      priority: 0,
      conditions: [{ parameterId: 'hit-trigger', operator: 'fired' }],
      blendDuration: 0,
    }),
    edge({
      id: 'return',
      from: 'attack-state',
      to: 'idle-state',
      priority: 20,
      conditions: [],
      exitTime: 1,
      blendDuration: 0,
    }),
  ],
});
describe('portable deterministic Logic kernel', () => {
  it('evaluates typed equality and ordered numeric guards without coercion', () => {
    for (const [operator, literal, accepted] of [
      ['eq', 3, true],
      ['neq', 3, false],
      ['gt', 2, true],
      ['gte', 3, true],
      ['lt', 3, false],
      ['lte', 3, true],
    ] as const) {
      const g = graph();
      g.transitions = [
        edge({
          blendDuration: 0,
          conditions: [
            { parameterId: 'coins', operator, value: literal },
            { parameterId: 'label', operator: 'eq', value: 'سلام' },
            { parameterId: 'enabled', operator: 'neq', value: false },
          ],
        }),
      ];
      const m = new LogicMachine(g, catalog);
      m.setInt('coins', 3);
      m.step();
      expect(m.snapshot().stateId, operator).toBe(accepted ? 'walk-state' : 'idle-state');
    }
  });
  it('bounds pending input and isolates baked graph/catalog data from external changes', () => {
    const g = graph(),
      clips = new Map([...catalog].map(([id, clip]) => [id, { ...clip }])),
      m = new LogicMachine(g, clips);
    g.entryStateId = 'hit-state';
    g.parameters[0]!.name = 'renamed';
    clips.get('idle')!.duration = 99;
    for (let n = 0; n < 1024; n++) m.setInt('coins', n);
    expect(() => m.setInt('coins', 42)).toThrow(/1024/);
    m.step();
    expect(m.getParameter('coins')).toBe(1023);
    expect(m.snapshot().stateId).toBe('idle-state');
    expect(m.getParameter('speed')).toBe(0);
    m.setInt('coins', -2147483648);
    m.step();
    expect(m.getParameter('coins')).toBe(-2147483648);
    for (let n = 2; n < 120; n++) m.step();
    expect(m.snapshot().clipTime).toBe(0);
  });
  it('queues typed setters until a step, canonicalizes float and rejects invalid input atomically', () => {
    const g = graph(),
      before = structuredClone(g),
      m = new LogicMachine(g, catalog);
    m.setFloat('speed', 0.1);
    m.setBool('enabled', false);
    m.setInt('coins', 2147483647);
    m.setString('label', 'پاداش 12');
    expect(m.getParameter('speed')).toBe(0);
    m.step();
    expect(m.snapshot().stateId).toBe('idle-state'); // threshold literal also Float32
    expect(m.snapshot().parameters).toEqual({
      speed: Math.fround(0.1),
      enabled: false,
      coins: 2147483647,
      label: 'پاداش 12',
      attack: false,
      hit: false,
    });
    const snapshot = m.snapshot(),
      changes = m.recentChanges();
    for (const run of [
      () => m.setFloat('speed', Infinity),
      () => m.setFloat('speed', 1e40),
      () => m.setFloat('speed', NaN),
      () => m.setInt('coins', 2147483648),
      () => m.setInt('coins', 1.5),
      () => m.setBool('speed', true),
      () => m.fire('coins'),
      () => m.setString('label', 'x'.repeat(4097)),
      () => m.setBool('unknown', false),
    ])
      expect(run).toThrow();
    expect(m.snapshot()).toEqual(snapshot);
    expect(m.recentChanges()).toEqual(changes);
    expect(g).toEqual(before);
    m.setFloat('speed', 0.10000001);
    m.step();
    expect(m.snapshot().stateId).toBe('walk-state');
  });
  it('chooses globally prioritized Any State, consumes only winning triggers and preserves failed guards', () => {
    const g = graph();
    g.transitions[1]!.conditions.push({ parameterId: 'enabled', operator: 'eq', value: true });
    const m = new LogicMachine(g, catalog);
    m.setFloat('speed', 2);
    m.fire('attack');
    m.fire('hit');
    m.step();
    expect(m.snapshot().stateId).toBe('hit-state');
    expect(m.getParameter('hit')).toBe(false);
    expect(m.getParameter('attack')).toBe(true);
    m.setBool('enabled', false);
    m.step();
    expect(m.snapshot().stateId).toBe('hit-state');
    expect(m.getParameter('attack')).toBe(true);
    m.setBool('enabled', true);
    m.step();
    expect(m.snapshot().stateId).toBe('attack-state');
    expect(m.getParameter('attack')).toBe(false);
    m.fire('attack');
    m.step();
    expect(m.getParameter('attack')).toBe(true); // Any State self is skipped
  });
  it('consumes an AND of latched triggers together and logs a duplicate fired guard only once', () => {
    const g = graph();
    g.transitions = [
      edge({
        conditions: [
          { parameterId: 'attack-trigger', operator: 'fired' },
          { parameterId: 'hit-trigger', operator: 'fired' },
          { parameterId: 'hit-trigger', operator: 'fired' },
        ],
        blendDuration: 0,
      }),
    ];
    const m = new LogicMachine(g, catalog);
    m.fire('attack');
    m.step();
    expect(m.getParameter('attack')).toBe(true);
    m.fire('hit');
    m.step();
    expect(m.snapshot().stateId).toBe('walk-state');
    expect(m.getParameter('attack')).toBe(false);
    expect(m.getParameter('hit')).toBe(false);
    expect(
      m
        .recentChanges()
        .filter((c) => c.kind === 'triggerConsumed')
        .map((c) => c.name),
    ).toEqual(['attack', 'hit']);
    m.fire('attack');
    m.resetTrigger('attack');
    m.step();
    expect(m.getParameter('attack')).toBe(false);
  });
  it('evaluates exits against the preceding completed step and allows only one edge per step', () => {
    const g = graph();
    g.entryStateId = 'attack-state';
    g.transitions = [
      edge({
        id: 'exit',
        from: 'attack-state',
        to: 'idle-state',
        conditions: [],
        exitTime: 1,
        blendDuration: 0,
      }),
      edge({
        id: 'next',
        from: 'idle-state',
        to: 'walk-state',
        priority: 11,
        conditions: [],
        blendDuration: 0,
      }),
    ];
    const m = new LogicMachine(g, catalog);
    for (let n = 0; n < 30; n++) m.step();
    expect(m.snapshot().stateId).toBe('attack-state');
    expect(m.snapshot().stateElapsed).toBe(0.25);
    m.step();
    expect(m.snapshot().stateId).toBe('idle-state');
    expect(m.snapshot().stateElapsed).toBe(LOGIC_STEP_SECONDS);
    m.step();
    expect(m.snapshot().stateId).toBe('walk-state');
  });
  it('defers transitions for noninterruptible blends and accepts only strictly higher priority interruptions', () => {
    const g = graph();
    g.transitions[0]!.interruption = 'none';
    const locked = new LogicMachine(g, catalog);
    locked.setFloat('speed', 1);
    locked.step();
    locked.fire('attack');
    for (let n = 0; n < 11; n++) locked.step();
    expect(locked.snapshot().stateId).toBe('walk-state');
    expect(locked.snapshot().transition?.progress).toBe(1);
    expect(locked.getParameter('attack')).toBe(true);
    locked.step();
    expect(locked.snapshot().stateId).toBe('attack-state');
    expect(locked.snapshot().completedTransitionId).toBe('walk-edge');
    const flexible = new LogicMachine(graph(), catalog);
    flexible.setFloat('speed', 1);
    flexible.step();
    flexible.fire('attack');
    flexible.step();
    expect(flexible.snapshot().transition).toMatchObject({
      id: 'attack-edge',
      from: 'walk-state',
      to: 'attack-state',
      progress: 1 / 6,
    });
    flexible.fire('hit');
    flexible.step();
    expect(flexible.snapshot().stateId).toBe('hit-state');
    expect(flexible.snapshot().transition).toBeNull();
    const low = graph();
    low.transitions.push(
      edge({ id: 'lower', from: 'walk-state', to: 'hit-state', priority: 30, conditions: [] }),
    );
    const m = new LogicMachine(low, catalog);
    m.setFloat('speed', 1);
    m.step();
    m.step();
    expect(m.snapshot().stateId).toBe('walk-state');
  });
  it('holds setup/no-clip states, loops at exact tick boundaries and clamps nonlooping clip time', () => {
    const g = graph();
    g.transitions = [];
    g.states[0]!.clip = null;
    const setup = new LogicMachine(g, catalog);
    setup.step();
    expect(setup.snapshot().clipTime).toBe(0);
    const m = new LogicMachine({ ...g, states: graph().states }, catalog);
    for (let n = 0; n < 120; n++) m.step();
    expect(m.snapshot().clipTime).toBe(0);
    const attack = new LogicMachine({ ...g, states: graph().states, entryStateId: 'attack-state' }, catalog);
    for (let n = 0; n < 120; n++) attack.step();
    expect(attack.snapshot().clipTime).toBe(0.25);
    expect(attack.snapshot().stateElapsed).toBe(1);
    const tiny = new LogicMachine(
      {
        ...g,
        states: graph().states,
        entryStateId: 'attack-state',
        transitions: [edge({ from: 'attack-state', conditions: [], exitTime: 1, blendDuration: 0 })],
      },
      new Map([...catalog, ['attack', { duration: 1e-15 }]]),
    );
    tiny.step();
    expect(tiny.snapshot().stateId).toBe('attack-state');
    tiny.step();
    expect(tiny.snapshot().stateId).toBe('walk-state');
  });
  it('disablement freezes state/pending inputs, reset restores defaults, and snapshot/debug buffers cannot mutate the machine', () => {
    const m = new LogicMachine(graph(), catalog);
    m.setEnabled(false);
    m.fire('attack');
    m.step();
    expect(m.snapshot().tick).toBe(0);
    expect(m.getParameter('attack')).toBe(false);
    m.setEnabled(true);
    m.step();
    expect(m.snapshot().stateId).toBe('attack-state');
    const snapshot = m.snapshot();
    (snapshot.parameters as Record<string, unknown>).attack = true;
    snapshot.transition!.progress = 99;
    const changes = m.recentChanges();
    changes[0]!.name = 'tampered';
    expect(m.snapshot().parameters.attack).toBe(false);
    expect(m.snapshot().transition!.progress).toBeLessThan(1);
    expect(m.recentChanges()[0]!.name).not.toBe('tampered');
    for (let n = 0; n < 100; n++) {
      m.setInt('coins', n);
      m.step();
    }
    expect(m.recentChanges()).toHaveLength(64);
    m.reset();
    expect(m.snapshot()).toMatchObject({ tick: 0, stateId: 'idle-state', stateElapsed: 0, transition: null });
    expect(m.getParameter('coins')).toBe(0);
    expect(m.recentChanges()).toEqual([]);
  });
  it('replays an independent golden input trace identically under 10/60/120/144/240/1000Hz frame grouping', () => {
    const inputs: RecordedLogicInput[] = [
      { tick: 0, input: { name: 'speed', type: 'float', value: 1 } },
      { tick: 3, input: { name: 'attack', type: 'trigger', value: true } },
      { tick: 40, input: { name: 'speed', type: 'float', value: 0 } },
      { tick: 50, input: { name: 'hit', type: 'trigger', value: true } },
    ];
    validateRecordedLogicInputs(inputs);
    const replay = (fps: number) => {
      const m = new LogicMachine(graph(), catalog),
        clock = new FixedStepClock(),
        trace: unknown[] = [],
        edges: unknown[] = [];
      let at = 0,
        tick = 0;
      for (let frame = 0; frame < fps; frame++)
        for (let n = 0, steps = clock.consume(1 / fps); n < steps; n++) {
          while (inputs[at]?.tick === tick) m.applyInput(inputs[at++]!.input);
          m.step();
          const s = m.snapshot();
          trace.push(s);
          if (s.startedTransitionId) edges.push([tick, s.startedTransitionId, s.stateId]);
          tick++;
        }
      expect(edges).toEqual([
        [0, 'walk-edge', 'walk-state'],
        [3, 'attack-edge', 'attack-state'],
        [33, 'return', 'idle-state'],
        [34, 'walk-edge', 'walk-state'],
        [50, 'hit-edge', 'hit-state'],
      ]);
      expect(m.snapshot().tick).toBe(120);
      return { trace, changes: m.recentChanges() };
    };
    const expected = replay(120);
    for (const fps of [10, 60, 144, 240, 1000]) expect(replay(fps)).toEqual(expected);
    expect(() =>
      validateRecordedLogicInputs([
        { tick: 2, input: inputs[0]!.input },
        { tick: 1, input: inputs[0]!.input },
      ]),
    ).toThrow(/ordered/);
  });
  it('rejects malformed graphs and unconditional immediate cycles with actionable errors, without source mutation', () => {
    const mutations: ((g: LogicGraph) => void)[] = [
      (g) => {
        g.entryStateId = 'missing';
      },
      (g) => {
        g.states[0]!.clip = 'missing';
      },
      (g) => {
        g.parameters[0]!.initial = Infinity;
      },
      (g) => {
        g.transitions[0]!.priority = 1;
      },
      (g) => {
        g.transitions[0]!.to = 'missing';
      },
      (g) => {
        g.transitions[0]!.conditions[0]!.parameterId = 'missing';
      },
      (g) => {
        g.transitions[0]!.conditions = [{ parameterId: 'label', operator: 'gt', value: 'x' }];
      },
      (g) => {
        g.transitions[0]!.conditions = [{ parameterId: 'speed', operator: 'eq', value: '1' }];
      },
      (g) => {
        g.transitions[1]!.exitTime = 1;
      },
      (g) => {
        g.transitions[0]!.from = g.transitions[0]!.to;
      },
      (g) => {
        g.transitions[0]!.blendDuration = -1;
      },
      (g) => {
        g.parameters.push({ ...g.parameters[0]!, id: 'new' });
      },
      (g) => {
        g.states[1]!.name = g.states[0]!.name;
      },
      (g) => {
        g.transitions = [
          edge({ conditions: [], blendDuration: 0 }),
          edge({
            id: 'back',
            from: 'walk-state',
            to: 'idle-state',
            priority: 11,
            conditions: [],
            blendDuration: 0,
          }),
        ];
      },
      (g) => {
        g.transitions = [
          edge({ from: null, conditions: [] }),
          edge({ id: 'other-any', from: null, to: 'idle-state', priority: 11, conditions: [] }),
        ];
      },
    ];
    for (const mutate of mutations) {
      const g = graph();
      mutate(g);
      const before = structuredClone(g);
      expect(() => validateLogicGraph(g, catalog)).toThrow(LogicValidationError);
      expect(g).toEqual(before);
    }
    for (const bad of [
      null,
      [],
      {},
      { ...graph(), parameters: null },
      { ...graph(), states: [] },
      { ...graph(), transitions: Array(1025).fill(edge()) },
    ])
      expect(() => validateLogicGraph(bad, catalog)).toThrow(LogicValidationError);
    const guarded = graph();
    guarded.transitions = [
      edge({ conditions: [] }),
      edge({ id: 'back', from: 'walk-state', to: 'idle-state', priority: 11, exitTime: 1, conditions: [] }),
    ];
    expect(() => validateLogicGraph(guarded, catalog)).not.toThrow();
  });
});
