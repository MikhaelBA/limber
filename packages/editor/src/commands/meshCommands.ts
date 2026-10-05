import type { AttachmentData, SkeletonData } from '@limber/core';
import { uuid } from '@limber/core';
import type { EditorEngine } from '../engine/EditorEngine';
import type { Command } from '../history/history';
import { type AttachmentTarget } from './attachmentCommands';

// ---------------- grid mesh generation ----------------

export interface MeshGridParams {
  textureId: string;
  /** Mesh CENTER, local to the slot's bone (y-down). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Cell subdivisions — cols=rows=2 gives a 3×3 vertex lattice. */
  cols: number;
  rows: number;
}

/**
 * Regular grid mesh: vertices row-major (matching the region corner order
 * TL→BR), UVs top-left origin, and the same triangle pattern as the region
 * quad (TL,TR,BR / TL,BR,BL) per cell. Arbitrary polygon editing + earcut
 * triangulation land in a later Phase 5 chunk.
 */
export function buildGridMesh(p: MeshGridParams): {
  vertices: number[];
  uvs: number[];
  triangles: number[];
} {
  const vertices: number[] = [];
  const uvs: number[] = [];
  for (let r = 0; r <= p.rows; r++) {
    for (let c = 0; c <= p.cols; c++) {
      const u = p.cols === 0 ? 0 : c / p.cols;
      const v = p.rows === 0 ? 0 : r / p.rows;
      vertices.push(p.x - p.width / 2 + u * p.width, p.y - p.height / 2 + v * p.height);
      uvs.push(u, v);
    }
  }
  const triangles: number[] = [];
  for (let r = 0; r < p.rows; r++) {
    for (let c = 0; c < p.cols; c++) {
      const i0 = r * (p.cols + 1) + c;
      const i1 = i0 + 1;
      const i2 = i0 + p.cols + 1;
      const i3 = i2 + 1;
      triangles.push(i0, i1, i3, i0, i3, i2);
    }
  }
  return { vertices, uvs, triangles };
}

// ---------------- weight array helpers ----------------

/** Where vertex `vertexIndex`'s weights live in the interleaved array. */
export function weightEntryAt(w: number[], vertexIndex: number): { start: number; count: number } | null {
  let p = 0;
  for (let v = 0; v <= vertexIndex; v++) {
    if (p >= w.length) return null;
    const count = w[p]! | 0;
    if (v === vertexIndex) return { start: p, count };
    p += 1 + count * 2;
  }
  return null;
}

/**
 * Rewrites one vertex's weights to blend `t` toward `boneIndex` (0..1),
 * the remainder staying on the slot's bone. A vertex with weight 1 on the
 * slot bone is exactly the "no weights" rigid case, expressed explicitly.
 */
export function setVertexWeight(
  weights: number[],
  vertexIndex: number,
  boneIndex: number,
  t: number,
  slotBoneIndex: number,
): number[] {
  const entry = weightEntryAt(weights, vertexIndex);
  if (!entry) return weights;
  const clamped = Math.min(1, Math.max(0, t));
  // Full weight (or painting the slot's own bone) collapses to one rigid entry.
  const replacement =
    boneIndex === slotBoneIndex || clamped >= 1
      ? [1, boneIndex, 1]
      : [2, slotBoneIndex, 1 - clamped, boneIndex, clamped];
  return [...weights.slice(0, entry.start), ...replacement, ...weights.slice(entry.start + 1 + entry.count * 2)];
}

/** Weight (0..1) a vertex gives to `boneIndex` — 0 when unweighted/absent. */
export function vertexWeightOf(w: number[] | undefined, vertexIndex: number, boneIndex: number): number {
  if (!w) return 0;
  const entry = weightEntryAt(w, vertexIndex);
  if (!entry) return 0;
  let p = entry.start + 1;
  for (let e = 0; e < entry.count; e++) {
    if ((w[p]! | 0) === boneIndex) return w[p + 1]!;
    p += 2;
  }
  return 0;
}

// ---------------- commands ----------------

/**
 * Creates a grid mesh attachment (no weights — rigid to the slot's bone until
 * painted) and assigns it to the slot, default or active-skin target.
 */
export class AddMeshCommand implements Command {
  readonly attachmentId: string;
  private _label = 'Add Grid Mesh';
  private named = false;
  private readonly attachment: AttachmentData;
  private beforeSlotValue: string | null | undefined;

  constructor(
    private engine: EditorEngine,
    readonly slotId: string,
    params: MeshGridParams,
    private target: AttachmentTarget = 'default',
    name?: string,
  ) {
    this.attachmentId = uuid();
    const grid = buildGridMesh(params);
    this.attachment = {
      id: this.attachmentId,
      name: name ?? 'mesh', // Uniquified at first do() from the texture name.
      type: 'mesh',
      textureId: params.textureId,
      meshVertices: grid.vertices,
      meshTriangles: grid.triangles,
      meshUVs: grid.uvs,
    };
  }

  get label(): string {
    return this._label;
  }

  do(): void {
    const data = this.engine.skeleton.data;
    const slot = data.slots.find((s) => s.id === this.slotId);
    if (!slot) throw new Error(`AddMeshCommand: slot "${this.slotId}" not found.`);
    if (!this.named) {
      const base =
        this.attachment.name !== 'mesh'
          ? this.attachment.name
          : this.engine.document.assetManifest[this.attachment.textureId]?.name.replace(/\.[a-z0-9]+$/i, '') ?? 'mesh';
      const names = new Set(data.attachments.map((a) => a.name));
      let unique = base;
      let i = 2;
      while (names.has(unique)) unique = base + i++;
      this.attachment.name = unique;
      this._label = `Add Grid Mesh ${unique}`;
      this.named = true;
    }
    if (this.beforeSlotValue === undefined) {
      this.beforeSlotValue =
        this.target === 'default' ? slot.defaultAttachmentId : data.skins.find((s) => s.name === data.activeSkin)?.attachments[this.slotId];
    }
    data.attachments.push(this.attachment);
    applySlotAssignment(data, this.slotId, this.target, this.attachmentId);
    this.engine.skeleton.rebuild();
  }

  undo(): void {
    const data = this.engine.skeleton.data;
    data.attachments = data.attachments.filter((a) => a.id !== this.attachmentId);
    if (this.beforeSlotValue !== undefined) {
      applySlotAssignment(data, this.slotId, this.target, this.beforeSlotValue ?? null);
    }
    this.engine.skeleton.rebuild();
  }
}

/** Slot assignment write shared by AddMesh (and reusable for future editors). */
function applySlotAssignment(data: SkeletonData, slotId: string, target: AttachmentTarget, id: string | null): void {
  const slot = data.slots.find((s) => s.id === slotId);
  if (!slot) return;
  if (target === 'default') {
    slot.defaultAttachmentId = id;
  } else {
    const skin = data.skins.find((s) => s.name === data.activeSkin);
    if (!skin) return;
    if (id === null) delete skin.attachments[slotId];
    else skin.attachments[slotId] = id;
  }
}

/**
 * Continuous drag of one mesh vertex (§5.3 lifecycle): update() writes bone-
 * LOCAL positions each pointermove; commit() snapshots; ONE undo step.
 */
export class SetMeshVerticesCommand implements Command {
  readonly label = 'Edit Mesh Vertex';
  private before: number[] | null = null;
  private after: number[] | null = null;

  constructor(
    private engine: EditorEngine,
    private attachmentId: string,
  ) {}

  private mesh(): AttachmentData {
    const a = this.engine.skeleton.data.attachments.find((x) => x.id === this.attachmentId);
    if (!a || a.type !== 'mesh' || !a.meshVertices) {
      throw new Error(`SetMeshVerticesCommand: mesh "${this.attachmentId}" not found.`);
    }
    return a;
  }

  get changed(): boolean {
    return this.before !== null && this.after !== null && JSON.stringify(this.before) !== JSON.stringify(this.after);
  }

  open(): void {
    this.before = [...this.mesh().meshVertices!];
  }

  update(vertexIndex: number, x: number, y: number): void {
    const vs = this.mesh().meshVertices!;
    if (vertexIndex * 2 + 1 >= vs.length) return;
    vs[vertexIndex * 2] = x;
    vs[vertexIndex * 2 + 1] = y;
  }

  commit(): void {
    this.after = [...this.mesh().meshVertices!];
  }

  do(): void {
    if (this.after) this.mesh().meshVertices = [...this.after];
  }

  undo(): void {
    if (this.before) this.mesh().meshVertices = [...this.before];
  }
}

/**
 * Continuous weight-paint stroke (§5.3): update() accumulates weight toward
 * the target bone on the nearest vertex; ONE undo step per stroke. Painting
 * CREATES the weights array when absent (all-rigid baseline: one [0] per
 * vertex — "no influences" per DESIGN.md §3.1).
 */
export class PaintWeightsCommand implements Command {
  readonly label = 'Paint Weights';
  private before: number[] | null = null;
  private after: number[] | null = null;

  constructor(
    private engine: EditorEngine,
    private attachmentId: string,
  ) {}

  private mesh(): AttachmentData {
    const a = this.engine.skeleton.data.attachments.find((x) => x.id === this.attachmentId);
    if (!a || a.type !== 'mesh' || !a.meshVertices) {
      throw new Error(`PaintWeightsCommand: mesh "${this.attachmentId}" not found.`);
    }
    return a;
  }

  /** All-rigid baseline for an unweighted attachment with n vertices. */
  private baseline(): number[] {
    return new Array(this.mesh().meshVertices!.length / 2).fill(0);
  }

  get changed(): boolean {
    // `before` is legitimately null when the attachment had NO weights yet —
    // compare the serialized forms instead of requiring a non-null before.
    return this.after !== null && JSON.stringify(this.before) !== JSON.stringify(this.after);
  }

  open(): void {
    const a = this.mesh();
    this.before = a.weights ? [...a.weights] : null;
  }

  /** Adds `strength` weight toward `boneIndex` on `vertexIndex` (clamped 0..1). */
  update(vertexIndex: number, boneIndex: number, slotBoneIndex: number, strength: number): void {
    const a = this.mesh();
    const weights = a.weights ?? this.baseline();
    const current = vertexWeightOf(weights, vertexIndex, boneIndex);
    a.weights = setVertexWeight(weights, vertexIndex, boneIndex, current + strength, slotBoneIndex);
  }

  commit(): void {
    this.after = this.mesh().weights ? [...this.mesh().weights!] : null;
  }

  do(): void {
    if (this.after) this.mesh().weights = [...this.after];
  }

  undo(): void {
    const a = this.mesh();
    a.weights = this.before ? [...this.before] : undefined; // Back to "no weights" = rigid.
  }
}
