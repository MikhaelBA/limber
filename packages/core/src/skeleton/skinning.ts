import type { AttachmentData } from '../types/data';
import type { AttachmentPoseState } from '../types/pose';
import type { Skeleton } from './Skeleton';

/** Optional exact work counters; callers own/reuse the record. */
export interface SkinningStats {
  attachments: number;
  vertices: number;
  rigidVertices: number;
  weightedVertices: number;
  vertexTransforms: number;
  bindMatrixProducts: number;
}
export function createSkinningStats(): SkinningStats {
  return {
    attachments: 0,
    vertices: 0,
    rigidVertices: 0,
    weightedVertices: 0,
    vertexTransforms: 0,
    bindMatrixProducts: 0,
  };
}

/**
 * Weighted skinning (Phase 5, DESIGN.md §4.3 step 5 — runs AFTER FK/IK).
 *
 * Writes world-space vertices for one attachment into its preallocated pose
 * state. Two paths:
 * - RIGID (no `weights`, the common case): each vertex transforms by the
 *   slot's bone world matrix. This is what regions got before Phase 5 — now
 *   the renderer reads the cache instead of transforming setup vertices.
 * - WEIGHTED: world = Σ wᵢ · Mᵢ · Bᵢ · (v + deform), where Bᵢ is the
 *   stored attachment-local -> bone-local bind transform (identity if absent).
 *   In 2D we only need positions for rendering, so blending transformed
 *   POINTS is exact — no matrix blending artifacts.
 *
 * Allocation-free. `local` and `deform` are parallel flat [x0,y0,x1,y1,…].
 */
export function computeAttachmentVertices(
  attachment: AttachmentData,
  slotBoneIndex: number,
  wm: Float32Array,
  state: AttachmentPoseState,
  stats?: SkinningStats,
): void {
  // Regions carry their quad in `vertices`; meshes, bounding boxes and
  // clipping polygons all live in `meshVertices`.
  const local = attachment.type === 'region' ? attachment.vertices : attachment.meshVertices;
  if (!local) return;
  const { verts, deform } = state;
  const w = attachment.weights;
  const bm = state.bindMatrices,
    sm = state.skinMatrices;
  if (attachment.boneBindings && (!bm || !sm))
    throw new Error('Bound mesh pose must be allocated from its skeleton.');
  if (stats) {
    stats.attachments++;
    stats.vertices += verts.length / 2;
  }
  if (bm && sm) {
    if (stats) stats.bindMatrixProducts += wm.length / 6;
    for (let o = 0; o < wm.length; o += 6) {
      sm[o] = wm[o]! * bm[o]! + wm[o + 2]! * bm[o + 1]!;
      sm[o + 1] = wm[o + 1]! * bm[o]! + wm[o + 3]! * bm[o + 1]!;
      sm[o + 2] = wm[o]! * bm[o + 2]! + wm[o + 2]! * bm[o + 3]!;
      sm[o + 3] = wm[o + 1]! * bm[o + 2]! + wm[o + 3]! * bm[o + 3]!;
      sm[o + 4] = wm[o]! * bm[o + 4]! + wm[o + 2]! * bm[o + 5]! + wm[o + 4]!;
      sm[o + 5] = wm[o + 1]! * bm[o + 4]! + wm[o + 3]! * bm[o + 5]! + wm[o + 5]!;
    }
  }
  const weightedMatrices = sm ?? wm;

  if (!w) {
    if (stats) {
      stats.rigidVertices += verts.length / 2;
      stats.vertexTransforms += verts.length / 2;
    }
    const o = slotBoneIndex * 6;
    const a = wm[o]!;
    const b = wm[o + 1]!;
    const c = wm[o + 2]!;
    const d = wm[o + 3]!;
    const tx = wm[o + 4]!;
    const ty = wm[o + 5]!;
    for (let k = 0; k < verts.length; k += 2) {
      const x = local[k]! + deform[k]!;
      const y = local[k + 1]! + deform[k + 1]!;
      verts[k] = a * x + c * y + tx;
      verts[k + 1] = b * x + d * y + ty;
    }
    return;
  }

  let p = 0;
  const so = slotBoneIndex * 6;
  for (let k = 0; k < verts.length; k += 2) {
    const x = local[k]! + deform[k]!;
    const y = local[k + 1]! + deform[k + 1]!;
    const count = w[p++]! | 0;
    if (count === 0) {
      if (stats) {
        stats.rigidVertices++;
        stats.vertexTransforms++;
      }
      // "No influences" entry — rigid-bound to the slot's CURRENT bone (the
      // weight-paint baseline). Falls back per-vertex, not per-attachment.
      verts[k] = wm[so]! * x + wm[so + 2]! * y + wm[so + 4]!;
      verts[k + 1] = wm[so + 1]! * x + wm[so + 3]! * y + wm[so + 5]!;
      continue;
    }
    if (stats) {
      stats.weightedVertices++;
      stats.vertexTransforms += count;
    }
    let wx = 0;
    let wy = 0;
    for (let e = 0; e < count; e++) {
      const bi = (w[p++]! | 0) * 6;
      const weight = w[p++]!;
      const a = weightedMatrices[bi]!;
      const b = weightedMatrices[bi + 1]!;
      const c = weightedMatrices[bi + 2]!;
      const d = weightedMatrices[bi + 3]!;
      wx += weight * (a * x + c * y + weightedMatrices[bi + 4]!);
      wy += weight * (b * x + d * y + weightedMatrices[bi + 5]!);
    }
    verts[k] = wx;
    verts[k + 1] = wy;
  }
}

/** Invert the selected vertex's blended affine transform for cursor/deform editing.
 * Call after skinning has evaluated the pose. Singular blends are valid animation
 * output but cannot be inverted for editing, so they fail explicitly.
 */
export function worldToAttachmentVertex(
  attachment: AttachmentData,
  slotBoneIndex: number,
  wm: Float32Array,
  state: AttachmentPoseState,
  vertexIndex: number,
  wx: number,
  wy: number,
  out: { x: number; y: number },
): void {
  if (
    !Number.isInteger(vertexIndex) ||
    vertexIndex < 0 ||
    vertexIndex * 2 + 1 >= state.verts.length ||
    !Number.isFinite(wx) ||
    !Number.isFinite(wy)
  )
    throw new Error('Invalid mesh editing point.');
  const weights = attachment.weights,
    matrices = state.skinMatrices ?? wm;
  let p = 0;
  if (weights) for (let i = 0; i < vertexIndex; i++) p += 1 + weights[p]! * 2;
  const count = weights?.[p++] ?? 0;
  let a = 0,
    b = 0,
    c = 0,
    d = 0,
    tx = 0,
    ty = 0;
  if (!count) {
    const o = slotBoneIndex * 6;
    a = wm[o]!;
    b = wm[o + 1]!;
    c = wm[o + 2]!;
    d = wm[o + 3]!;
    tx = wm[o + 4]!;
    ty = wm[o + 5]!;
  } else
    for (let i = 0; i < count; i++) {
      const o = weights![p++]! * 6,
        weight = weights![p++]!;
      a += matrices[o]! * weight;
      b += matrices[o + 1]! * weight;
      c += matrices[o + 2]! * weight;
      d += matrices[o + 3]! * weight;
      tx += matrices[o + 4]! * weight;
      ty += matrices[o + 5]! * weight;
    }
  const det = a * d - b * c,
    scale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d));
  if (!scale || !Number.isFinite(det) || Math.abs(det) <= scale * scale * 1e-12)
    throw new Error('Cannot edit through a singular weighted transform.');
  const dx = wx - tx,
    dy = wy - ty;
  const x = (d * dx - c * dy) / det,
    y = (a * dy - b * dx) / det;
  if (!Number.isFinite(x) || !Number.isFinite(y))
    throw new Error('Mesh editing position exceeds numeric precision.');
  out.x = x;
  out.y = y;
}

/**
 * Pipeline step 5 driver: skins every slot's ACTIVE attachment into the pose
 * cache. Inactive attachments are skipped (they are not rendered).
 */
export function updateSkinning(skeleton: Skeleton, stats?: SkinningStats): void {
  if (stats) {
    stats.attachments = 0;
    stats.vertices = 0;
    stats.rigidVertices = 0;
    stats.weightedVertices = 0;
    stats.vertexTransforms = 0;
    stats.bindMatrixProducts = 0;
  }
  const { data, pose } = skeleton;
  const wm = pose.worldMatrices;
  for (let i = 0; i < data.slots.length; i++) {
    const attId = pose.slots[i]!.attachmentId;
    if (!attId) continue;
    const attachment = skeleton.attachmentById.get(attId);
    const state = pose.attachments.get(attId);
    if (!attachment || !state) continue;
    computeAttachmentVertices(
      attachment,
      skeleton.boneIndexMap.get(data.slots[i]!.boneId)!,
      wm,
      state,
      stats,
    );
  }
}
