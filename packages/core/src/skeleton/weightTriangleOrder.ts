import { decodeWeights, orderWeightedTriangles } from '@limber/mesh';
import type { AttachmentData } from '../types/data';
import type { Skeleton } from './Skeleton';

const cache = new WeakMap<
  AttachmentData,
  {
    weights: number[];
    bindings: AttachmentData['boneBindings'];
    triangles: number[];
    indices: number[];
    boneMap: Map<string, number>;
  }
>();
/** Weight changes only replace indices; pose and geometry buffers remain reusable. */
export function attachmentTriangleOrder(attachment: AttachmentData, skeleton: Skeleton): number[] {
  const triangles = attachment.meshTriangles ?? [];
  if (!attachment.weights || !attachment.boneBindings) return triangles;
  const existing = cache.get(attachment);
  if (
    existing?.weights === attachment.weights &&
    existing.bindings === attachment.boneBindings &&
    existing.triangles === triangles &&
    existing.boneMap === skeleton.boneIndexMap
  )
    return existing.indices;
  const rows = decodeWeights(
    attachment.weights,
    attachment.meshVertices!.length / 2,
    skeleton.data.bones.length,
  );
  const indices = orderWeightedTriangles(
    triangles,
    rows,
    attachment.boneBindings.map((b) => skeleton.boneIndexMap.get(b.boneId)!),
  );
  cache.set(attachment, {
    weights: attachment.weights,
    bindings: attachment.boneBindings,
    triangles,
    indices,
    boneMap: skeleton.boneIndexMap,
  });
  return indices;
}
