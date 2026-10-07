import {
  sceneTransform,
  sceneReparentTransform,
  uuid,
  validateProject,
  type BoneByBoneProject,
  type SceneNode,
  type SceneNodeBase,
  type Artboard,
  type SceneTransform,
  type SceneClip,
} from '@limber/core';
import type { Command } from '../history/history';

export type ScenePropertyPatch = Partial<
  Pick<SceneNodeBase, 'name' | 'opacity' | 'visible' | 'transform' | 'tint' | 'layout'>
>;
/** Serializable intent, useful for reproducing edit/undo failures. */
export type SceneEdit =
  | { kind: 'add'; node: SceneNode }
  | { kind: 'update'; nodeId: string; patch: ScenePropertyPatch }
  | { kind: 'reparent'; nodeId: string; parentId: string | null; preserveWorld?: boolean }
  | { kind: 'transforms'; values: Record<string, SceneTransform> }
  | { kind: 'remove'; nodeIds: string[] }
  | { kind: 'group'; nodeIds: string[]; groupId: string; name: string }
  | {
      kind: 'duplicate';
      nodeIds: string[];
      idMap: Record<string, string>;
      motionIdMap?: Record<string, string>;
    }
  | { kind: 'reorder'; nodeId: string; beforeId: string | null };

function requireNode(nodes: readonly SceneNode[], id: string): SceneNode {
  const node = nodes.find((n) => n.id === id);
  if (!node) throw new Error(`Scene node ${id} no longer exists.`);
  return node;
}

/** Includes descendants without recursion; input selection may contain ancestors and children. */
export function sceneSubtreeIds(nodes: readonly SceneNode[], selected: readonly string[]): Set<string> {
  const byId = new Set(nodes.map((n) => n.id));
  const children = new Map<string, string[]>();
  for (const n of nodes) {
    if (n.parentId !== null) {
      const ids = children.get(n.parentId) ?? [];
      ids.push(n.id);
      children.set(n.parentId, ids);
    }
  }
  const result = new Set<string>();
  const queue = [...selected];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    if (!byId.has(id)) throw new Error(`Scene node ${id} no longer exists.`);
    if (result.has(id)) continue;
    result.add(id);
    queue.push(...(children.get(id) ?? []));
  }
  return result;
}

function editedNodes(nodes: SceneNode[], edit: SceneEdit, artboard: Artboard): SceneNode[] {
  switch (edit.kind) {
    case 'add':
      return [...nodes, structuredClone(edit.node)];
    case 'update': {
      requireNode(nodes, edit.nodeId);
      return nodes.map((n) => (n.id === edit.nodeId ? { ...n, ...structuredClone(edit.patch) } : n));
    }
    case 'reparent': {
      requireNode(nodes, edit.nodeId);
      const transform = edit.preserveWorld
        ? sceneReparentTransform(artboard, edit.nodeId, edit.parentId)
        : undefined;
      return nodes.map((n) =>
        n.id === edit.nodeId ? { ...n, parentId: edit.parentId, transform: transform ?? n.transform } : n,
      );
    }
    case 'transforms': {
      for (const id of Object.keys(edit.values)) requireNode(nodes, id);
      return nodes.map((n) =>
        Object.hasOwn(edit.values, n.id) ? { ...n, transform: structuredClone(edit.values[n.id]!) } : n,
      );
    }
    case 'remove': {
      const ids = sceneSubtreeIds(nodes, edit.nodeIds);
      return nodes.filter((n) => !ids.has(n.id));
    }
    case 'group': {
      const selected = new Set(edit.nodeIds);
      if (!selected.size) throw new Error('Select at least one node to group.');
      const parentId = requireNode(nodes, edit.nodeIds[0]!).parentId;
      for (const id of selected) {
        if (requireNode(nodes, id).parentId !== parentId) throw new Error('Grouped nodes must be siblings.');
      }
      const group: SceneNode = {
        type: 'group',
        id: edit.groupId,
        name: edit.name,
        parentId,
        transform: sceneTransform(),
        opacity: 1,
        visible: true,
      };
      const result = nodes.map((n) => (selected.has(n.id) ? { ...n, parentId: group.id } : n));
      result.splice(
        nodes.findIndex((n) => selected.has(n.id)),
        0,
        group,
      );
      return result;
    }
    case 'duplicate': {
      const ids = sceneSubtreeIds(nodes, edit.nodeIds);
      const result: SceneNode[] = [...nodes];
      for (const node of nodes) {
        if (!ids.has(node.id)) continue;
        const copy = structuredClone(node);
        const id = edit.idMap[node.id];
        if (!id) throw new Error(`Duplicate mapping is missing ${node.id}.`);
        copy.id = id;
        const root = node.parentId === null || !ids.has(node.parentId);
        copy.parentId = root ? node.parentId : edit.idMap[node.parentId!]!;
        if (root) copy.name = `${copy.name} copy`;
        result.push(copy);
      }
      return result;
    }
    case 'reorder': {
      const node = requireNode(nodes, edit.nodeId);
      if (edit.beforeId === node.id) return [...nodes];
      if (edit.beforeId !== null && requireNode(nodes, edit.beforeId).parentId !== node.parentId) {
        throw new Error('Draw-order changes must stay among siblings.');
      }
      const result = nodes.filter((n) => n.id !== node.id);
      const index = edit.beforeId === null ? result.length : result.findIndex((n) => n.id === edit.beforeId);
      result.splice(index, 0, node);
      return result;
    }
  }
}

/**
 * Copy-on-write scene transactions retain only node-list references and edited nodes.
 * No full-project snapshot per command. Rig payloads keep their existing identity.
 * Reparent retains local transforms by default; preserveWorld opts into affine world-pose retention.
 */
export class EditSceneCommand implements Command {
  readonly scope = 'project' as const;
  readonly label: string;
  private readonly edit: SceneEdit;
  private before: SceneNode[] | null = null;
  private after: SceneNode[] | null = null;
  private beforeClips: SceneClip[] | undefined;
  private afterClips: SceneClip[] | undefined;
  private beforeRig: string | null = null;
  private afterRig: string | null = null;

  constructor(
    private readonly project: BoneByBoneProject,
    readonly artboardId: string,
    edit: SceneEdit,
  ) {
    this.edit = structuredClone(edit);
    if (this.edit.kind === 'duplicate' && !this.edit.motionIdMap) {
      const ids: string[] = [];
      for (const clip of this.artboard().clips ?? [])
        for (const track of clip.tracks)
          if (this.edit.idMap[track.nodeId]) ids.push(track.id, ...track.keys.map((key) => key.id));
      this.edit.motionIdMap = Object.fromEntries(ids.map((id) => [id, uuid()]));
    }
    this.label = `${edit.kind[0]!.toUpperCase()}${edit.kind.slice(1)} scene nodes`;
  }

  private artboard(): Artboard {
    const artboard = this.project.artboards.find((a) => a.id === this.artboardId);
    if (!artboard) throw new Error(`Artboard ${this.artboardId} no longer exists.`);
    return artboard;
  }

  do(): void {
    const artboard = this.artboard();
    if (!this.after) {
      const after = editedNodes(artboard.nodes, this.edit, artboard);
      this.beforeClips = artboard.clips;
      this.afterClips = artboard.clips;
      if (this.edit.kind === 'remove') {
        const remaining = new Set(after.map((node) => node.id));
        this.afterClips = artboard.clips?.map((clip) => ({
          ...clip,
          tracks: clip.tracks.filter((track) => remaining.has(track.nodeId)),
        }));
      } else if (this.edit.kind === 'duplicate') {
        const intent = this.edit;
        this.afterClips = artboard.clips?.map((clip) => ({
          ...clip,
          tracks: [
            ...clip.tracks,
            ...clip.tracks
              .filter((track) => intent.idMap[track.nodeId])
              .map((track) => ({
                ...structuredClone(track),
                id: intent.motionIdMap![track.id]!,
                nodeId: intent.idMap[track.nodeId]!,
                keys: track.keys.map((key) => ({
                  ...structuredClone(key),
                  id: intent.motionIdMap![key.id]!,
                })),
              })),
          ],
        }));
      }
      const active = this.project.editor.activeArtboardId === artboard.id;
      this.beforeRig = this.project.editor.activeRigId;
      this.afterRig =
        active && !after.some((n) => n.id === this.beforeRig && n.type === 'rig')
          ? (after.find((n) => n.type === 'rig')?.id ?? null)
          : this.beforeRig;
      // Validate a proposed view before mutating anything; failed edits leave history unchanged.
      validateProject({
        ...this.project,
        artboards: this.project.artboards.map((a) =>
          a.id === artboard.id ? { ...a, nodes: after, clips: this.afterClips } : a,
        ),
        editor: { ...this.project.editor, activeRigId: this.afterRig },
      });
      this.before = artboard.nodes;
      this.after = after;
    }
    artboard.nodes = this.after;
    if (this.afterClips === undefined) delete artboard.clips;
    else artboard.clips = this.afterClips;
    if (this.project.editor.activeArtboardId === artboard.id) this.project.editor.activeRigId = this.afterRig;
  }

  undo(): void {
    if (!this.before) return;
    const artboard = this.artboard();
    artboard.nodes = this.before;
    if (this.beforeClips === undefined) delete artboard.clips;
    else artboard.clips = this.beforeClips;
    if (this.project.editor.activeArtboardId === artboard.id)
      this.project.editor.activeRigId = this.beforeRig;
  }

  toJSON(): { artboardId: string; edit: SceneEdit } {
    return { artboardId: this.artboardId, edit: structuredClone(this.edit) };
  }
}

export function duplicateSceneCommand(
  project: BoneByBoneProject,
  artboardId: string,
  nodeIds: string[],
): EditSceneCommand {
  const artboard = project.artboards.find((a) => a.id === artboardId);
  if (!artboard) throw new Error(`Artboard ${artboardId} no longer exists.`);
  const idMap = Object.fromEntries([...sceneSubtreeIds(artboard.nodes, nodeIds)].map((id) => [id, uuid()]));
  return new EditSceneCommand(project, artboardId, { kind: 'duplicate', nodeIds, idMap });
}
