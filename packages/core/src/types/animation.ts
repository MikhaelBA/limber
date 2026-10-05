/**
 * Animation data model — typed timelines (DESIGN.md §3.3).
 *
 * Timelines are a discriminated union of typed timelines, NOT a generic
 * { targetId, property: string }: attachment keyframes hold a string,
 * draw-order keyframes hold a slot permutation, color keyframes hold packed
 * uint32 — none of these fit `value: number`.
 */

export type CurveType = 'linear' | 'stepped' | 'bezier';

export interface Curve {
  type: CurveType;
  /**
   * Bezier control points: (c1,c2) and (c3,c4) are (cx,cy) pairs.
   * Constraint: cx ∈ [0,1] so time never flows backwards.
   * cy is UNBOUNDED — values outside [0,1] produce overshoot (back/bounce eases).
   */
  c1?: number;
  c2?: number;
  c3?: number;
  c4?: number;
}

interface KeyframeBase {
  /** Seconds. */
  time: number;
  /** Curve from THIS keyframe to the next (Spine convention). Last frame's curve is unused. */
  curve: Curve;
}

export interface NumberKeyframe extends KeyframeBase {
  value: number;
}

export interface ColorKeyframe extends KeyframeBase {
  /** Packed RGBA uint32. */
  value: number;
}

export interface AttachmentKeyframe extends KeyframeBase {
  attachmentId: string | null;
}

export interface DrawOrderKeyframe extends KeyframeBase {
  /** Full permutation of slot indices. Stepped only — no interpolation. */
  slotOrder: number[];
}

export interface DeformKeyframe extends KeyframeBase {
  /** Per-vertex offsets from the setup mesh positions. null = setup pose. */
  offsets: number[] | null;
}

export interface EventKeyframe extends KeyframeBase {
  eventName: string;
  payload?: number | string;
}

// ---- Timeline union ----

export interface BonePropertyTimeline {
  kind: 'boneProperty';
  boneId: string;
  property: 'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY' | 'shearX' | 'shearY';
  /** Sorted by time. Interpolation via binary search. */
  keyframes: NumberKeyframe[];
}

export interface SlotColorTimeline {
  kind: 'slotColor';
  slotId: string;
  keyframes: ColorKeyframe[];
}

export interface SlotAttachmentTimeline {
  kind: 'slotAttachment';
  slotId: string;
  /** Stepped only — no interpolation between attachments. */
  keyframes: AttachmentKeyframe[];
}

export interface DrawOrderTimeline {
  kind: 'drawOrder';
  /** Stepped only. */
  keyframes: DrawOrderKeyframe[];
}

export interface DeformTimeline {
  kind: 'deform';
  attachmentId: string;
  keyframes: DeformKeyframe[];
}

export interface EventTimeline {
  kind: 'event';
  /** Stepped; fired when playback crosses the frame time. */
  keyframes: EventKeyframe[];
}

export type Timeline =
  | BonePropertyTimeline
  | SlotColorTimeline
  | SlotAttachmentTimeline
  | DrawOrderTimeline
  | DeformTimeline
  | EventTimeline;

export interface Animation {
  name: string;
  /** Derived (max keyframe time) but stored for O(1) access. */
  duration: number;
  loop: boolean;
  timelines: Timeline[];
}
