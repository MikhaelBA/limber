import { uuid } from '@limber/core';
import type { AutoMeshInput, AutoMeshGeometry } from '@limber/mesh';
import type { EditorEngine } from '../engine/EditorEngine';
import type { Command } from '../history/history';
import type { AttachmentTarget } from './attachmentCommands';
import { rigFingerprint } from './autoWeightCommands';
import { insertMesh } from './meshCommands';
import { applyRigSnapshot, captureRig, prepareRigEdit, type RigSnapshot } from './rigEdits';

export function prepareAutoMesh(
  engine: EditorEngine,
  attachmentId: string,
  cols: number,
  rows: number,
): AutoMeshInput {
  if (engine.mode !== 'setup') throw new Error('Switch to Setup for auto mesh.');
  const region = engine.skeleton.attachmentById.get(attachmentId);
  if (region?.type !== 'region' || !region.vertices || !region.uvs)
    throw new Error('Select a region for auto mesh.');
  return { vertices: [...region.vertices], uvs: [...region.uvs], cols, rows };
}

export class ApplyAutoMeshCommand implements Command {
  readonly label = 'Auto Mesh';
  readonly attachmentId = uuid();
  private before: RigSnapshot | null = null;
  private after: RigSnapshot | null = null;
  private geometry: AutoMeshGeometry;
  constructor(
    private engine: EditorEngine,
    private slotId: string,
    private sourceId: string,
    geometry: AutoMeshGeometry,
    private fingerprint: string,
    private target: AttachmentTarget,
  ) {
    this.geometry = structuredClone(geometry);
  }
  do(): void {
    if (this.after) {
      applyRigSnapshot(this.engine, this.after);
      return;
    }
    if (this.engine.mode !== 'setup' || rigFingerprint(this.engine) !== this.fingerprint)
      throw new Error('Auto mesh discarded because the rig changed. Run it again.');
    const before = captureRig(this.engine),
      after = prepareRigEdit(this.engine, (data) => {
        const region = data.attachments.find((item) => item.id === this.sourceId);
        if (region?.type !== 'region') throw new Error('Auto mesh source region no longer exists.');
        insertMesh(data, this.slotId, this.target, {
          id: this.attachmentId,
          name: region.name + ' mesh',
          type: 'mesh',
          textureId: region.textureId,
          meshVertices: [...this.geometry.vertices],
          meshUVs: [...this.geometry.uvs],
          meshTriangles: [...this.geometry.triangles],
          meshHull: [...this.geometry.hull],
        });
      });
    applyRigSnapshot(this.engine, after);
    this.before = before;
    this.after = after;
  }
  undo(): void {
    if (this.before) applyRigSnapshot(this.engine, this.before);
  }
}
