import type { AttachmentData } from '../types/data';
import type { AttachmentPoseState } from '../types/pose';
import type { Skeleton } from './Skeleton';

/**
 * Weighted skinning (Phase 5, DESIGN.md §4.3 step 5 — runs AFTER FK/IK).
 *
 * Writes world-space vertices for one attachment into its preallocated pose
 * state. Two paths:
 * - RIGID (no `weights`, the common case): each vertex transforms by the
 *   slot's bone world matrix. This is what regions got before Phase 5 — now
 *   the renderer reads the cache instead of transforming setup vertices.
 * - WEIGHTED (linear blend skinning): world = Σ wᵢ · Mᵢ · (v + deform).
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
): void {
  const local = attachment.type === 'mesh' ? attachment.meshVertices : attachment.vertices;
  if (!local) return;
  const { verts, deform } = state;
  const w = attachment.weights;

  if (!w) {
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
  for (let k = 0; k < verts.length; k += 2) {
    const x = local[k]! + deform[k]!;
    const y = local[k + 1]! + deform[k + 1]!;
    const count = w[p++]! | 0;
    let wx = 0;
    let wy = 0;
    for (let e = 0; e < count; e++) {
      const bi = (w[p++]! | 0) * 6;
      const weight = w[p++]!;
      const a = wm[bi]!;
      const b = wm[bi + 1]!;
      const c = wm[bi + 2]!;
      const d = wm[bi + 3]!;
      wx += weight * (a * x + c * y + wm[bi + 4]!);
      wy += weight * (b * x + d * y + wm[bi + 5]!);
    }
    verts[k] = wx;
    verts[k + 1] = wy;
  }
}

/**
 * Pipeline step 5 driver: skins every slot's ACTIVE attachment into the pose
 * cache. Inactive attachments are skipped (they are not rendered).
 */
export function updateSkinning(skeleton: Skeleton): void {
  const { data, pose } = skeleton;
  const wm = pose.worldMatrices;
  for (let i = 0; i < data.slots.length; i++) {
    const attId = pose.slots[i]!.attachmentId;
    if (!attId) continue;
    const attachment = skeleton.attachmentById.get(attId);
    const state = pose.attachments.get(attId);
    if (!attachment || !state) continue;
    computeAttachmentVertices(attachment, skeleton.boneIndexMap.get(data.slots[i]!.boneId)!, wm, state);
  }
}
