/**
 * SkeletonData — the immutable rig definition (DESIGN.md §3.1).
 * Serialized with the document; mutated only by editor commands.
 */

/** Version of the exported document format (DESIGN.md §3.4, §8.3). */
export const FORMAT_VERSION = 2;

export interface Transform {
  x: number;
  y: number;
  /** RADIANS internally. Degrees exist only in <PropertiesPanel /> for UX (§8.1). */
  rotation: number;
  scaleX: number;
  scaleY: number;
  shearX: number;
  shearY: number;
}

export interface BoneData {
  id: string; // UUID (see utils/uuid.ts for the secure-context fallback).
  name: string;
  parentId: string | null;
  setupPose: Transform;
  /** Visual bone length (gizmo drawing / IK reach). Not a transform. */
  length: number;
}

/**
 * IK constraints are TOP-LEVEL objects, not fields on BoneData (DESIGN.md §3.1):
 * a constraint typically controls a CHAIN of 1-2 bones, and explicit `order`
 * makes the multi-constraint solve sequence deterministic.
 */
export interface IKConstraintData {
  id: string;
  /** Ordered chain the constraint controls (1 or 2 entries). */
  bones: string[];
  /** Bone whose world position pulls the chain tip. */
  targetId: string;
  /** Optional bone controlling bend direction in the plane. */
  poleVectorId: string | null;
  bendDirection: 1 | -1;
  /** 0..1 — constraint influence. */
  mix: number;
  /** Degrees of slack before full stretch (keep 0 in v1). */
  softness: number;
  /** Solve order among all constraints (ascending). */
  order: number;
}

export interface SlotData {
  id: string;
  name: string;
  boneId: string;
  defaultAttachmentId: string | null;
  /** Packed RGBA uint32 (0xRRGGBBAA). No color strings past the UI boundary (§8.2). */
  color: number;
  /** Additive rendering (glows). Absent = 'normal' (format v2, additive). */
  blendMode?: 'normal' | 'add';
}

export interface AttachmentData {
  id: string;
  name: string;
  type: 'region' | 'mesh' | 'boundingBox' | 'clipping';
  /** Key into the asset manifest / texture registry — NOT a URL (DESIGN.md §3.5). Empty for untextured types. */
  textureId: string;

  // --- Region (4 corners) ---
  /** 8 floats, local space relative to the slot's bone. */
  vertices?: number[];
  /** 8 floats, normalized texture coordinates. */
  uvs?: number[];

  // --- Mesh ---
  /** Native schema 6: share geometry with an owned mesh in this rig (no link chains).
   * The geometry arrays below are derived aliases in memory and omitted from native JSON.
   * Weights, boneBindings, texture and Deform tracks remain independent per attachment.
   */
  meshSourceId?: string;
  /** Flat local-space positions. */
  meshVertices?: number[];
  /** Triangulation output — indices into meshVertices. */
  meshTriangles?: number[];
  meshUVs?: number[];
  /**
   * Indices of the boundary vertices in walk order (format v2). Everything
   * else is an interior (Steiner) vertex. When absent on an existing mesh,
   * the boundary is inferred from triangles without rewriting source. New
   * triangulation without a hull treats all supplied vertices as the boundary.
   */
  meshHull?: number[];

  // --- Clipping (polygon; clips subsequent slots until endSlotId) ---
  /** Where the clip STOPS (exclusive); null = through the last slot. */
  endSlotId?: string | null;

  /**
   * Skinning weights — interleaved PER VERTEX (mesh) / per corner (region):
   *   [count, boneIndex0, weight0, boneIndex1, weight1, ...]
   *
   * boneIndex refers to the index in SkeletonData.bones (topologically sorted) —
   * the SAME index space as SkeletonPose.worldMatrices. No strings, no UUID
   * lookups in the skinning loop. Skeleton.rebuild() re-maps these indices when
   * structural edits shift the index space.
   *
   * A vertex with no weight entry is rigid-bound to its slot's bone.
   */
  weights?: number[];
  /** Native schema 5: frozen attachment-local -> bone-local bind transforms.
   * Absent means identity binding. Bone identities survive sorting.
   */
  boneBindings?: { boneId: string; matrix: number[] }[];
}

export interface SkinData {
  name: string;
  /** slotId -> attachmentId shown for that slot. */
  attachments: Record<string, string>;
}

export type MarkerKind = 'point' | 'socket' | 'spawnPoint' | 'hitbox' | 'hurtbox' | 'trigger';
export type MarkerShape =
  | { type: 'rectangle'; width: number; height: number }
  | { type: 'polygon'; vertices: number[] };
interface MarkerBase {
  id: string;
  name: string;
  boneId: string;
  transform: Transform;
}
export type MarkerData =
  | (MarkerBase & { kind: 'point' | 'socket' | 'spawnPoint' })
  | (MarkerBase & { kind: 'hitbox' | 'hurtbox' | 'trigger'; shape: MarkerShape });

export interface SkeletonData {
  /** Native schema 4; absent means no authored runtime markers. */
  markers?: MarkerData[];
  /**
   * ALWAYS stored in topological order (parents before children).
   * The array index IS the bone index used by the FK solver and by attachment
   * weights. Structural edits re-sort this array via Skeleton.rebuild().
   */
  bones: BoneData[];
  /** Array order defines the DEFAULT draw order. */
  slots: SlotData[];
  attachments: AttachmentData[];
  /** Sorted by `order` at load/normalization time. */
  ikConstraints: IKConstraintData[];
  skins: SkinData[];
  activeSkin: string;
}
