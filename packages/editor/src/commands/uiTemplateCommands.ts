import { deserializeProject, uuid, validateProject, type BoneByBoneProject } from '@limber/core';
import type { Command } from '../history/history';
import source from '../../../../fixtures/bbbproj-v3-reward.json?raw';

/** Fresh IDs per insertion, stable for undo/redo; the historical fixture itself is immutable. */
export function rewardTemplate(): BoneByBoneProject {
  const template = deserializeProject(source),
    ids = new Map<string, string>();
  const remap = (id: string) => {
    if (!ids.has(id)) ids.set(id, uuid());
    return ids.get(id)!;
  };
  template.projectId = remap(template.projectId);
  for (const board of [...template.artboards, ...(template.components ?? [])]) {
    board.id = remap(board.id);
    for (const node of board.nodes) {
      node.id = remap(node.id);
      node.parentId = node.parentId ? remap(node.parentId) : null;
      if (node.type === 'image' || node.type === 'nineSlice') node.textureId = remap(node.textureId);
      if (node.type === 'instance') node.componentId = remap(node.componentId);
    }
  }
  for (const component of template.components ?? [])
    for (const exposed of component.exposed) exposed.nodeId = remap(exposed.nodeId);
  template.assetManifest = Object.fromEntries(
    Object.entries(template.assetManifest).map(([id, asset]) => [remap(id), asset]),
  );
  template.editor.activeArtboardId = remap(template.editor.activeArtboardId);
  validateProject(template);
  return template;
}
export class AddUITemplateCommand implements Command {
  readonly scope = 'project' as const;
  readonly label = 'Add reward popup';
  private before: BoneByBoneProject | null = null;
  private after: BoneByBoneProject | null = null;
  constructor(
    private project: BoneByBoneProject,
    private template: BoneByBoneProject,
  ) {
    this.template = structuredClone(template);
  }
  do() {
    if (!this.after) {
      const after = {
        ...this.project,
        artboards: [...this.project.artboards, ...this.template.artboards],
        components: [...(this.project.components ?? []), ...(this.template.components ?? [])],
        assetManifest: { ...this.project.assetManifest, ...this.template.assetManifest },
        editor: { ...this.template.editor },
      };
      validateProject(after);
      this.before = { ...this.project };
      this.after = after;
    }
    Object.assign(this.project, this.after);
  }
  undo() {
    if (this.before) {
      Object.assign(this.project, this.before);
      if (!this.before.components) delete this.project.components;
    }
  }
}
