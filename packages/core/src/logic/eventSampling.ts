import type { EventFrame } from '../types/events';
import { LOGIC_STEP_SECONDS } from './LogicMachine';
import { validateEventName, validateEventPayload, runtimeEventPayload } from '../animation/eventPayload';
export interface LogicClipEvent {
  time: number;
  eventName: string;
  payload?: EventFrame['payload'];
}
export interface LogicFiredEvent extends EventFrame {
  clipId: string;
  cycle: number;
}
function canonicalInteger(value: number): number {
  const nearest = Math.round(value);
  return Math.abs(value - nearest) <= 8 * Number.EPSILON * Math.max(1, Math.abs(value)) ? nearest : value;
}
/** Bake chronological ordering once. Equal-time keys retain authored timeline/key order. */
export class LogicEventSampler {
  private readonly entries: ReadonlyArray<LogicClipEvent & { sequence: number }>;
  constructor(
    readonly duration: number,
    events: readonly LogicClipEvent[],
  ) {
    if (!Number.isFinite(duration) || duration <= 0)
      throw new Error('Logic event clip duration must be positive and finite.');
    if (!Array.isArray(events) || events.length > 512)
      throw new Error('A Logic clip supports at most 512 event keys.');
    this.entries = events
      .map((event, sequence) => {
        if (!event || !Number.isFinite(event.time) || event.time < 0 || event.time > duration)
          throw new Error('Logic event time must stay within its clip.');
        validateEventName(event.eventName);
        const payload = event.payload;
        validateEventPayload(payload);
        return {
          ...event,
          payload: payload === undefined ? undefined : runtimeEventPayload(payload),
          sequence,
        };
      })
      .sort((a, b) => a.time - b.time || a.sequence - b.sequence);
  }
  validateLoop(loop: boolean): void {
    if (loop && this.entries.length && this.duration < LOGIC_STEP_SECONDS / 1000)
      throw new Error('Logic event loop is too short (maximum 1000 cycles per fixed step).');
  }
  collect(
    fromTick: number,
    toTick: number,
    loop: boolean,
    entered: boolean,
    clipId: string,
    animationName: string,
  ): LogicFiredEvent[] {
    if (
      !Number.isSafeInteger(fromTick) ||
      !Number.isSafeInteger(toTick) ||
      fromTick < 0 ||
      toTick < fromTick ||
      toTick - fromTick > 1
    )
      throw new Error('Collect Logic events over one forward integer fixed step.');
    if (toTick === fromTick || !this.entries.length) return [];
    const from = fromTick * LOGIC_STEP_SECONDS,
      to = toTick * LOGIC_STEP_SECONDS;
    this.validateLoop(loop);
    const first = loop ? Math.floor(canonicalInteger(from / this.duration)) : 0,
      last = loop ? Math.floor(canonicalInteger(to / this.duration)) : 0;
    if (last - first > 1000) throw new Error('Advance Logic events in bounded fixed steps.');
    const result: LogicFiredEvent[] = [];
    for (let cycle = first; cycle <= last; cycle++)
      for (const event of this.entries) {
        const at = cycle * this.duration + event.time;
        const tick = at === 0 ? 0 : Math.max(1, Math.ceil(canonicalInteger(at / LOGIC_STEP_SECONDS)));
        if ((tick > fromTick || (entered && at === 0)) && tick <= toTick)
          result.push({
            animationName,
            clipId,
            cycle,
            eventName: event.eventName,
            time: event.time,
            payload: event.payload === undefined ? undefined : runtimeEventPayload(event.payload),
          });
      }
    return result;
  }
}
