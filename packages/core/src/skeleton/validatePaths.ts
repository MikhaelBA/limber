import type { SkeletonData } from '../types/data';
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
  }
}
