import { validateProject, type BoneByBoneProject, type EmbeddedFont } from '@limber/core';
import type { Command } from '../history/history';

/** Complete font bytes/license edit, validated before publishing; undo preserves absent fields. */
export class EditProjectFontsCommand implements Command {
  readonly scope = 'project' as const;
  readonly label = 'Edit project fonts';
  private readonly intent: EmbeddedFont[];
  private before: EmbeddedFont[] | undefined;
  private after: EmbeddedFont[] | undefined;
  constructor(
    private project: BoneByBoneProject,
    fonts: readonly EmbeddedFont[],
  ) {
    this.intent = structuredClone([...fonts]);
  }
  do(): void {
    if (!this.after) {
      validateProject({ ...this.project, fonts: this.intent });
      this.before = this.project.fonts;
      this.after = this.intent;
    }
    this.project.fonts = this.after;
  }
  undo(): void {
    if (!this.after) return;
    if (this.before === undefined) delete this.project.fonts;
    else this.project.fonts = this.before;
  }
}
