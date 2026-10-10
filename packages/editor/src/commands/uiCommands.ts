import {
  validateProject,
  resolveSceneLayout,
  sceneTransform,
  type BoneByBoneProject,
  type SceneNode,
  type UIComponent,
} from '@limber/core';
import type { Command } from '../history/history';

export type UIEdit =
  | {
      kind: 'extract';
      artboardId: string;
      nodeId: string;
      componentId: string;
      idMap: Record<string, string>;
    }
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
      if (intent.kind === 'extract') {
        const board = artboards.find((board) => board.id === intent.artboardId);
        const root = board?.nodes.find((node) => node.id === intent.nodeId);
        if (!board || !root) throw new Error('Component source no longer exists.');
        const included = new Set([root.id]);
        const children = new Map<string, SceneNode[]>();
        for (const node of board.nodes)
          if (node.parentId) {
            const list = children.get(node.parentId) ?? [];
            list.push(node);
            children.set(node.parentId, list);
          }
        const queue = [root.id];
        for (let i = 0; i < queue.length; i++)
          for (const node of children.get(queue[i]!) ?? []) {
            included.add(node.id);
            queue.push(node.id);
          }
        if (
          board.logic &&
          (board.nodes.some(
            (node) => included.has(node.id) && node.type === 'text' && node.binding !== undefined,
          ) ||
            board.logic.bindings?.some((binding) => included.has(binding.instanceId)) ||
            board.logic.routes?.some((route) => route.targetId !== null && included.has(route.targetId)))
        )
          throw new Error('Remove or migrate Logic bindings before extracting this component.');
        if (
          board.clips?.some((clip) =>
            clip.tracks.some((track) => included.has(track.nodeId) && track.nodeId !== root.id),
          )
        )
          throw new Error('Component extraction cannot discard descendant animation tracks.');
        const box = resolveSceneLayout(board).get(root.id)!;
        const nodes = board.nodes
          .filter((node) => included.has(node.id))
          .map((node) => {
            const copy = structuredClone(node);
            copy.id = intent.idMap[node.id]!;
            copy.parentId = node.id === root.id ? null : intent.idMap[node.parentId!]!;
            if (node.id === root.id) {
              copy.transform = sceneTransform();
              copy.opacity = 1;
              copy.visible = true;
              delete copy.tint;
              if (copy.layout)
                copy.layout = {
                  x: { ...copy.layout.x, anchorMin: 0, anchorMax: 1, offsetMin: 0, offsetMax: 0, pivot: 0.5 },
                  y: { ...copy.layout.y, anchorMin: 0, anchorMax: 1, offsetMin: 0, offsetMax: 0, pivot: 0.5 },
                };
            }
            return copy;
          });
        const text = nodes.find((node) => node.type === 'text');
        const component: UIComponent = {
          id: intent.componentId,
          name: root.name,
          revision: 1,
          width: Math.max(1, box.width),
          height: Math.max(1, box.height),
          nodes,
          exposed: text ? [{ name: 'label', nodeId: text.id, property: 'text' }] : [],
        };
        const instance: SceneNode = {
          id: root.id,
          name: root.name,
          parentId: root.parentId,
          type: 'instance',
          componentId: component.id,
          overrides: {},
          transform: { ...root.transform },
          opacity: root.opacity,
          visible: root.visible,
          ...(root.tint === undefined ? {} : { tint: root.tint }),
          ...(root.layout ? { layout: structuredClone(root.layout) } : {}),
          width: component.width,
          height: component.height,
        };
        artboards = artboards.map((item) =>
          item.id === board.id
            ? {
                ...item,
                nodes: item.nodes.flatMap((node) =>
                  node.id === root.id ? [instance] : included.has(node.id) ? [] : [node],
                ),
              }
            : item,
        );
        components = [...(components ?? []), component];
      } else if (intent.kind === 'node') {
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
          for (const board of artboards)
            for (const binding of board.logic?.bindings ?? []) {
              const instance = board.nodes.find((node) => node.id === binding.instanceId);
              if (instance?.type !== 'instance' || instance.componentId !== before.id) continue;
              const oldTarget = before.exposed.find((e) => e.name === binding.exposureName);
              const nextTarget = intent.component.exposed.find((e) => e.name === binding.exposureName);
              if (
                !nextTarget ||
                oldTarget?.nodeId !== nextTarget.nodeId ||
                oldTarget?.property !== nextTarget.property
              )
                throw new Error(
                  'Explicit binding migration is required before changing an exposed target in use.',
                );
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
