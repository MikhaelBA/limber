/**
 * Runtime event frames emitted by EventTimelines (DESIGN.md §4.3 step 6).
 */
export interface EventFrame {
  animationName: string;
  eventName: string;
  payload?: number | string;
  /** Document time at which the event fired. */
  time: number;
}
