import { paintInfluence, validateHull, validateMeshTopology } from '@limber/mesh';
import { triangulateMesh } from '@limber/mesh/triangulate';
export { triangulateMesh } from '@limber/mesh/triangulate';
import type { AttachmentData, SkeletonData, Animation } from '@limber/core';
import { uuid } from '@limber/core';
import type { EditorEngine } from '../engine/EditorEngine';
import type { Command } from '../history/history';
import { regionOf, type AttachmentTarget } from './attachmentCommands';
import { applyRigSnapshot, captureRig, prepareRigEdit, type RigSnapshot } from './rigEdits';

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
function meshBoundary(mesh: {
  meshVertices?: number[];
  meshHull?: number[];
  meshTriangles?: number[];
}): number[] {
  return (
    mesh.meshHull ??
    (mesh.meshTriangles?.length
      ? validateMeshTopology({ vertices: mesh.meshVertices!, triangles: mesh.meshTriangles })
      : Array.from({ length: (mesh.meshVertices?.length ?? 0) / 2 }, (_, i) => i))
  );
}

export function pointInMeshHull(
  mesh: { meshVertices?: number[]; meshHull?: number[]; meshTriangles?: number[] },
  x: number,
  y: number,
): boolean {
  const vs = mesh.meshVertices ?? [];
  const ring = meshBoundary(mesh);
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
  if (
    ![p.x, p.y, p.width, p.height].every(Number.isFinite) ||
    p.width <= 0 ||
    p.height <= 0 ||
    ![p.cols, p.rows].every((value) => Number.isInteger(value) && value >= 1) ||
    (p.cols + 1) * (p.rows + 1) > 100000
  ) {
    throw new Error(
      'Grid needs finite positive dimensions, integer subdivisions and at most 100000 vertices.',
    );
  }
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
    triangles: triangulateMesh(
      points,
      Array.from({ length: n }, (_, i) => i),
    ),
    hull: Array.from({ length: n }, (_, i) => i),
  };
}

/** Drops near-duplicate consecutive hull points (cdt2d degeneracy guard). */
export function dedupeHull(points: number[], minDist = 0.01): number[] {
  const out: number[] = [];
  for (let i = 0; i < points.length; i += 2) {
    const prev = out.length - 2;
    const far = prev < 0 || Math.hypot(points[i]! - out[prev]!, points[i + 1]! - out[prev + 1]!) >= minDist;
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
  const row = Array.from({ length: entry.count }, (_, i) => ({
    boneIndex: weights[entry.start + 1 + i * 2]!,
    weight: weights[entry.start + 2 + i * 2]!,
  }));
  const painted = paintInfluence(row, boneIndex, t, slotBoneIndex);
  const replacement = [painted.length, ...painted.flatMap((item) => [item.boneIndex, item.weight])];
  return [
    ...weights.slice(0, entry.start),
    ...replacement,
    ...weights.slice(entry.start + 1 + entry.count * 2),
  ];
}

/** Weight (0..1) a vertex gives to `boneIndex` — 0 when unweighted/absent. */
export function vertexWeightOf(
  w: number[] | undefined,
  vertexIndex: number,
  boneIndex: number,
  fallbackBoneIndex?: number,
): number {
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
abstract class MeshEditCommand implements Command {
  abstract readonly label: string;
  private before: RigSnapshot | null = null;
  private after: RigSnapshot | null = null;
  constructor(protected engine: EditorEngine) {}
  protected abstract edit(data: SkeletonData, animations: Animation[]): void;
  do(): void {
    if (this.after) {
      applyRigSnapshot(this.engine, this.after);
      return;
    }
    const before = captureRig(this.engine);
    const after = prepareRigEdit(this.engine, (data, animations) => this.edit(data, animations));
    applyRigSnapshot(this.engine, after);
    this.before = before;
    this.after = after;
  }
  undo(): void {
    if (this.before) applyRigSnapshot(this.engine, this.before);
  }
}

export function insertMesh(
  data: SkeletonData,
  slotId: string,
  target: AttachmentTarget,
  attachment: AttachmentData,
): void {
  const slot = data.slots.find((item) => item.id === slotId);
  if (!slot) throw new Error('Mesh slot no longer exists.');
  const copy = structuredClone(attachment),
    names = new Set(data.attachments.map((item) => item.name));
  let suffix = 2;
  while (names.has(copy.name)) copy.name = attachment.name + suffix++;
  if (target === 'default') slot.defaultAttachmentId = copy.id;
  else {
    const skin = data.skins.find((item) => item.name === data.activeSkin);
    if (!skin) throw new Error('Select an active skin before assigning a mesh to it.');
    skin.attachments[slotId] = copy.id;
  }
  data.attachments.push(copy);
}

export class AddMeshCommand extends MeshEditCommand {
  readonly attachmentId = uuid();
  readonly label = 'Add Grid Mesh';
  private attachment: AttachmentData;
  constructor(
    engine: EditorEngine,
    readonly slotId: string,
    params: MeshGridParams,
    private target: AttachmentTarget = 'default',
    name?: string,
  ) {
    super(engine);
    const grid = buildGridMesh(params);
    this.attachment = {
      id: this.attachmentId,
      name:
        name ?? engine.document.assetManifest[params.textureId]?.name.replace(/\.[a-z0-9]+$/i, '') ?? 'mesh',
      type: 'mesh',
      textureId: params.textureId,
      meshVertices: grid.vertices,
      meshTriangles: grid.triangles,
      meshUVs: grid.uvs,
      meshHull: grid.hull,
    };
  }
  protected edit(data: SkeletonData): void {
    insertMesh(data, this.slotId, this.target, this.attachment);
  }
}

/** Converts a shown region to a validated hull mesh without discarding the region. */
export class CreateHullMeshCommand extends MeshEditCommand {
  readonly attachmentId = uuid();
  readonly label = 'Create Hull Mesh';
  private attachment: AttachmentData;
  constructor(
    engine: EditorEngine,
    readonly slotId: string,
    hullLocal: number[],
    private target: AttachmentTarget = 'default',
    name?: string,
  ) {
    super(engine);
    const data = engine.skeleton.data,
      slot = data.slots.find((item) => item.id === slotId);
    if (!slot) throw new Error('Hull mesh slot no longer exists.');
    const slotIndex = engine.skeleton.slotIndexMap.get(slotId)!;
    const shownId = engine.skeleton.pose.slots[slotIndex]!.attachmentId ?? slot.defaultAttachmentId;
    const region = data.attachments.find((item) => item.id === shownId);
    if (!region || region.type !== 'region' || !region.vertices)
      throw new Error('Hull creation requires a region attachment.');
    const mesh = buildHullMesh(dedupeHull(hullLocal), regionOf(region));
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
  protected edit(data: SkeletonData): void {
    insertMesh(data, this.slotId, this.target, this.attachment);
  }
}

function editablePolygon(data: SkeletonData, id: string): AttachmentData {
  const mesh = data.attachments.find((item) => item.id === id);
  if (!mesh?.meshVertices) throw new Error('Editable mesh no longer exists.');
  return mesh;
}
function clearDeforms(animations: Animation[], id: string): void {
  for (const animation of animations)
    animation.timelines = animation.timelines.filter(
      (timeline) => timeline.kind !== 'deform' || timeline.attachmentId !== id,
    );
}
function retriangulate(mesh: AttachmentData): void {
  mesh.meshHull ??= Array.from({ length: mesh.meshVertices!.length / 2 }, (_, i) => i);
  mesh.meshTriangles = triangulateMesh(mesh.meshVertices!, mesh.meshHull);
}

/** Topology and deform invalidation are prepared on the same private snapshot. */
export class AddMeshVertexCommand extends MeshEditCommand {
  readonly label = 'Add Mesh Vertex';
  constructor(
    engine: EditorEngine,
    private attachmentId: string,
    private x: number,
    private y: number,
  ) {
    super(engine);
  }
  protected edit(data: SkeletonData, animations: Animation[]): void {
    const mesh = editablePolygon(data, this.attachmentId);
    if (![this.x, this.y].every(Number.isFinite) || !pointInMeshHull(mesh, this.x, this.y))
      throw new Error('New vertices must be inside the mesh hull.');
    const uv = uvAtPoint(mesh, this.x, this.y);
    // Resolve the old implicit boundary before appending an interior point.
    mesh.meshHull = meshBoundary(mesh);
    mesh.meshVertices!.push(this.x, this.y);
    mesh.meshUVs?.push(uv.u, uv.v);
    mesh.weights?.push(0);
    retriangulate(mesh);
    clearDeforms(animations, this.attachmentId);
  }
}
export class RemoveMeshVertexCommand extends MeshEditCommand {
  readonly label = 'Delete Mesh Vertex';
  constructor(
    engine: EditorEngine,
    private attachmentId: string,
    private vertexIndex: number,
  ) {
    super(engine);
  }
  protected edit(data: SkeletonData, animations: Animation[]): void {
    const mesh = editablePolygon(data, this.attachmentId),
      n = mesh.meshVertices!.length / 2,
      i = this.vertexIndex;
    if (!Number.isInteger(i) || i < 0 || i >= n) throw new Error('Mesh vertex no longer exists.');
    if (n <= 3) return;
    mesh.meshHull = meshBoundary(mesh);
    mesh.meshVertices!.splice(i * 2, 2);
    mesh.meshUVs?.splice(i * 2, 2);
    if (mesh.weights) {
      const entry = weightEntryAt(mesh.weights, i)!;
      mesh.weights.splice(entry.start, 1 + entry.count * 2);
    }
    mesh.meshHull = mesh.meshHull
      .filter((index) => index !== i)
      .map((index) => (index > i ? index - 1 : index));
    if (mesh.meshHull.length < 3) throw new Error('The hull must retain at least three vertices.');
    retriangulate(mesh);
    clearDeforms(animations, this.attachmentId);
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
    if (!a || !a.meshVertices) {
      // Any polygon-bearing attachment (mesh/bbox/clipping).
      throw new Error(`SetMeshVerticesCommand: mesh "${this.attachmentId}" not found.`);
    }
    return a;
  }

  get changed(): boolean {
    return (
      this.before !== null &&
      this.after !== null &&
      JSON.stringify(this.before) !== JSON.stringify(this.after)
    );
  }

  open(): void {
    this.before = [...this.mesh().meshVertices!];
  }

  update(vertexIndex: number, x: number, y: number): void {
    const mesh = this.mesh(),
      candidate = [...mesh.meshVertices!];
    if (!Number.isInteger(vertexIndex) || vertexIndex < 0 || vertexIndex * 2 + 1 >= candidate.length)
      throw new Error('Mesh vertex no longer exists.');
    candidate[vertexIndex * 2] = x;
    candidate[vertexIndex * 2 + 1] = y;
    if (mesh.type === 'mesh')
      validateMeshTopology({
        vertices: candidate,
        triangles: mesh.meshTriangles!,
        uvs: mesh.meshUVs,
        hull: mesh.meshHull,
      });
    else validateHull(candidate, mesh.meshHull);
    mesh.meshVertices = candidate;
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
    if (!a || !a.meshVertices) {
      // Any polygon-bearing attachment (mesh/bbox/clipping).
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
  update(
    vertexIndex: number,
    boneIndex: number,
    slotBoneIndex: number,
    amount: number,
    mode: BrushMode = 'add',
  ): void {
    const a = this.mesh();
    if (
      !Number.isInteger(vertexIndex) ||
      vertexIndex < 0 ||
      vertexIndex >= a.meshVertices!.length / 2 ||
      ![boneIndex, slotBoneIndex].every(
        (index) => Number.isInteger(index) && index >= 0 && index < this.engine.skeleton.data.bones.length,
      ) ||
      !Number.isFinite(amount)
    )
      throw new Error('Invalid weight brush input.');
    const weights = a.weights ?? this.baseline();
    if (a.boneBindings && [boneIndex, slotBoneIndex].some((index) => !a.boneBindings!.some((binding) => binding.boneId === this.engine.skeleton.data.bones[index]!.id))) {
      throw new Error('Bind the target and slot bones before painting this mesh.');
    }
    const current = vertexWeightOf(weights, vertexIndex, boneIndex, slotBoneIndex);
    let next = current;
    if (mode === 'set') next = Math.max(current, Math.min(1, amount));
    else if (mode === 'smooth') {
      const nbrs = this.adjacency?.[vertexIndex] ?? [];
      if (nbrs.length > 0) {
        let sum = 0;
        for (const n of nbrs) sum += vertexWeightOf(weights, n, boneIndex, slotBoneIndex);
        next = current + (sum / nbrs.length - current) * Math.min(1, amount);
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
