import { SECONDARY_STEP_SECONDS } from '@limber/core';
import { runtimeFail } from './model';

export const NATIVE_MAX_EVENTS_PER_TICK = 4096;
/** Bound loop seams plus the initial zero event before allocating a per-tick event batch. */
export function validateNativeEventWork(
  duration: number,
  count: number,
  loop: boolean,
  objectId: string | null,
): void {
  const cycles = loop && duration > 0 ? Math.ceil(SECONDARY_STEP_SECONDS / duration) + 1 : 1;
  if (cycles * count > NATIVE_MAX_EVENTS_PER_TICK)
    runtimeFail(
      'EVENT_WORK_LIMIT',
      'Event density exceeds the native budget of 4096 emitted keys per accepted tick.',
      objectId,
      'Lengthen the loop or reduce its event keys before exporting.',
    );
}
