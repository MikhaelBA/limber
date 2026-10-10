export type TypedEventPayload =
  | { type: 'bool'; value: boolean }
  | { type: 'float'; value: number }
  | { type: 'int'; value: number }
  | { type: 'string'; value: string };
/** Scalar payloads remain valid; new authoring uses explicit portable value types. */
export type EventPayload = number | string | TypedEventPayload;
/**
 * Runtime event frames emitted by EventTimelines (DESIGN.md §4.3 step 6).
 */
export interface EventFrame {
  animationName: string;
  eventName: string;
  payload?: EventPayload;
  /** Document time at which the event fired. */
  time: number;
}
