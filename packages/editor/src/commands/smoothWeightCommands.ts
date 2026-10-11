import { weightNeighbors, type SmoothWeightInput } from '@limber/mesh';
import { meshGeometryOwner, weightAttachment } from '@limber/core';
import { useWeightEditingStore } from '../store/weightEditingStore';
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
  const mesh = weightAttachment(engine.skeleton.data, attachmentId),
    path = engine.skeleton.data.paths?.find((item) => item.id === attachmentId),
    slot = path ? { boneId: path.boneId } : engine.skeleton.data.slots.find((item) => item.id === slotId);
  if (!slot || !mesh?.meshVertices || !mesh.weights || !mesh.boneBindings)
    throw new Error('Select a bound weighted mesh before smoothing.');
  return {
    weights: [...mesh.weights],
    triangles: [...(mesh.meshTriangles ?? [])],
    vertexCount: mesh.meshVertices!.length / 2,
    boneCount: engine.skeleton.data.bones.length,
    slotBoneIndex: engine.skeleton.boneIndexMap.get(slot.boneId)!,
    strength,
    iterations,
    maxInfluences,
    neighbors: weightNeighbors(
      mesh.meshVertices!.length / 2,
      mesh.meshHull ?? [],
      (path ? mesh : meshGeometryOwner(mesh, engine.skeleton.attachmentById)).weightEdges ?? [],
    ),
    selectedVertices: useWeightEditingStore.getState().vertices,
    lockedBones: (mesh.weightLocks ?? []).map((id) => engine.skeleton.boneIndexMap.get(id)!),
  };
}
