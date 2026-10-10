import { expandUIComponents, fontFamilyKey, type BoneByBoneProject, type LogicGraph } from '@limber/core';
import type { RuntimeDiagnostic } from '@limber/runtime';

export interface ShipFocusTarget {
  artboardId: string;
  nodeId: string | null;
  rigId: string | null;
  boneId: string | null;
  slotId: string | null;
  workspace: 'scene' | 'rig' | 'logic';
  label: string;
}
/** A local ID may occur in several rigs; present each actual candidate rather than guessing. */
export function resolveShipFocus(
  project: BoneByBoneProject,
  finding: RuntimeDiagnostic & { artboardId?: string; rigId?: string },
): ShipFocusTarget[] {
  const id = finding.objectId;
  if (!id) return [];
  const result: ShipFocusTarget[] = [];
  const context = finding as RuntimeDiagnostic & { artboardId?: string; rigId?: string };
  for (const board of project.artboards) {
    if (context.artboardId && context.artboardId !== board.id) continue;
    const expanded = expandUIComponents(project, board);
    const add = (
      nodeId: string | null,
      rigId: string | null,
      boneId: string | null,
      slotId: string | null,
      workspace: ShipFocusTarget['workspace'],
      label: string,
    ) => {
      const ownerId = nodeId ? (expanded.owners.get(nodeId) ?? nodeId) : null;
      const authoredRig =
        rigId && board.nodes.some((node) => node.type === 'rig' && node.id === rigId) ? rigId : null;
      result.push({
        artboardId: board.id,
        nodeId: ownerId,
        rigId: authoredRig,
        boneId: authoredRig ? boneId : null,
        slotId: authoredRig ? slotId : null,
        workspace: rigId && !authoredRig ? 'scene' : workspace,
        label: `${board.name} · ${label}${rigId && !authoredRig ? ' (component instance)' : ''}`,
      });
    };
    const graphMatch = (graph: LogicGraph | undefined) =>
      graph &&
      [
        graph.id,
        ...graph.parameters.map((p) => p.id),
        ...graph.states.map((s) => s.id),
        ...graph.transitions.map((t) => t.id),
        ...(graph.routes ?? []).map((r) => r.id),
      ].includes(id);
    if (id === board.id || id === project.projectId) add(null, null, null, null, 'scene', board.name);
    if (graphMatch(board.logic)) add(null, null, null, null, 'logic', board.logic!.name);
    for (const node of expanded.artboard.nodes) {
      if (context.rigId && context.rigId !== node.id) continue;
      let originalId = node.id;
      if (expanded.owners.get(node.id) !== node.id && node.id.startsWith('[')) {
        try {
          const path = JSON.parse(node.id) as unknown;
          if (Array.isArray(path) && typeof path.at(-1) === 'string') originalId = path.at(-1) as string;
        } catch {
          /* An authored ID can itself begin with a bracket. */
        }
      }
      const match =
        node.id === id ||
        originalId === id ||
        ((node.type === 'image' || node.type === 'nineSlice') && node.textureId === id) ||
        (node.type === 'text' &&
          (project.fonts ?? []).some(
            (font) =>
              font.id === id &&
              node.fontFamilies.some((family) => fontFamilyKey(family) === fontFamilyKey(font.family)),
          ));
      if (match)
        add(
          node.id,
          node.type === 'rig' ? node.id : null,
          null,
          null,
          node.type === 'rig' ? 'rig' : 'scene',
          node.name,
        );
      if (node.type !== 'rig') continue;
      if (graphMatch(node.logic)) add(node.id, node.id, null, null, 'logic', `${node.name} · Logic`);
      const skeleton = node.skeleton;
      const bone = skeleton.bones.find((bone) => bone.id === id);
      if (bone) add(node.id, node.id, bone.id, null, 'rig', `${node.name} · ${bone.name}`);
      const slot = skeleton.slots.find((slot) => slot.id === id);
      if (slot) add(node.id, node.id, null, slot.id, 'rig', `${node.name} · ${slot.name}`);
      for (const attachment of skeleton.attachments)
        if (attachment.id === id || attachment.textureId === id) {
          const owner = skeleton.slots.find(
            (slot) =>
              slot.defaultAttachmentId === attachment.id ||
              skeleton.skins.some((skin) => skin.attachments[slot.id] === attachment.id) ||
              node.animations.some((clip) =>
                clip.timelines.some(
                  (track) =>
                    track.kind === 'slotAttachment' &&
                    track.slotId === slot.id &&
                    track.keyframes.some((key) => key.attachmentId === attachment.id),
                ),
              ),
          );
          add(node.id, node.id, null, owner?.id ?? null, 'rig', `${node.name} · ${attachment.name}`);
        }
      for (const constraint of [
        ...skeleton.ikConstraints,
        ...(skeleton.transformConstraints ?? []),
        ...(skeleton.pathConstraints ?? []),
        ...(skeleton.secondaryConstraints ?? []),
      ])
        if (constraint.id === id) {
          add(
            node.id,
            node.id,
            'boneId' in constraint ? constraint.boneId : (constraint.bones[0] ?? null),
            null,
            'rig',
            `${node.name} · ${constraint.id}`,
          );
        }
    }
  }
  return [...new Map(result.map((target) => [JSON.stringify(target), target])).values()];
}
