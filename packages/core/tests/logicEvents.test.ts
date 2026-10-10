import { describe, expect, it } from 'vitest';
import { LogicEventSampler, LOGIC_STEP_SECONDS as step } from '../src/index';
describe('Logic chronological event sampling', () => {
  it('emits entry once, sorts crossed keys chronologically and retains authored ties', () => {
    const source = [
      { time: step, eventName: 'late-a', payload: 4 },
      { time: step / 2, eventName: 'early' },
      { time: step, eventName: 'late-b', payload: 'سلام' },
      { time: 0, eventName: 'entry' },
    ];
    const sampler = new LogicEventSampler(1, source);
    source[0]!.eventName = 'changed';
    const result = sampler.collect(0, 1, false, true, 'id', 'name');
    expect(result.map((e) => e.eventName)).toEqual(['entry', 'early', 'late-a', 'late-b']);
    expect(result.map((e) => [e.clipId, e.animationName, e.cycle])).toEqual(
      Array.from({ length: 4 }, () => ['id', 'name', 0]),
    );
    expect(result[2]!.payload).toBe(4);
    expect(result[3]!.payload).toBe('سلام');
    expect(sampler.collect(1, 2, false, false, 'id', 'name')).toEqual([]);
    expect(sampler.collect(0, 0, false, true, 'id', 'name')).toEqual([]);
    expect(sampler.collect(0, 1, false, false, 'id', 'name').map((e) => e.eventName)).toEqual([
      'early',
      'late-a',
      'late-b',
    ]);
  });
  it('delivers old-cycle end before new-cycle zero, including the .3/.1 binary seam', () => {
    const sampler = new LogicEventSampler(0.1, [
      { time: 0, eventName: 'start' },
      { time: 0.1, eventName: 'end' },
    ]);
    const events = [];
    for (let tick = 0; tick < 37; tick++)
      events.push(...sampler.collect(tick, tick + 1, true, tick === 0, 'clip', 'clip'));
    expect(events.map((e) => [e.eventName, e.cycle])).toEqual([
      ['start', 0],
      ['end', 0],
      ['start', 1],
      ['end', 1],
      ['start', 2],
      ['end', 2],
      ['start', 3],
    ]);
  });
  it('covers multiple short loops per step and preserves tiny positive entry keys', () => {
    const sampler = new LogicEventSampler(step / 2, [
      { time: 0, eventName: 'zero' },
      { time: step / 2, eventName: 'end' },
    ]);
    expect(sampler.collect(0, 1, true, true, 'c', 'c').map((e) => [e.eventName, e.cycle])).toEqual([
      ['zero', 0],
      ['end', 0],
      ['zero', 1],
      ['end', 1],
      ['zero', 2],
    ]);
    const tiny = new LogicEventSampler(1, [{ time: Number.MIN_VALUE, eventName: 'tiny' }]);
    expect(tiny.collect(0, 1, false, false, 'c', 'c').map((e) => e.eventName)).toEqual(['tiny']);
    expect(tiny.collect(1, 2, false, false, 'c', 'c')).toEqual([]);
    const edge = new LogicEventSampler(step / 1000, [{ time: 0, eventName: 'zero' }]);
    expect(edge.collect(0, 1, true, true, 'c', 'c')).toHaveLength(1001);
  });
  it('rejects invalid source and unbounded/corrupt event intervals before collecting', () => {
    for (const duration of [0, -1, NaN, Infinity])
      expect(() => new LogicEventSampler(duration, [])).toThrow(/duration/);
    for (const time of [-1, NaN, Infinity, 2])
      expect(() => new LogicEventSampler(1, [{ time, eventName: 'event' }])).toThrow(/time/);
    for (const eventName of ['', '  ', 'x'.repeat(129)])
      expect(() => new LogicEventSampler(1, [{ time: 0, eventName }])).toThrow(/name/);
    for (const payload of [NaN, Infinity, 1e40, 'x'.repeat(4097), false, null, {}])
      expect(() => new LogicEventSampler(1, [{ time: 0, eventName: 'e', payload } as never])).toThrow(
        /payload/,
      );
    expect(
      () =>
        new LogicEventSampler(
          1,
          Array.from({ length: 513 }, () => ({ time: 0, eventName: 'e' })),
        ),
    ).toThrow(/512/);
    const sampler = new LogicEventSampler(1, []);
    for (const [from, to] of [
      [-1, 0],
      [0, 2],
      [1, 0],
      [0.5, 1],
      [0, Infinity],
    ])
      expect(() => sampler.collect(from!, to!, false, false, '', '')).toThrow(/integer/);
    const short = new LogicEventSampler(step / 1001, [{ time: 0, eventName: 'e' }]);
    expect(() => short.validateLoop(true)).toThrow(/short/);
    expect(short.collect(0, 1, false, true, 'c', 'c')).toHaveLength(1);
    new LogicEventSampler(Number.MIN_VALUE, []).validateLoop(true);
  });
});
