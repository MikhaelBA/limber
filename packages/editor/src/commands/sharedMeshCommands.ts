import { uuid, MESH_GEOMETRY_FIELDS, type SkeletonData, type Animation } from '@limber/core';
import { MeshEditCommand, insertMesh } from './meshCommands';
import type { EditorEngine } from '../engine/EditorEngine';
import type { AttachmentTarget } from './attachmentCommands';

export class CreateSharedMeshCommand extends MeshEditCommand {
  readonly label = 'Create shared mesh';
  readonly attachmentId = uuid();
  constructor(engine: EditorEngine, private sourceId: string, private slotId: string,
    private target: AttachmentTarget = 'default') { super(engine); }
  protected edit(data: SkeletonData, animations: Animation[]): void {
    if (this.engine.mode !== 'setup') throw new Error('Switch to Setup to create shared meshes.');
    const source = data.attachments.find((item) => item.id === this.sourceId);
    if (source?.type !== 'mesh') throw new Error('Select a mesh to share.');
    const instance = structuredClone(source);
    instance.id = this.attachmentId;
    instance.name = `${source.name} shared`;
    instance.meshSourceId = source.meshSourceId ?? source.id;
    for (const key of MESH_GEOMETRY_FIELDS) delete instance[key];
    insertMesh(data, this.slotId, this.target, instance);
    for (const animation of animations) {
      const tracks = animation.timelines.filter((track) => track.kind === 'deform' && track.attachmentId === source.id);
      for (const track of tracks) {
        const copy = structuredClone(track);
        if (copy.kind === 'deform') copy.attachmentId = instance.id;
        animation.timelines.push(copy);
      }
    }
  }
}

export class DetachSharedMeshCommand extends MeshEditCommand {
  readonly label = 'Detach shared mesh';
  constructor(engine: EditorEngine, private attachmentId: string) { super(engine); }
  protected edit(data: SkeletonData): void {
    if (this.engine.mode !== 'setup') throw new Error('Switch to Setup to detach shared meshes.');
    const mesh = data.attachments.find((item) => item.id === this.attachmentId);
    if (mesh?.meshSourceId === undefined) throw new Error('Select a shared mesh to detach.');
    for (const key of MESH_GEOMETRY_FIELDS) if (mesh[key]) mesh[key] = [...mesh[key]!];
    delete mesh.meshSourceId;
  }
}

export class SetMeshTextureCommand extends MeshEditCommand {
  readonly label = 'Change mesh texture';
  constructor(engine: EditorEngine, private attachmentId: string, private textureId: string) { super(engine); }
  protected edit(data: SkeletonData): void {
    if (this.engine.mode !== 'setup') throw new Error('Switch to Setup to change mesh textures.');
    const mesh = data.attachments.find((item) => item.id === this.attachmentId);
    if (mesh?.type !== 'mesh') throw new Error('Mesh no longer exists.');
    if (this.textureId && !this.engine.document.assetManifest[this.textureId]) throw new Error('Choose an existing mesh texture.');
    mesh.textureId = this.textureId;
  }
}
