import { expandUIComponents, meshGeometryOwner } from '@limber/core';
import { nativeAssetState, type NativeRuntimeAsset } from './NativeRuntimeAsset';
import { checkRuntimeBudget, createRuntimeBudget, validateRuntimeBudget, type RuntimeBudget } from './doctor';
import type { RuntimeDiagnostic } from './model';

export interface RuntimeRigDiagnostic extends RuntimeDiagnostic {
  artboardId: string;
  rigId: string;
}
/** Inventory checks include hidden/instanced rigs and preserve independent variant weights. */
export function diagnoseNativeRigs(
  asset: NativeRuntimeAsset,
  input: RuntimeBudget = createRuntimeBudget(),
): RuntimeRigDiagnostic[] {
  const budget = validateRuntimeBudget(input),
    project = nativeAssetState(asset).project;
  const findings: RuntimeRigDiagnostic[] = [];
  for (const board of project.artboards)
    for (const rig of expandUIComponents(project, board).artboard.nodes) {
      if (rig.type !== 'rig') continue;
      const attachments = new Map(rig.skeleton.attachments.map((attachment) => [attachment.id, attachment]));
      for (const attachment of attachments.values()) {
        const geometry = meshGeometryOwner(attachment, attachments);
        const vertices =
          ((attachment.type === 'region' ? geometry.vertices?.length : geometry.meshVertices?.length) ?? 0) /
          2;
        let offset = 0,
          rigidFallback = 0,
          weightedTransforms = 0;
        if (attachment.weights)
          for (let vertex = 0; vertex < vertices; vertex++) {
            const influences = attachment.weights[offset] ?? 0;
            if (influences === 0) rigidFallback++;
            weightedTransforms += influences;
            offset += 1 + influences * 2;
          }
        findings.push(
          ...checkRuntimeBudget(
            {
              vertices,
              weightedVertexTransforms: weightedTransforms,
              triangles:
                attachment.type === 'region'
                  ? 2
                  : attachment.type === 'mesh'
                    ? (geometry.meshTriangles?.length ?? 0) / 3
                    : 0,
              clippingVertices: attachment.type === 'clipping' ? vertices : 0,
            },
            budget,
            attachment.id,
            'inventory',
          ).map((finding) => ({ ...finding, artboardId: board.id, rigId: rig.id })),
        );
        if (rigidFallback > 0 && attachment.type === 'mesh')
          findings.push({
            code: 'RIG_RIGID_FALLBACK',
            severity: 'warning',
            objectId: attachment.id,
            artboardId: board.id,
            rigId: rig.id,
            explanation: `${attachment.name}: ${rigidFallback} of ${vertices} vertices use their slot bone because the authored influence count is zero.`,
            remedy:
              'Inspect weights and bind/smooth those vertices if rigid fallback is unintended. Rigid binding is supported.',
          });
        if (
          attachment.type === 'clipping' &&
          rig.skeleton.slots.some(
            (slot) => slot.defaultAttachmentId === attachment.id && attachment.endSlotId === slot.id,
          )
        )
          findings.push({
            code: 'RIG_EMPTY_CLIP_RANGE',
            severity: 'warning',
            objectId: attachment.id,
            artboardId: board.id,
            rigId: rig.id,
            explanation: `${attachment.name}: its exclusive clipping end is the same slot that starts the mask.`,
            remedy:
              'Inspect the clipping slot and choose a later exclusive end if geometry should be masked.',
          });
      }
    }
  return findings;
}
