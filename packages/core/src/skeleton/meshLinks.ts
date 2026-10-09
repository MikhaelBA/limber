import type { AttachmentData, SkeletonData } from '../types/data';

export const MESH_GEOMETRY_FIELDS = ['meshVertices', 'meshUVs', 'meshTriangles', 'meshHull'] as const;

/** A link is one level deep. Binding, weights, texture and Deform belong to the instance. */
export function meshGeometryOwner(
  attachment: AttachmentData,
  attachments: ReadonlyMap<string, AttachmentData>,
): AttachmentData {
  if (attachment.meshSourceId === undefined) return attachment;
  const source = attachments.get(attachment.meshSourceId);
  if (attachment.type !== 'mesh' || typeof attachment.meshSourceId !== 'string' || !source ||
      source === attachment || source.type !== 'mesh' || source.meshSourceId !== undefined)
    throw new Error(`Invalid shared mesh source for "${attachment.name}": link to an owned mesh in this rig.`);
  return source;
}

/** Bake shared array references once at load/structural edits; no lookups in skinning. */
export function resolveMeshLinks(data: SkeletonData, refresh = false): void {
  const attachments = new Map(data.attachments.map((item) => [item.id, item]));
  const links: [AttachmentData, AttachmentData][] = [];
  for (const attachment of data.attachments) {
    const source = meshGeometryOwner(attachment, attachments);
    if (source === attachment) continue;
    for (const key of MESH_GEOMETRY_FIELDS) {
      const own = attachment[key], shared = source[key];
      if (!refresh && own !== undefined && own !== shared &&
          (!Array.isArray(own) || !Array.isArray(shared) || own.length !== shared.length ||
           own.some((value, index) => value !== shared[index])))
        throw new Error(`Shared mesh "${attachment.name}" has conflicting geometry; detach before editing it independently.`);
    }
    links.push([attachment, source]);
  }
  // Validate every reference before changing any derived fields.
  for (const [attachment, source] of links) {
    for (const key of MESH_GEOMETRY_FIELDS) {
      if (source[key] === undefined) delete attachment[key];
      else attachment[key] = source[key];
    }
  }
}

/** Native files contain one owned geometry plus references, not duplicated derived arrays. */
export function meshJSONReplacer(this: Record<string, unknown>, key: string, value: unknown): unknown {
  return this.meshSourceId !== undefined && (MESH_GEOMETRY_FIELDS as readonly string[]).includes(key)
    ? undefined : value;
}
