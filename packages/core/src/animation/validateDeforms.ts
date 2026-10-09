import type { Animation, Curve } from '../types/animation';
import type { SkeletonData } from '../types/data';

const finiteFloat = (value: number): boolean => Number.isFinite(value) && Number.isFinite(Math.fround(value));

/** Validate authoring data once, before a document or structural edit is published. */
export function validateDeformTimelines(data: SkeletonData, animations: readonly Animation[]): void {
  const attachments = new Map(data.attachments.map((attachment) => [attachment.id, attachment]));
  for (const animation of animations) {
    if (!animation || !Array.isArray(animation.timelines))
      throw new Error('Animation timelines must be an array.');
    const targets = new Set<string>();
    for (const timeline of animation.timelines) {
      if (timeline?.kind !== 'deform') continue;
      const fail = (reason: string): never => {
        throw new Error(`Invalid Deform in "${animation.name}": ${reason}`);
      };
      const attachment = attachments.get(timeline.attachmentId);
      const local = attachment?.type === 'region' ? attachment.vertices : attachment?.meshVertices;
      if (!local?.length) fail('attachment has no vertex geometry.');
      if (targets.has(timeline.attachmentId)) fail('duplicate attachment track.');
      targets.add(timeline.attachmentId);
      if (!Array.isArray(timeline.keyframes)) fail('keyframes must be an array.');
      let previous = -Infinity;
      for (const key of timeline.keyframes) {
        if (!key || !Number.isFinite(key.time) || key.time < 0 || key.time <= previous)
          fail('key times must be finite, nonnegative and strictly increasing.');
        previous = key.time;
        if (
          key.offsets !== null &&
          (!Array.isArray(key.offsets) ||
            key.offsets.length !== local!.length ||
            Array.from(key.offsets).some((value) => !finiteFloat(value)))
        )
          fail('offsets must be null or one finite float per vertex coordinate.');
        const curve: Curve = key.curve;
        if (!curve || !['linear', 'stepped', 'bezier'].includes(curve.type))
          fail('unknown interpolation curve.');
        for (const name of ['c1', 'c2', 'c3', 'c4'] as const) {
          if (curve[name] !== undefined && !Number.isFinite(curve[name]))
            fail('curve controls must be finite.');
        }
        if (
          curve.type === 'bezier' &&
          [curve.c1 ?? 1 / 3, curve.c3 ?? 2 / 3].some((value) => value < 0 || value > 1)
        )
          fail('Bezier time controls must be between zero and one.');
      }
      // Cubic interpolation lies inside the convex hull of its Y controls.
      // Bound each segment before it can overflow the Float32 pose cache.
      for (let i = 0; i < timeline.keyframes.length; i++) {
        const a = timeline.keyframes[i]!,
          b = timeline.keyframes[i + 1] ?? a;
        const limits =
          a.curve.type === 'stepped' || a === b
            ? [0]
            : a.curve.type === 'bezier'
              ? [
                  Math.min(0, a.curve.c2 ?? 1 / 3, a.curve.c4 ?? 1),
                  Math.max(1, a.curve.c2 ?? 1 / 3, a.curve.c4 ?? 1),
                ]
              : [0, 1];
        for (let k = 0; k < local!.length; k++) {
          const from = a.offsets?.[k] ?? 0,
            to = b.offsets?.[k] ?? 0;
          for (const t of limits) {
            const offset = from + (to - from) * t;
            if (!finiteFloat(offset) || !finiteFloat(local![k]! + offset))
              fail('deformation exceeds finite pose precision.');
          }
        }
        if (Array.isArray(attachment?.boneBindings)) {
          for (const binding of attachment.boneBindings) {
            // Malformed binding shape is rejected by Skeleton validation.
            if (!Array.isArray(binding?.matrix) || binding.matrix.length !== 6) continue;
            const m = binding.matrix;
            for (let k = 0; k < local!.length; k += 2) {
              for (const t of limits) {
                const ax = a.offsets?.[k] ?? 0,
                  ay = a.offsets?.[k + 1] ?? 0;
                const x = local![k]! + ax + ((b.offsets?.[k] ?? 0) - ax) * t;
                const y = local![k + 1]! + ay + ((b.offsets?.[k + 1] ?? 0) - ay) * t;
                if (
                  !finiteFloat(m[0]! * x + m[2]! * y + m[4]!) ||
                  !finiteFloat(m[1]! * x + m[3]! * y + m[5]!)
                )
                  fail('bound deformation exceeds finite pose precision.');
              }
            }
          }
        }
      }
    }
  }
}
