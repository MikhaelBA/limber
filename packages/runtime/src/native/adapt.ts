import { PROJECT_FORMAT, PROJECT_SCHEMA_VERSION, type BoneByBoneProject, type SceneClip } from '@limber/core';
import type { RuntimeProgram } from './model';

/** Private bridge for existing portable samplers/validators. Never serialized as the runtime file. */
export function materializeRuntimeProject(program: RuntimeProgram): {
  project: BoneByBoneProject;
  ephemeralOwners: Map<string, string>;
} {
  const copy = structuredClone(program);
  const reserved = new Set<string>([copy.id]);
  const pending: unknown[] = [copy];
  while (pending.length) {
    const item = pending.pop();
    if (!item || typeof item !== 'object') continue;
    if ('id' in item && typeof item.id === 'string') reserved.add(item.id);
    for (const child of Object.values(item)) pending.push(child);
  }
  const ephemeralOwners = new Map<string, string>();
  let sequence = 0;
  const next = (owner: string): string => {
    let id: string;
    do {
      id = `@runtime:${sequence++}`;
    } while (reserved.has(id));
    reserved.add(id);
    ephemeralOwners.set(id, owner);
    return id;
  };
  const project: BoneByBoneProject = {
    format: PROJECT_FORMAT,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    projectId: copy.id,
    name: copy.name,
    editor: { activeArtboardId: copy.defaultArtboardId, activeRigId: null },
    assetManifest: Object.fromEntries(
      copy.textures.map((texture) => [
        texture.id,
        {
          name: texture.id,
          source: 'embedded' as const,
          ...(texture.type === 'image' ? { dataUrl: `data:${texture.mime};base64,${texture.base64}` } : {}),
        },
      ]),
    ),
    components: copy.components.map((component) => ({ ...component, revision: 1 })),
    artboards: copy.artboards.map((board) => {
      const { clips, ...rest } = board;
      return {
        ...rest,
        ...(clips === undefined
          ? {}
          : {
              clips: clips.map((clip): SceneClip => ({
                ...clip,
                fps: 60,
                tracks: clip.tracks.map((track) => ({
                  ...track,
                  id: next(track.nodeId),
                  keys: track.keys.map((key) => ({ ...key, id: next(track.nodeId) })),
                })),
                events: clip.events.map((event) => ({ ...event, id: next(clip.id) })),
              })),
            }),
      };
    }),
  };
  return { project, ephemeralOwners };
}
