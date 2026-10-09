import { encodeWeights, normalizeInfluences, type Influence } from './weights';

export interface BoneSegment {
  boneIndex: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export interface AutoWeightInput {
  /** Flat setup-world coordinate pairs. */
  vertices: readonly number[];
  bones: readonly BoneSegment[];
  maxInfluences: number;
}

/** Deterministic nearest-segment inverse-square heuristic, not an anatomical solver. */
export function autoWeights(input: AutoWeightInput, progress?: (fraction: number) => void): number[] {
  const { vertices, bones, maxInfluences } = input;
  if (
    !Array.isArray(vertices) ||
    !vertices.length ||
    vertices.length % 2 ||
    Array.from(vertices).some((value) => !Number.isFinite(value))
  )
    throw new Error('Auto weights need finite setup-world vertices.');
  if (!Number.isInteger(maxInfluences) || maxInfluences < 1)
    throw new Error('Auto weights need a positive integer influence limit.');
  if (
    !Array.isArray(bones) ||
    !bones.length ||
    new Set(bones.map((bone) => bone.boneIndex)).size !== bones.length ||
    bones.some(
      (bone) =>
        !Number.isInteger(bone.boneIndex) ||
        bone.boneIndex < 0 ||
        ![bone.x0, bone.y0, bone.x1, bone.y1].every(Number.isFinite),
    )
  )
    throw new Error('Auto weights need unique valid bone segments.');
  const rows: Influence[][] = [];
  progress?.(0);
  for (let k = 0; k < vertices.length; k += 2) {
    const x = vertices[k]!,
      y = vertices[k + 1]!;
    const ranked = bones
      .map((bone) => {
        const dx = bone.x1 - bone.x0,
          dy = bone.y1 - bone.y0,
          length2 = dx * dx + dy * dy;
        if (!Number.isFinite(length2)) throw new Error('Bone segment exceeds numeric precision.');
        const t =
          length2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - bone.x0) * dx + (y - bone.y0) * dy) / length2));
        const distance = Math.hypot(x - bone.x0 - t * dx, y - bone.y0 - t * dy);
        if (!Number.isFinite(distance)) throw new Error('Auto-weight distance exceeds numeric precision.');
        return { boneIndex: bone.boneIndex, distance };
      })
      .sort((a, b) => a.distance - b.distance || a.boneIndex - b.boneIndex)
      .slice(0, maxInfluences);
    const nearest = ranked[0]!.distance;
    const influences = ranked
      .filter((entry) => nearest !== 0 || entry.distance === 0)
      .map((entry) => ({
        boneIndex: entry.boneIndex,
        weight: nearest === 0 ? 1 : (nearest / entry.distance) ** 2,
      }));
    rows.push(normalizeInfluences(influences));
    if ((k / 2 + 1) % 128 === 0) progress?.((k + 2) / vertices.length);
  }
  progress?.(1);
  return encodeWeights(rows);
}
