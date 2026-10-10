import type { EventPayload, TypedEventPayload } from '../types/events';
import type { Animation } from '../types/animation';
/** Exact portable payload contract; no coercion, nesting, unknown fields or arbitrary objects. */
export function validateEventPayload(payload: unknown): asserts payload is EventPayload | undefined {
  if (payload === undefined) return;
  if (typeof payload === 'string') {
    if (payload.length > 4096) throw new Error('Event payload string supports at most 4096 characters.');
    return;
  }
  if (typeof payload === 'number') {
    if (!Number.isFinite(Math.fround(payload)))
      throw new Error('Event payload number must be finite in Float32 range.');
    return;
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    throw new Error('Event payload must be a scalar or a typed value.');
  const record = payload as Record<string, unknown>;
  if (Object.keys(record).length !== 2 || !Object.hasOwn(record, 'type') || !Object.hasOwn(record, 'value'))
    throw new Error('Typed event payload requires exactly type and value.');
  switch (record.type) {
    case 'bool':
      if (typeof record.value !== 'boolean') throw new Error('Event bool payload must be boolean.');
      break;
    case 'float':
      if (typeof record.value !== 'number' || !Number.isFinite(Math.fround(record.value)))
        throw new Error('Event float payload must be finite in Float32 range.');
      break;
    case 'int':
      if (
        !Number.isInteger(record.value) ||
        (record.value as number) < -2147483648 ||
        (record.value as number) > 2147483647
      )
        throw new Error('Event int payload must be a signed 32-bit integer.');
      break;
    case 'string':
      if (typeof record.value !== 'string' || record.value.length > 4096)
        throw new Error('Event string payload supports at most 4096 characters.');
      break;
    default:
      throw new Error('Unknown event payload type.');
  }
}
export function validateEventName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || !name.trim() || name.length > 128)
    throw new Error('Event name must have 1–128 characters.');
}
/** Isolated emitted data; floats canonicalize to binary32 without changing authored values. */
export function runtimeEventPayload(payload: EventPayload): EventPayload {
  return typeof payload === 'object'
    ? ({
        ...payload,
        value: payload.type === 'float' ? Math.fround(payload.value) : payload.value,
      } as TypedEventPayload)
    : payload;
}
export function formatEventPayload(payload: EventPayload | undefined): string {
  if (payload === undefined) return '';
  return typeof payload === 'object' ? `${payload.type}: ${String(payload.value)}` : String(payload);
}
/** Validate all clip event data, including unreferenced/disabled Logic clips, before source publication. */
export function validateAnimationEvents(animations: readonly Animation[]): void {
  if (!Array.isArray(animations)) throw new Error('Animations must be an array.');
  for (const animation of animations) {
    if (!animation || !Array.isArray(animation.timelines))
      throw new Error('Animation timelines must be an array.');
    let count = 0;
    for (const timeline of animation.timelines) {
      if (!timeline || typeof timeline !== 'object') throw new Error('Animation timeline must be an object.');
      if (timeline.kind !== 'event') continue;
      if (!Array.isArray(timeline.keyframes)) throw new Error('Event keyframes must be an array.');
      count += timeline.keyframes.length;
      if (count > 512) throw new Error('A clip supports at most 512 event keys.');
      if (!Number.isFinite(animation.duration) || animation.duration < 0)
        throw new Error('Event clip duration must be finite and nonnegative.');
      for (const key of timeline.keyframes) {
        if (!key || !Number.isFinite(key.time) || key.time < 0 || key.time > animation.duration)
          throw new Error('Event time must stay within its clip.');
        validateEventName(key.eventName);
        validateEventPayload(key.payload);
      }
    }
  }
}
