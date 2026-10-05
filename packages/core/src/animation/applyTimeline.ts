import type { Skeleton } from '../skeleton/Skeleton';
import type { EventFrame } from '../types/events';
import type { Timeline } from '../types/animation';
import { findKeyframeIndex, interpolateNumber, lerpColor } from './keyframes';

/**
 * Applies one timeline at track-time with blending weight `alpha`
 * (DESIGN.md §4.3 step 2 / §4.4). The pose was reset to setup beforehand, so
 * `alpha = 1` writes the animated value directly and smaller weights blend
 * toward it — applying an outgoing track first and the incoming track second
 * composes a correct crossfade.
 *
 * Allocation-free. `outEvents` collects fired event keyframes.
 */
export function applyTimeline(
  timeline: Timeline,
  skeleton: Skeleton,
  time: number,
  prevTime: number,
  alpha: number,
  outEvents: EventFrame[] | null,
  animationName: string,
): void {
  switch (timeline.kind) {
    case 'boneProperty': {
      const kfs = timeline.keyframes;
      if (kfs.length === 0 || time < kfs[0]!.time) return; // Before the first key: keep setup.
      const boneIndex = skeleton.boneIndexMap.get(timeline.boneId);
      if (boneIndex === undefined) return;
      const i0 = findKeyframeIndex(kfs, time);
      const target = interpolateNumber(kfs[i0]!, kfs[i0 + 1] ?? null, time);
      const local = skeleton.pose.bones[boneIndex]!.local;
      const current = local[timeline.property];
      local[timeline.property] = current + (target - current) * alpha;
      return;
    }

    case 'slotColor': {
      const kfs = timeline.keyframes;
      if (kfs.length === 0 || time < kfs[0]!.time) return;
      const slotIndex = skeleton.slotIndexMap.get(timeline.slotId);
      if (slotIndex === undefined) return;
      const i0 = findKeyframeIndex(kfs, time);
      const kf0 = kfs[i0]!;
      const kf1 = kfs[i0 + 1] ?? null;
      const slotPose = skeleton.pose.slots[slotIndex]!;
      const target = !kf1
        ? kf0.value
        : kf0.curve.type === 'stepped'
          ? kf0.value
          : lerpColor(kf0.value, kf1.value, (time - kf0.time) / (kf1.time - kf0.time));
      slotPose.color = alpha >= 1 ? target : lerpColor(slotPose.color, target, alpha);
      return;
    }

    case 'slotAttachment': {
      const kfs = timeline.keyframes;
      if (kfs.length === 0 || time < kfs[0]!.time) return;
      const slotIndex = skeleton.slotIndexMap.get(timeline.slotId);
      if (slotIndex === undefined) return;
      const i0 = findKeyframeIndex(kfs, time);
      skeleton.pose.slots[slotIndex]!.attachmentId = kfs[i0]!.attachmentId;
      return;
    }

    case 'drawOrder': {
      const kfs = timeline.keyframes;
      if (kfs.length === 0 || time < kfs[0]!.time) return;
      const i0 = findKeyframeIndex(kfs, time);
      const order = kfs[i0]!.slotOrder;
      const poseOrder = skeleton.pose.slotOrder;
      if (order.length === poseOrder.length) {
        for (let i = 0; i < order.length; i++) poseOrder[i] = order[i]!;
      }
      return;
    }

    case 'event': {
      if (!outEvents) return;
      for (const kf of timeline.keyframes) {
        // Normal: prevTime < kf.time <= time. Loop wrap (time < prevTime):
        // everything after prevTime up to duration, then 0..time.
        const crossed =
          prevTime <= time
            ? kf.time > prevTime && kf.time <= time
            : kf.time > prevTime || kf.time <= time;
        if (crossed) {
          outEvents.push({
            animationName,
            eventName: kf.eventName,
            payload: kf.payload,
            time: kf.time,
          });
        }
      }
      return;
    }

    case 'deform': {
      const state = skeleton.pose.attachments.get(timeline.attachmentId);
      if (!state) return;
      const kfs = timeline.keyframes;
      if (kfs.length === 0 || time < kfs[0]!.time) return;
      const i0 = findKeyframeIndex(kfs, time);
      const kf0 = kfs[i0]!;
      const kf1 = kfs[i0 + 1] ?? null;
      // null offsets = "setup mesh" — treated as all zeros so interpolation
      // between a null key and an offset key pulls vertices back to setup.
      const o0 = kf0.offsets;
      const o1 = kf1 ? kf1.offsets : o0;
      const t =
        !kf1 || kf1.time <= kf0.time || kf0.curve.type === 'stepped'
          ? 0
          : (time - kf0.time) / (kf1.time - kf0.time);
      const out = state.deform;
      for (let k = 0; k < out.length; k++) {
        const a = o0 ? (o0[k] ?? 0) : 0;
        const b = o1 ? (o1[k] ?? 0) : 0;
        const target = a + (b - a) * t;
        out[k] = out[k]! + (target - out[k]!) * alpha; // Blend toward the track (crossfade-safe).
      }
      state.deformed = true;
      return;
    }
  }
}
