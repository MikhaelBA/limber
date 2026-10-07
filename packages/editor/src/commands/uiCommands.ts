import { validateProject, type BoneByBoneProject, type SceneNode, type UIComponent } from '@limber/core';
import type { Command } from '../history/history';

export type UIEdit =
  | { kind: 'node'; artboardId: string; node: SceneNode }
  | { kind: 'component'; component: UIComponent }
  | { kind: 'removeComponent'; componentId: string };

/** Whole proposed state is checked before publishing references; failed edits retain redo. */
export class EditUICommand implements Command {
  readonly scope = 'project' as const;
  readonly label = 'Edit game UI';
  private readonly intent: UIEdit;
  private before: Pick<BoneByBoneProject, 'artboards' | 'components'> | null = null;
  private after: Pick<BoneByBoneProject, 'artboards' | 'components'> | null = null;
  constructor(
    private project: BoneByBoneProject,
    intent: UIEdit,
  ) {
    this.intent = structuredClone(intent);
  }
  do(): void {
    if (!this.after) {
      const intent = this.intent;
      let artboards = this.project.artboards,
        components = this.project.components;
      if (intent.kind === 'node') {
        const board = artboards.find((board) => board.id === intent.artboardId);
        if (!board?.nodes.some((node) => node.id === intent.node.id))
          throw new Error('UI node no longer exists.');
        artboards = artboards.map((board) =>
          board.id === intent.artboardId
            ? {
                ...board,
                nodes: board.nodes.map((node) => (node.id === intent.node.id ? intent.node : node)),
              }
            : board,
        );
      } else if (intent.kind === 'removeComponent') {
        if (!components?.some((component) => component.id === intent.componentId))
          throw new Error('Component no longer exists.');
        components = components.filter((component) => component.id !== intent.componentId);
      } else {
        const before = components?.find((component) => component.id === intent.component.id);
        if (before) {
          const instances = [...artboards, ...(components ?? [])]
            .flatMap((board) => board.nodes)
            .filter((node) => node.type === 'instance' && node.componentId === before.id);
          for (const node of instances) {
            if (node.type !== 'instance') continue;
            for (const name of Object.keys(node.overrides)) {
              const oldTarget = before.exposed.find((exposed) => exposed.name === name);
              const newTarget = intent.component.exposed.find((exposed) => exposed.name === name);
              if (
                !newTarget ||
                oldTarget?.nodeId !== newTarget.nodeId ||
                oldTarget?.property !== newTarget.property
              )
                throw new Error(
                  'Explicit override migration is required before changing an exposed target in use.',
                );
            }
          }
        }
        const component = { ...intent.component, revision: (before?.revision ?? 0) + 1 };
        components = before
          ? components!.map((item) => (item.id === component.id ? component : item))
          : [...(components ?? []), component];
      }
      validateProject({ ...this.project, artboards, components });
      this.before = { artboards: this.project.artboards, components: this.project.components };
      this.after = { artboards, components };
    }
    Object.assign(this.project, this.after);
  }
  undo(): void {
    if (!this.before) return;
    this.project.artboards = this.before.artboards;
    if (this.before.components === undefined) delete this.project.components;
    else this.project.components = this.before.components;
  }
  toJSON(): UIEdit {
    return structuredClone(this.intent);
  }
}
