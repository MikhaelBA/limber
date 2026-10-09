import { createPose, solveFK } from '@limber/core';
import { validateWeights, type AutoWeightInput } from '@limber/mesh';
import type { EditorEngine } from '../engine/EditorEngine';
import type { Command } from '../history/history';

export function rigFingerprint(engine: EditorEngine): string {
  return JSON.stringify({ skeleton: engine.skeleton.data, animations: engine.document.animations });
}

export function prepareAutoWeights(
  engine: EditorEngine,
  attachmentId: string,
  slotId: string,
  maxInfluences: number,
): AutoWeightInput {
  if (engine.mode !== 'setup') throw new Error('Switch to Setup for auto weights.');
  const data = engine.skeleton.data,
    mesh = engine.skeleton.attachmentById.get(attachmentId);
  const slot = data.slots.find((item) => item.id === slotId);
  if (!slot || mesh?.type !== 'mesh' || !mesh.boneBindings?.length)
    throw new Error('Bind the mesh bones before computing auto weights.');
  if (!Number.isInteger(maxInfluences) || maxInfluences < 1)
    throw new Error('Auto weights need a positive integer influence limit.');
  const pose = createPose(data);
  solveFK(data, engine.skeleton.boneIndexMap, pose);
  const wm = pose.worldMatrices,
    o = engine.skeleton.boneIndexMap.get(slot.boneId)! * 6;
  const vertices: number[] = [];
  for (let k = 0; k < mesh.meshVertices!.length; k += 2) {
    const x = mesh.meshVertices![k]!,
      y = mesh.meshVertices![k + 1]!;
    vertices.push(wm[o]! * x + wm[o + 2]! * y + wm[o + 4]!, wm[o + 1]! * x + wm[o + 3]! * y + wm[o + 5]!);
  }
  const bones = mesh.boneBindings.map((binding) => {
    const boneIndex = engine.skeleton.boneIndexMap.get(binding.boneId)!,
      bone = data.bones[boneIndex]!,
      offset = boneIndex * 6;
    return {
      boneIndex,
      x0: wm[offset + 4]!,
      y0: wm[offset + 5]!,
      x1: wm[offset + 4]! + bone.length * wm[offset]!,
      y1: wm[offset + 5]! + bone.length * wm[offset + 1]!,
    };
  });
  return { vertices, bones, maxInfluences };
}

/** Weight-only publication validates new influences and keeps existing geometry/pose caches. */
export class ApplyAutoWeightsCommand implements Command {
  readonly label: string;
  private before: number[] | undefined;
  private ready = false;
  private weights: number[];
  constructor(
    private engine: EditorEngine,
    private attachmentId: string,
    weights: readonly number[],
    private fingerprint: string,
    private operation = 'Auto weights',
  ) {
    this.weights = [...weights];
    this.label = operation;
  }
  private mesh() {
    const mesh = this.engine.skeleton.attachmentById.get(this.attachmentId);
    if (mesh?.type !== 'mesh' || !mesh.boneBindings?.length) throw new Error('Bound mesh no longer exists.');
    return mesh;
  }
  private apply(weights: number[] | undefined) {
    const mesh = this.mesh(),
      skeleton = this.engine.skeleton;
    if (weights !== undefined) {
      const bound = new Set(mesh.boneBindings!.map((binding) => skeleton.boneIndexMap.get(binding.boneId)!));
      validateWeights(weights, mesh.meshVertices!.length / 2, skeleton.data.bones.length, bound);
    }
    // Unchanged topology, bindings, clips and bone order were already validated by authoring/load.
    // This command only changes weights; rebuilding the whole rig would unnecessarily block the UI.
    if (weights === undefined) delete mesh.weights;
    else mesh.weights = [...weights];
  }
  do(): void {
    if (this.ready) {
      this.apply(this.weights);
      return;
    }
    if (this.engine.mode !== 'setup' || rigFingerprint(this.engine) !== this.fingerprint)
      throw new Error(`${this.operation} discarded because the rig changed. Run it again.`);
    const before = this.mesh().weights?.slice();
    this.apply(this.weights);
    this.before = before;
    this.ready = true;
  }
  undo(): void {
    if (this.ready) this.apply(this.before);
  }
}
