import { normalizeWeights, type PruneOptions } from '@limber/mesh';
import type { EditorEngine } from '../engine/EditorEngine';
import type { Command } from '../history/history';
import { applyRigSnapshot, captureRig, prepareRigEdit, type RigSnapshot } from './rigEdits';

export class NormalizeMeshWeightsCommand implements Command {
  readonly label: string;
  private before: RigSnapshot | null = null;
  private after: RigSnapshot | null = null;
  private options: PruneOptions;
  constructor(
    private engine: EditorEngine,
    private attachmentId: string,
    options: PruneOptions = {},
  ) {
    this.options = { ...options };
    this.label = options.maxInfluences === undefined ? 'Normalize Weights' : 'Prune Weights';
  }
  do(): void {
    if (this.after) {
      applyRigSnapshot(this.engine, this.after);
      return;
    }
    if (this.engine.mode !== 'setup') throw new Error('Switch to Setup to normalize or prune weights.');
    const before = captureRig(this.engine);
    const after = prepareRigEdit(this.engine, (data) => {
      const mesh = data.attachments.find((item) => item.id === this.attachmentId);
      if (!mesh || mesh.type !== 'mesh' || !mesh.meshVertices || !mesh.weights)
        throw new Error('Select a weighted mesh first.');
      mesh.weights = normalizeWeights(
        mesh.weights,
        mesh.meshVertices.length / 2,
        data.bones.length,
        this.options,
      );
    });
    applyRigSnapshot(this.engine, after);
    this.before = before;
    this.after = after;
  }
  undo(): void {
    if (this.before) applyRigSnapshot(this.engine, this.before);
  }
}
