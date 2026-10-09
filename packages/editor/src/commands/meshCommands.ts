import { paintInfluence } from '@limber/mesh';
import cdt2d from 'cdt2d';
import type { AttachmentData, SkeletonData } from '@limber/core';
import { uuid } from '@limber/core';
import type { EditorEngine } from '../engine/EditorEngine';
import type { Command } from '../history/history';
import { regionOf, type AttachmentTarget } from './attachmentCommands';
import { restoreDeformTimelines, stripDeformTimelines, type DeformTimelineCapture } from './animationCommands';

// ---------------- triangulation ----------------

/**
 * Constrained Delaunay triangulation over ALL vertices — hull ring AND
 * interior (Steiner) points. `hull` absent ⇒ every vertex is a boundary
 * vertex in index order (pre-v2 documents). Returns a flat index triple
 * list; degenerate input yields [].
 */
export function triangulateMesh(vertices: number[], hull?: number[]): number[] {
  const n = vertices.length / 2;
  const ring = hull ?? Array.from({ length: n }, (_, i) => i);
  if (ring.length < 3 || n < 3) return [];
  const positions: number[][] = new Array(n);
  for (let i = 0; i < n; i++) positions[i] = [vertices[i * 2]!, vertices[i * 2 + 1]!];
  const edges: number[][] = [];
  for (let i = 0; i < ring.length; i++) edges.push([ring[i]!, ring[(i + 1) % ring.length]!]);
  const tris = cdt2d(positions, edges);
  const out: number[] = [];
  for (const t of tris) out.push(t[0]!, t[1]!, t[2]!);
  return out;
}

/** Barycentric UV lookup — used when inserting an interior vertex. */
export function uvAtPoint(
  mesh: { meshVertices?: number[]; meshTriangles?: number[]; meshUVs?: number[] },
  x: number,
  y: number,
): { u: number; v: number } {
  const vs = mesh.meshVertices ?? [];
  const us = mesh.meshUVs ?? [];
  const ts = mesh.meshTriangles ?? [];
  for (let t = 0; t < ts.length; t += 3) {
    const i0 = ts[t]!;
    const i1 = ts[t + 1]!;
    const i2 = ts[t + 2]!;
    const x0 = vs[i0 * 2]!;
    const y0 = vs[i0 * 2 + 1]!;
    const x1 = vs[i1 * 2]!;
    const y1 = vs[i1 * 2 + 1]!;
    const x2 = vs[i2 * 2]!;
    const y2 = vs[i2 * 2 + 1]!;
    const d = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
    if (Math.abs(d) < 1e-12) continue;
    const w0 = ((y1 - y2) * (x - x2) + (x2 - x1) * (y - y2)) / d;
    const w1 = ((y2 - y0) * (x - x2) + (x0 - x2) * (y - y2)) / d;
    const w2 = 1 - w0 - w1;
    if (w0 >= -1e-6 && w1 >= -1e-6 && w2 >= -1e-6) {
      return {
        u: w0 * (us[i0 * 2] ?? 0) + w1 * (us[i1 * 2] ?? 0) + w2 * (us[i2 * 2] ?? 0),
        v: w0 * (us[i0 * 2 + 1] ?? 0) + w1 * (us[i1 * 2 + 1] ?? 0) + w2 * (us[i2 * 2 + 1] ?? 0),
      };
    }
  }
  return { u: 0, v: 0 }; // Outside every triangle — caller guards against this.
}

/** Point-in-polygon (ray cast) over the hull ring — interior-vertex guard. */
export function pointInMeshHull(mesh: { meshVertices?: number[]; meshHull?: number[] }, x: number, y: number): boolean {
  const vs = mesh.meshVertices ?? [];
  const ring = mesh.meshHull ?? Array.from({ length: vs.length / 2 }, (_, i) => i);
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = vs[ring[i]! * 2]!;
    const yi = vs[ring[i]! * 2 + 1]!;
    const xj = vs[ring[j]! * 2]!;
    const yj = vs[ring[j]! * 2 + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

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
 * quad (TL,TR,BR / TL,BR,BL) per cell. `hull` is the lattice perimeter in
 * walk order for cdt2d re-triangulation after vertex edits.
 */
export function buildGridMesh(p: MeshGridParams): {
  vertices: number[];
  uvs: number[];
  triangles: number[];
  hull: number[];
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
  // Perimeter walk: top row →, right col ↓, bottom row ←, left col ↑.
  const w = p.cols + 1;
  const h = p.rows + 1;
  const hull: number[] = [];
  for (let c = 0; c < w; c++) hull.push(c); // top
  for (let r = 1; r < h; r++) hull.push(r * w + p.cols); // right
  for (let c = w - 2; c >= 0; c--) hull.push((h - 1) * w + c); // bottom
  for (let r = h - 2; r >= 1; r--) hull.push(r * w); // left
  return { vertices, uvs, triangles, hull };
}

/**
 * Hull mesh from user-drawn points: UVs map linearly over the source region's
 * axis-aligned quad, hull ring = the drawn order, triangles via cdt2d.
 */
export function buildHullMesh(
  points: number[],
  bounds: { x: number; y: number; width: number; height: number },
): { vertices: number[]; uvs: number[]; triangles: number[]; hull: number[] } {
  const n = points.length / 2;
  const left = bounds.x - bounds.width / 2;
  const top = bounds.y - bounds.height / 2;
  const uvs: number[] = [];
  for (let i = 0; i < n; i++) {
    uvs.push((points[i * 2]! - left) / bounds.width, (points[i * 2 + 1]! - top) / bounds.height);
  }
  return {
    vertices: [...points],
    uvs,
    triangles: triangulateMesh(points, Array.from({ length: n }, (_, i) => i)),
    hull: Array.from({ length: n }, (_, i) => i),
  };
}

/** Drops near-duplicate consecutive hull points (cdt2d degeneracy guard). */
export function dedupeHull(points: number[], minDist = 0.01): number[] {
  const out: number[] = [];
  for (let i = 0; i < points.length; i += 2) {
    const prev = out.length - 2;
    const far =
      prev < 0 || Math.hypot(points[i]! - out[prev]!, points[i + 1]! - out[prev + 1]!) >= minDist;
    if (far) out.push(points[i]!, points[i + 1]!);
  }
  // ...and the wrap-around pair.
  while (out.length >= 6) {
    const firstX = out[0]!;
    const firstY = out[1]!;
    const lastX = out[out.length - 2]!;
    const lastY = out[out.length - 1]!;
    if (Math.hypot(firstX - lastX, firstY - lastY) < minDist) out.splice(out.length - 2, 2);
    else break;
  }
  return out;
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
 * preserving the relative distribution of other influences. A vertex with weight 1 on the
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
  const row = Array.from({ length: entry.count }, (_, i) => ({ boneIndex: weights[entry.start + 1 + i * 2]!, weight: weights[entry.start + 2 + i * 2]! }));
  const painted = paintInfluence(row, boneIndex, t, slotBoneIndex);
  const replacement = [painted.length, ...painted.flatMap((item) => [item.boneIndex, item.weight])];
  return [...weights.slice(0, entry.start), ...replacement, ...weights.slice(entry.start + 1 + entry.count * 2)];
}

/** Weight (0..1) a vertex gives to `boneIndex` — 0 when unweighted/absent. */
export function vertexWeightOf(w: number[] | undefined, vertexIndex: number, boneIndex: number, fallbackBoneIndex?: number): number {
  if (!w) return boneIndex === fallbackBoneIndex ? 1 : 0;
  const entry = weightEntryAt(w, vertexIndex);
  if (!entry) return 0;
  if (entry.count === 0) return boneIndex === fallbackBoneIndex ? 1 : 0;
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
      meshHull: grid.hull,
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
 * Converts a slot's region attachment into a hull mesh from user-drawn
 * points (bone-local). The region itself stays in the document, unassigned —
 * undo restores it as the slot's attachment.
 */
export class CreateHullMeshCommand implements Command {
  readonly attachmentId: string;
  private _label = 'Create Hull Mesh';
  private named = false;
  private readonly attachment: AttachmentData;
  private beforeSlotValue: string | null | undefined;

  constructor(
    private engine: EditorEngine,
    readonly slotId: string,
    hullLocal: number[],
    private target: AttachmentTarget = 'default',
    name?: string,
  ) {
    const data = engine.skeleton.data;
    const slot = data.slots.find((s) => s.id === slotId);
    if (!slot) throw new Error(`CreateHullMeshCommand: slot "${slotId}" not found.`);
    const slotIndex = engine.skeleton.slotIndexMap.get(slotId)!;
    const shownId = engine.skeleton.pose.slots[slotIndex]!.attachmentId ?? slot.defaultAttachmentId;
    const region = data.attachments.find((a) => a.id === shownId);
    if (!region || region.type !== 'region' || !region.vertices) {
      throw new Error('CreateHullMeshCommand: the slot must currently show a region attachment.');
    }
    const points = dedupeHull(hullLocal);
    if (points.length < 6) throw new Error('CreateHullMeshCommand: a hull needs at least 3 points.');
    const mesh = buildHullMesh(points, regionOf(region));
    this.attachmentId = uuid();
    this.attachment = {
      id: this.attachmentId,
      name: name ?? region.name,
      type: 'mesh',
      textureId: region.textureId,
      meshVertices: mesh.vertices,
      meshTriangles: mesh.triangles,
      meshUVs: mesh.uvs,
      meshHull: mesh.hull,
    };
  }

  get label(): string {
    return this._label;
  }

  do(): void {
    const data = this.engine.skeleton.data;
    const slot = data.slots.find((s) => s.id === this.slotId);
    if (!slot) throw new Error(`CreateHullMeshCommand: slot "${this.slotId}" not found.`);
    if (!this.named) {
      const names = new Set(data.attachments.map((a) => a.name));
      const base = this.attachment.name;
      let unique = base;
      let i = 2;
      while (names.has(unique)) unique = base + i++;
      this.attachment.name = unique;
      this._label = `Create Hull Mesh ${unique}`;
      this.named = true;
    }
    if (this.beforeSlotValue === undefined) {
      this.beforeSlotValue =
        this.target === 'default'
          ? slot.defaultAttachmentId
          : data.skins.find((s) => s.name === data.activeSkin)?.attachments[this.slotId];
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

/** Snapshot of every topology-relevant mesh field. */
interface MeshTopologySnapshot {
  vertices: number[];
  triangles: number[];
  uvs: number[];
  hull: number[] | undefined;
  weights: number[] | undefined;
}

function topologyOf(a: AttachmentData): MeshTopologySnapshot {
  return {
    vertices: [...(a.meshVertices ?? [])],
    triangles: [...(a.meshTriangles ?? [])],
    uvs: [...(a.meshUVs ?? [])],
    hull: a.meshHull ? [...a.meshHull] : undefined,
    weights: a.weights ? [...a.weights] : undefined,
  };
}

function applyTopology(a: AttachmentData, snap: MeshTopologySnapshot): void {
  a.meshVertices = [...snap.vertices];
  a.meshTriangles = [...snap.triangles];
  a.meshUVs = [...snap.uvs];
  a.meshHull = snap.hull ? [...snap.hull] : undefined;
  a.weights = snap.weights ? [...snap.weights] : undefined;
}

/** Rewrites the mesh's triangles from its vertices + hull ring. */
function retriangulate(a: AttachmentData): void {
  a.meshHull = a.meshHull ?? Array.from({ length: (a.meshVertices?.length ?? 0) / 2 }, (_, i) => i);
  a.meshTriangles = triangulateMesh(a.meshVertices!, a.meshHull);
}

/**
 * Adds an interior (Steiner) vertex and re-triangulates. UV comes from the
 * containing triangle (barycentric). Vertex-count changes invalidate deform
 * keys — they are stripped and restored atomically with the edit.
 */
export class AddMeshVertexCommand implements Command {
  readonly label = 'Add Mesh Vertex';
  private before: MeshTopologySnapshot | null = null;
  private deformCaptures: DeformTimelineCapture[] = [];

  constructor(
    private engine: EditorEngine,
    private attachmentId: string,
    private x: number,
    private y: number,
  ) {}

  private mesh(): AttachmentData {
    const a = this.engine.skeleton.data.attachments.find((x) => x.id === this.attachmentId);
    if (!a || !a.meshVertices) { // Any polygon-bearing attachment (mesh/bbox/clipping).
      throw new Error(`AddMeshVertexCommand: mesh "${this.attachmentId}" not found.`);
    }
    return a;
  }

  do(): void {
    const a = this.mesh();
    if (this.before === null) {
      this.before = topologyOf(a);
      this.deformCaptures = stripDeformTimelines(this.engine, this.attachmentId);
    } else {
      stripDeformTimelines(this.engine, this.attachmentId); // Redo: strip again, keep first capture.
    }
    const uv = uvAtPoint(a, this.x, this.y);
    a.meshVertices!.push(this.x, this.y);
    a.meshUVs!.push(uv.u, uv.v);
    if (a.weights) a.weights.push(0); // Rigid entry — count 0 influences.
    retriangulate(a);
    this.engine.skeleton.rebuild();
  }

  undo(): void {
    const a = this.mesh();
    if (this.before) applyTopology(a, this.before);
    restoreDeformTimelines(this.deformCaptures);
    this.engine.skeleton.rebuild();
  }
}

/**
 * Removes one vertex (hull or interior). Hull indices are remapped, the
 * vertex's weight entry dropped, and deform keys stripped (count changed).
 */
export class RemoveMeshVertexCommand implements Command {
  readonly label = 'Delete Mesh Vertex';
  private before: MeshTopologySnapshot | null = null;
  private deformCaptures: DeformTimelineCapture[] = [];

  constructor(
    private engine: EditorEngine,
    private attachmentId: string,
    private vertexIndex: number,
  ) {}

  private mesh(): AttachmentData {
    const a = this.engine.skeleton.data.attachments.find((x) => x.id === this.attachmentId);
    if (!a || !a.meshVertices) { // Any polygon-bearing attachment (mesh/bbox/clipping).
      throw new Error(`RemoveMeshVertexCommand: mesh "${this.attachmentId}" not found.`);
    }
    return a;
  }

  do(): void {
    const a = this.mesh();
    if (a.meshVertices!.length / 2 <= 3) return; // Never drop below one triangle.
    if (this.before === null) {
      this.before = topologyOf(a);
      this.deformCaptures = stripDeformTimelines(this.engine, this.attachmentId);
    } else {
      stripDeformTimelines(this.engine, this.attachmentId); // Redo: strip again, keep first capture.
    }
    const i = this.vertexIndex;
    a.meshVertices!.splice(i * 2, 2);
    a.meshUVs!.splice(i * 2, 2);
    if (a.weights) {
      const entry = weightEntryAt(a.weights, i);
      if (entry) a.weights.splice(entry.start, 1 + entry.count * 2);
    }
    a.meshHull = (a.meshHull ?? Array.from({ length: (a.meshVertices!.length / 2) + 1 }, (_, k) => k))
      .filter((idx) => idx !== i)
      .map((idx) => (idx > i ? idx - 1 : idx));
    if (a.meshHull.length < 3) a.meshHull = undefined; // Degenerate ring — all-hull fallback.
    retriangulate(a);
    this.engine.skeleton.rebuild();
  }

  undo(): void {
    const a = this.mesh();
    if (this.before) applyTopology(a, this.before);
    restoreDeformTimelines(this.deformCaptures);
    this.engine.skeleton.rebuild();
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
    if (!a || !a.meshVertices) { // Any polygon-bearing attachment (mesh/bbox/clipping).
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

/** Weight brush behavior (§5.3 weights tool). */
export type BrushMode = 'add' | 'set' | 'smooth';

/**
 * Continuous weight-paint stroke (§5.3): update() accumulates weight toward
 * the target bone on the nearest vertex; ONE undo step per stroke. Painting
 * CREATES the weights array when absent (all-rigid baseline: one [0] per
 * vertex — "no influences" per DESIGN.md §3.1).
 *
 * Modes: `add` accumulates (falloff-scaled dabs), `set` raises to the dab
 * amount, `smooth` relaxes toward the average of the vertex's mesh neighbors
 * (adjacency passed to open(), built once per stroke from meshTriangles).
 */
export class PaintWeightsCommand implements Command {
  readonly label = 'Paint Weights';
  private before: number[] | null = null;
  private after: number[] | null = null;
  private adjacency: number[][] | null = null;

  constructor(
    private engine: EditorEngine,
    private attachmentId: string,
  ) {}

  private mesh(): AttachmentData {
    const a = this.engine.skeleton.data.attachments.find((x) => x.id === this.attachmentId);
    if (!a || !a.meshVertices) { // Any polygon-bearing attachment (mesh/bbox/clipping).
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

  open(adjacency?: number[][]): void {
    const a = this.mesh();
    this.before = a.weights ? [...a.weights] : null;
    this.adjacency = adjacency ?? null;
  }

  /**
   * Applies one dab of `amount` (already falloff-scaled by the caller) toward
   * `boneIndex` on `vertexIndex`.
   */
  update(vertexIndex: number, boneIndex: number, slotBoneIndex: number, amount: number, mode: BrushMode = 'add'): void {
    const a = this.mesh();
    if (!Number.isInteger(vertexIndex) || vertexIndex < 0 || vertexIndex >= a.meshVertices!.length / 2 ||
        ![boneIndex, slotBoneIndex].every((index) => Number.isInteger(index) && index >= 0 && index < this.engine.skeleton.data.bones.length) ||
        !Number.isFinite(amount)) throw new Error('Invalid weight brush input.');
    const weights = a.weights ?? this.baseline();
    const current = vertexWeightOf(weights, vertexIndex, boneIndex, slotBoneIndex);
    let next = current;
    if (mode === 'set') next = Math.max(current, Math.min(1, amount));
    else if (mode === 'smooth') {
      const nbrs = this.adjacency?.[vertexIndex] ?? [];
      if (nbrs.length > 0) {
        let sum = 0;
        for (const n of nbrs) sum += vertexWeightOf(weights, n, boneIndex, slotBoneIndex);
        next = current + ((sum / nbrs.length - current) * Math.min(1, amount));
      }
    } else next = current + amount;
    a.weights = setVertexWeight(weights, vertexIndex, boneIndex, next, slotBoneIndex);
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

/** Per-vertex neighbor lists from a triangle index list (smooth brush). */
export function meshAdjacency(triangles: number[]): number[][] {
  const neighbors: number[][] = [];
  const add = (a: number, b: number): void => {
    (neighbors[a] ??= []).push(b);
    (neighbors[b] ??= []).push(a);
  };
  for (let t = 0; t < triangles.length; t += 3) {
    add(triangles[t]!, triangles[t + 1]!);
    add(triangles[t + 1]!, triangles[t + 2]!);
    add(triangles[t + 2]!, triangles[t]!);
  }
  // Shared edges list a neighbor once per adjacent triangle — dedupe so the
  // smooth brush averages unique neighbors, not edge multiplicity.
  return neighbors.map((list) => [...new Set(list)]);
}
