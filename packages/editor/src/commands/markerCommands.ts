import { uuid, type MarkerData, type MarkerKind, isAreaMarker } from '@limber/core';
import type { EditorEngine } from '../engine/EditorEngine';
import type { Command } from '../history/history';
import { applyRigSnapshot, captureRig, prepareRigEdit, type RigSnapshot } from './rigEdits';

export function createMarker(boneId: string, kind: MarkerKind = 'socket'): MarkerData {
  const base = {
    id: uuid(),
    name: kind,
    boneId,
    transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 },
  };
  return (
    isAreaMarker(kind)
      ? { ...base, kind, shape: { type: 'rectangle', width: 40, height: 40 } }
      : { ...base, kind }
  ) as MarkerData;
}

export type MarkerEdit = { kind: 'put'; marker: MarkerData } | { kind: 'remove'; markerId: string };

/** Marker authoring changes setup data only; preview follows the sampled pose. */
export class EditMarkerCommand implements Command {
  readonly label = 'Edit Marker';
  private before: RigSnapshot | null = null;
  private after: RigSnapshot | null = null;
  private readonly edit: MarkerEdit;
  constructor(
    private engine: EditorEngine,
    edit: MarkerEdit,
  ) {
    this.edit = structuredClone(edit);
  }

  do(): void {
    if (this.after) {
      applyRigSnapshot(this.engine, this.after);
      return;
    }
    if (this.engine.mode !== 'setup') throw new Error('Switch to Setup to edit markers.');
    const before = captureRig(this.engine);
    const after = prepareRigEdit(this.engine, (data) => {
      const edit = this.edit;
      const markers = data.markers ?? [];
      if (edit.kind === 'remove') {
        if (!markers.some((marker) => marker.id === edit.markerId))
          throw new Error('Marker no longer exists.');
        data.markers = markers.filter((marker) => marker.id !== edit.markerId);
      } else {
        const index = markers.findIndex((marker) => marker.id === edit.marker.id);
        if (index < 0) data.markers = [...markers, structuredClone(edit.marker)];
        else {
          markers[index] = structuredClone(edit.marker);
          data.markers = markers;
        }
      }
    });
    applyRigSnapshot(this.engine, after);
    this.before = before;
    this.after = after;
  }

  undo(): void {
    if (this.before) applyRigSnapshot(this.engine, this.before);
  }
}
