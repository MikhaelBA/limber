import {
  validateProject,
  type BoneByBoneProject,
  type SceneClip,
  type SceneKey,
  type SceneProperty,
  type SceneEvent,
  type Curve,
} from '@limber/core';
import type { Command } from '../history/history';

export type SceneMotionEdit =
  | { kind: 'add'; clip: SceneClip }
  | { kind: 'remove'; clipId: string }
  | {
      kind: 'metadata';
      clipId: string;
      patch: Partial<Pick<SceneClip, 'name' | 'duration' | 'loop' | 'fps'>>;
    }
  | { kind: 'key'; clipId: string; nodeId: string; property: SceneProperty; trackId: string; key: SceneKey }
  | {
      kind: 'keys';
      clipId: string;
      keyIds: string[];
      offset: number;
      scale: number;
      origin: number;
      duplicateIds?: Record<string, string>;
    }
  | { kind: 'deleteKeys'; clipId: string; keyIds: string[] }
  | { kind: 'curve'; clipId: string; keyIds: string[]; curve: Curve }
  | { kind: 'event'; clipId: string; event: SceneEvent };

function editClip(
  clip: SceneClip,
  edit: Exclude<SceneMotionEdit, { kind: 'add' } | { kind: 'remove' }>,
): SceneClip {
  const copy = structuredClone(clip);
  if (edit.kind === 'metadata') return { ...copy, ...edit.patch };
  if (edit.kind === 'key') {
    let track = copy.tracks.find((track) => track.nodeId === edit.nodeId && track.property === edit.property);
    if (!track) {
      track = { id: edit.trackId, nodeId: edit.nodeId, property: edit.property, keys: [] };
      copy.tracks.push(track);
    }
    const existing = track.keys.findIndex((key) => Math.abs(key.time - edit.key.time) < 1e-9);
    if (existing >= 0) track.keys[existing] = { ...edit.key, id: track.keys[existing]!.id };
    else track.keys.push(edit.key);
    track.keys.sort((a, b) => a.time - b.time);
    return copy;
  }
  if (edit.kind === 'event') {
    const index = copy.events.findIndex((event) => event.id === edit.event.id);
    if (index >= 0) copy.events[index] = edit.event;
    else copy.events.push(edit.event);
    copy.events.sort((a, b) => a.time - b.time);
    return copy;
  }
  const selected = new Set(edit.keyIds);
  const available = new Set([
    ...copy.tracks.flatMap((track) => track.keys.map((key) => key.id)),
    ...copy.events.map((event) => event.id),
  ]);
  for (const id of selected) if (!available.has(id)) throw new Error(`Key ${id} no longer exists.`);
  if (
    edit.kind === 'keys' &&
    (!Number.isFinite(edit.scale) ||
      edit.scale <= 0 ||
      !Number.isFinite(edit.offset) ||
      !Number.isFinite(edit.origin))
  )
    throw new Error('Key scale must be positive; time edits must be finite.');
  function keys<T extends { id: string; time: number }>(values: T[]): T[] {
    if (edit.kind === 'deleteKeys') return values.filter((key) => !selected.has(key.id));
    if (edit.kind !== 'keys') return values;
    const changed = values
      .filter((key) => selected.has(key.id))
      .map((key) => {
        const id = edit.duplicateIds ? edit.duplicateIds[key.id] : key.id;
        if (!id) throw new Error(`Duplicate mapping missing for ${key.id}.`);
        return { ...key, id, time: edit.origin + (key.time - edit.origin) * edit.scale + edit.offset };
      });
    return [...values.filter((key) => edit.duplicateIds || !selected.has(key.id)), ...changed].sort(
      (a, b) => a.time - b.time,
    );
  }
  for (const track of copy.tracks) {
    track.keys = keys(track.keys);
    if (edit.kind === 'curve')
      track.keys = track.keys.map((key) => (selected.has(key.id) ? { ...key, curve: edit.curve } : key));
  }
  copy.events = keys(copy.events);
  return copy;
}

/** Copy-on-write clip-library transaction; source nodes and rig payloads keep their identities. */
export class EditSceneMotionCommand implements Command {
  readonly scope = 'project' as const;
  readonly label = 'Edit scene animation';
  private before: SceneClip[] | undefined;
  private after: SceneClip[] | null = null;
  private readonly edit: SceneMotionEdit;
  constructor(
    private project: BoneByBoneProject,
    private artboardId: string,
    edit: SceneMotionEdit,
  ) {
    this.edit = structuredClone(edit);
  }
  private artboard() {
    const artboard = this.project.artboards.find((a) => a.id === this.artboardId);
    if (!artboard) throw new Error('Artboard no longer exists.');
    return artboard;
  }
  do(): void {
    const artboard = this.artboard();
    if (!this.after) {
      const clips = artboard.clips ?? [],
        edit = this.edit;
      if (edit.kind !== 'add' && !clips.some((clip) => clip.id === edit.clipId))
        throw new Error('Scene clip no longer exists.');
      const after =
        edit.kind === 'add'
          ? [...clips, edit.clip]
          : edit.kind === 'remove'
            ? clips.filter((clip) => clip.id !== edit.clipId)
            : clips.map((clip) => (clip.id === edit.clipId ? editClip(clip, edit) : clip));
      validateProject({
        ...this.project,
        artboards: this.project.artboards.map((a) => (a.id === artboard.id ? { ...a, clips: after } : a)),
      });
      this.before = artboard.clips;
      this.after = after;
    }
    artboard.clips = this.after;
  }
  undo(): void {
    if (!this.after) return;
    const artboard = this.artboard();
    if (this.before === undefined) delete artboard.clips;
    else artboard.clips = this.before;
  }
}
