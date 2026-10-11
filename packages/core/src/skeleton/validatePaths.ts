import type { SkeletonData } from '../types/data';
import { validateWeights, validateInvertibleAffine, decodeWeights } from '@limber/mesh';
/** Publication limits bound cache size and per-frame work; no source repair at evaluation. */
export function validatePaths(data: SkeletonData): void {
  if (data.paths !== undefined && !Array.isArray(data.paths)) throw new Error('Paths must be an array.');
  if ((data.paths?.length ?? 0) > 64) throw new Error('A rig supports at most 64 paths.');
  const ids = new Set<string>(),
    bones = new Set(data.bones.map((b) => b.id));
  for (const p of data.paths ?? []) {
    if (typeof p.id !== 'string' || !p.id.trim() || ids.has(p.id))
      throw new Error('Path IDs must be nonempty and unique.');
    ids.add(p.id);
    if (typeof p.name !== 'string' || !p.name.trim() || !bones.has(p.boneId) || typeof p.closed !== 'boolean')
      throw new Error(`Path "${p.id}" needs a name, existing owner bone and closed flag.`);
    if (!Array.isArray(p.segments) || p.segments.length < 1 || p.segments.length > 64)
      throw new Error(`Path "${p.id}" needs 1–64 cubic segments.`);
    for (let i = 0; i < p.segments.length; i++) {
      const s = p.segments[i]!;
      if (
        !Array.isArray(s) ||
        s.length !== 8 ||
        s.some((v) => typeof v !== 'number' || !Number.isFinite(Math.fround(v)))
      )
        throw new Error(`Path "${p.id}" has invalid cubic coordinates.`);
      const previous = p.segments[i - 1];
      if (previous && (previous[6] !== s[0] || previous[7] !== s[1]))
        throw new Error(`Path "${p.id}" cubic segments must meet exactly.`);
    }
    const first = p.segments[0]!,
      last = p.segments[p.segments.length - 1]!;
    if (p.closed && (first[0] !== last[6] || first[1] !== last[7]))
      throw new Error(`Closed path "${p.id}" must end at its start.`);
    const bound = new Set<string>();
    if (p.boneBindings !== undefined) {
      if (!Array.isArray(p.boneBindings) || !p.boneBindings.length)
        throw new Error('Path needs at least one bound bone.');
      for (const binding of p.boneBindings) {
        if (!bones.has(binding.boneId) || bound.has(binding.boneId))
          throw new Error('Path binding has a missing or duplicate bone.');
        validateInvertibleAffine(binding.matrix);
        if (binding.matrix.some((value) => !Number.isFinite(Math.fround(value))))
          throw new Error('Path binding exceeds finite Float32 range.');
        for (const segment of p.segments)
          for (let point = 0; point < 8; point += 2) {
            const x = segment[point]!,
              y = segment[point + 1]!,
              m = binding.matrix;
            if (
              ![m[0]! * x + m[2]! * y + m[4]!, m[1]! * x + m[3]! * y + m[5]!].every((value) =>
                Number.isFinite(Math.fround(value)),
              )
            )
              throw new Error('Bound path controls exceed finite Float32 range.');
          }
        bound.add(binding.boneId);
      }
    }
    const indices = new Map(data.bones.map((bone, i) => [bone.id, i]));
    if (p.weights && !p.boneBindings) throw new Error('Bind path bones before assigning weights.');
    validateWeights(
      p.weights,
      p.segments.length * 4,
      data.bones.length,
      p.boneBindings ? new Set([...bound].map((id) => indices.get(id)!)) : undefined,
    );
    if (
      p.weightLocks !== undefined &&
      (!Array.isArray(p.weightLocks) ||
        new Set(p.weightLocks).size !== p.weightLocks.length ||
        p.weightLocks.some((id) => !bound.has(id)))
    )
      throw new Error('Path weight locks require unique bound bones.');
    if (p.weights) {
      const rows = decodeWeights(p.weights, p.segments.length * 4, data.bones.length);
      for (let segment = 1; segment < p.segments.length + (p.closed ? 1 : 0); segment++) {
        const start = (segment % p.segments.length) * 4,
          end = (segment - 1) * 4 + 3;
        const canonical = (row: (typeof rows)[number]) => [...row].sort((a, b) => a.boneIndex - b.boneIndex);
        if (JSON.stringify(canonical(rows[start]!)) !== JSON.stringify(canonical(rows[end]!)))
          throw new Error('Joined path endpoints need identical weights.');
      }
    }
  }
}
