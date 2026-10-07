import { validateProject, type Artboard, type BoneByBoneProject } from '@limber/core';
import type { Command } from '../history/history';

export type ArtboardEdit =
  | { kind: 'add'; artboard: Artboard }
  | { kind: 'update'; id: string; patch: Partial<Pick<Artboard, 'name' | 'width' | 'height'>> }
  | { kind: 'remove'; id: string };

export class EditArtboardCommand implements Command {
  readonly scope = 'project' as const;
  readonly label = 'Edit artboards';
  private before: Artboard[] | null = null;
  private after: Artboard[] | null = null;
  private beforeEditor: BoneByBoneProject['editor'] | null = null;
  private afterEditor: BoneByBoneProject['editor'] | null = null;
  private readonly edit: ArtboardEdit;
  constructor(
    private project: BoneByBoneProject,
    edit: ArtboardEdit,
  ) {
    this.edit = structuredClone(edit);
  }
  do(): void {
    if (!this.after) {
      const edit = this.edit;
      if (edit.kind !== 'add' && !this.project.artboards.some((a) => a.id === edit.id))
        throw new Error('Artboard no longer exists.');
      const after =
        edit.kind === 'add'
          ? [...this.project.artboards, edit.artboard]
          : edit.kind === 'remove'
            ? this.project.artboards.filter((a) => a.id !== edit.id)
            : this.project.artboards.map((a) => (a.id === edit.id ? { ...a, ...edit.patch } : a));
      if (!after.length) throw new Error('Keep at least one artboard.');
      const current = this.project.editor;
      const active = after.find((a) => a.id === current.activeArtboardId) ?? after[0]!;
      const editor =
        active.id === current.activeArtboardId
          ? { ...current }
          : {
              activeArtboardId: active.id,
              activeRigId: active.nodes.find((n) => n.type === 'rig')?.id ?? null,
            };
      validateProject({ ...this.project, artboards: after, editor });
      this.before = this.project.artboards;
      this.beforeEditor = { ...current };
      this.after = after;
      this.afterEditor = editor;
    }
    this.project.artboards = this.after;
    this.project.editor = { ...this.afterEditor! };
  }
  undo(): void {
    if (!this.before) return;
    this.project.artboards = this.before;
    this.project.editor = { ...this.beforeEditor! };
  }
}
