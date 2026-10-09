import type { SmoothWeightInput } from '@limber/mesh';
import type { EditorEngine } from '../engine/EditorEngine';

export function prepareSmoothWeights(
  engine: EditorEngine,
  attachmentId: string,
  slotId: string,
  strength: number,
  iterations: number,
  maxInfluences: number,
): SmoothWeightInput {
  if (engine.mode !== 'setup') throw new Error('Switch to Setup to smooth weights.');
  const mesh = engine.skeleton.attachmentById.get(attachmentId),
    slot = engine.skeleton.data.slots.find((item) => item.id === slotId);
  if (!slot || mesh?.type !== 'mesh' || !mesh.weights || !mesh.boneBindings)
    throw new Error('Select a bound weighted mesh before smoothing.');
  return {
    weights: [...mesh.weights],
    triangles: [...mesh.meshTriangles!],
    vertexCount: mesh.meshVertices!.length / 2,
    boneCount: engine.skeleton.data.bones.length,
    slotBoneIndex: engine.skeleton.boneIndexMap.get(slot.boneId)!,
    strength,
    iterations,
    maxInfluences,
  };
}
