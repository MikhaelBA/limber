import { describe, expect, it } from 'vitest';
import { updateSkinning } from '@limber/core';
import { EditorEngine } from '../src/engine/EditorEngine';
import {
  AddMeshCommand,
  AddMeshVertexCommand,
  buildGridMesh,
  buildHullMesh,
  CreateHullMeshCommand,
  dedupeHull,
  meshAdjacency,
  PaintWeightsCommand,
  pointInMeshHull,
  RemoveMeshVertexCommand,
  SetMeshVerticesCommand,
  setVertexWeight,
  triangulateMesh,
  uvAtPoint,
  vertexWeightOf,
  weightEntryAt,
} from '../src/commands/meshCommands';
import { AutoKeyDeformCommand, DeleteDeformKeyframeCommand, upsertDeformKeyframe } from '../src/commands/animationCommands';
import { AddSlotCommand } from '../src/commands/slotCommands';
import { AddBoneCommand } from '../src/commands/boneCommands';
import { AddAttachmentCommand, AddTextureCommand } from '../src/commands/attachmentCommands';
import { HistoryManager } from '../src/history/history';

const TEX = 'tex-1';

function setupSlot() {
  const engine = new EditorEngine();
  const rootId = engine.skeleton.data.bones[0]!.id;
  const slotCmd = new AddSlotCommand(engine, rootId);
  slotCmd.do();
  new AddTextureCommand(engine, TEX, 'spot.png').do();
  return { engine, rootId, slotId: slotCmd.slotId };
}

/** Slot + grid mesh + an active animation (for deform auto-key tests). */
function setupAnimatedMesh() {
  const { engine, slotId } = setupSlot();
  const add = new AddMeshCommand(engine, slotId, { textureId: TEX, x: 0, y: 0, width: 20, height: 10, cols: 2, rows: 2 });
  add.do();
  engine.document.animations.push({ name: 'a1', duration: 1, loop: true, timelines: [] });
  engine.setAnimation('a1');
  engine.mode = 'animate'; // tick() only applies timelines in animate mode.
  engine.tick(0);
  return { engine, slotId, meshId: add.attachmentId };
}

/** Narrowed view for asserting on deform keyframes. */
type DeformTimelineView = { kind: 'deform'; keyframes: { time: number; offsets: number[] | null }[] };

describe('buildGridMesh', () => {
  it('generates a 3x3-vertex lattice with 2 triangles per cell', () => {
    const g = buildGridMesh({ textureId: TEX, x: 0, y: 0, width: 20, height: 10, cols: 2, rows: 2 });
    expect(g.vertices).toHaveLength(18); // 9 vertices
    expect(g.uvs).toHaveLength(18);
    expect(g.triangles).toHaveLength(24); // 4 cells × 2 tris × 3 indices
    // Corners: TL(-10,-5); row-major ends at BR(10,5); center (0,0) is vertex 4.
    expect(g.vertices.slice(0, 2)).toEqual([-10, -5]);
    expect(g.vertices.slice(16, 18)).toEqual([10, 5]);
    expect(g.vertices.slice(12, 14)).toEqual([-10, 5]); // BL
    expect(g.vertices.slice(8, 10)).toEqual([0, 0]);
    // UVs top-left origin, v grows downward with y.
    expect(g.uvs.slice(0, 2)).toEqual([0, 0]);
    expect(g.uvs.slice(12, 14)).toEqual([0, 1]); // BL uv
    // Every index within vertex range.
    for (const i of g.triangles) expect(i).toBeLessThan(9);
  });
});

describe('weight helpers', () => {
  it('weightEntryAt locates each vertex span in the interleaved array', () => {
    // v0: [bone0@1], v1: [], v2: [bone0@0.5, bone1@0.5]
    const w = [1, 0, 1, 0, 2, 0, 0.5, 1, 0.5];
    expect(weightEntryAt(w, 0)).toEqual({ start: 0, count: 1 });
    expect(weightEntryAt(w, 1)).toEqual({ start: 3, count: 0 }); // v0's [count,bone,w] spans 3 slots
    expect(weightEntryAt(w, 2)).toEqual({ start: 4, count: 2 });
    expect(weightEntryAt(w, 3)).toBeNull();
  });

  it('setVertexWeight blends between the slot bone and the target', () => {
    const base = [0, 0, 0]; // two unweighted vertices
    const w1 = setVertexWeight(base, 0, 1, 0.25, 0);
    expect(w1).toEqual([2, 0, 0.75, 1, 0.25, 0, 0]); // v0 blended; v1/v2 stay [0] entries
    // Full weight collapses to a single rigid entry.
    const w2 = setVertexWeight(w1, 0, 1, 1, 0);
    expect(w2).toEqual([1, 1, 1, 0, 0]);
    // Painting the slot bone retains the other bone's remaining share.
    const w3 = setVertexWeight(w1, 0, 0, 0.9, 0);
    expect(vertexWeightOf(w3, 0, 0)).toBeCloseTo(0.9, 12);
    expect(vertexWeightOf(w3, 0, 1)).toBeCloseTo(0.1, 12);
  });

  it('vertexWeightOf reads the influence of a given bone (0 when absent)', () => {
    const w = [2, 0, 0.75, 1, 0.25, 1, 0, 1];
    expect(vertexWeightOf(w, 0, 1)).toBe(0.25);
    expect(vertexWeightOf(w, 0, 0)).toBe(0.75);
    expect(vertexWeightOf(w, 1, 0)).toBe(1);
    expect(vertexWeightOf(w, 1, 1)).toBe(0);
    expect(vertexWeightOf(undefined, 0, 0)).toBe(0);
  });
});

describe('AddMeshCommand', () => {
  it('creates a grid mesh, assigns it, and skins it rigidly', () => {
    const { engine, slotId } = setupSlot();
    const cmd = new AddMeshCommand(engine, slotId, { textureId: TEX, x: 0, y: 0, width: 20, height: 10, cols: 2, rows: 2 });
    cmd.do();
    const att = engine.skeleton.data.attachments[0]!;
    expect(att.type).toBe('mesh');
    expect(att.name).toBe('spot');
    expect(engine.skeleton.data.slots[0]!.defaultAttachmentId).toBe(cmd.attachmentId);

    engine.tick(0); // reset + FK + skinning
    const state = engine.skeleton.pose.attachments.get(cmd.attachmentId)!;
    expect(state.verts[0]).toBe(-10); // TL vertex at bone origin offset
    expect(state.verts[1]).toBe(-5);

    cmd.undo();
    expect(engine.skeleton.data.attachments).toHaveLength(0);
    expect(engine.skeleton.pose.attachments.has(cmd.attachmentId)).toBe(false);
    cmd.do();
    expect(engine.skeleton.pose.attachments.has(cmd.attachmentId)).toBe(true);
  });
});

describe('SetMeshVerticesCommand', () => {
  it('open → update → commit records one undoable vertex move', () => {
    const { engine, slotId } = setupSlot();
    const add = new AddMeshCommand(engine, slotId, { textureId: TEX, x: 0, y: 0, width: 20, height: 10, cols: 2, rows: 2 });
    add.do();

    const cmd = new SetMeshVerticesCommand(engine, add.attachmentId);
    cmd.open();
    expect(cmd.changed).toBe(false);
    expect(() => cmd.update(4, 3, 7)).toThrow(); // Outside the existing boundary.
    cmd.update(4, 3, 2); // Valid center vertex move.
    cmd.commit();
    expect(cmd.changed).toBe(true);

    const mesh = engine.skeleton.data.attachments[0] as { type: 'mesh'; meshVertices?: number[] };
    expect(mesh.meshVertices!.slice(8, 10)).toEqual([3, 2]);
    cmd.undo();
    expect(mesh.meshVertices!.slice(8, 10)).toEqual([0, 0]);
    cmd.do();
    expect(mesh.meshVertices!.slice(8, 10)).toEqual([3, 2]);
  });
});

describe('PaintWeightsCommand', () => {
  it('paints toward another bone and the mesh follows that bone (LBS)', () => {
    const engine = new EditorEngine();
    const rootId = engine.skeleton.data.bones[0]!.id;
    const boneB = new AddBoneCommand(engine, null, { x: 100, y: 0 });
    boneB.do();
    const slotCmd = new AddSlotCommand(engine, rootId);
    slotCmd.do();
    new AddTextureCommand(engine, TEX, 'spot.png').do();
    const add = new AddMeshCommand(engine, slotCmd.slotId, { textureId: TEX, x: 0, y: 0, width: 20, height: 10, cols: 2, rows: 2 });
    add.do();

    const cmd = new PaintWeightsCommand(engine, add.attachmentId);
    cmd.open();
    expect(cmd.changed).toBe(false);
    // Vertex 0 (TL): two dabs of 0.35 + 0.35 => 0.7 toward bone B (index 1).
    cmd.update(0, 1, 0, 0.35);
    cmd.update(0, 1, 0, 0.35);
    cmd.commit();
    expect(cmd.changed).toBe(true);

    const att = engine.skeleton.data.attachments[0]!;
    expect(att.weights!.slice(0, 5).map((v) => Math.round(v * 1000) / 1000)).toEqual([2, 0, 0.3, 1, 0.7]);
    expect(att.weights).toHaveLength(13); // 5 painted numbers + 8 remaining [0] entries

    engine.tick(0); // FK + skinning with the painted weights
    updateSkinning(engine.skeleton);
    const verts = [...engine.skeleton.pose.attachments.get(add.attachmentId)!.verts];
    // TL vertex local (-10,-5): 0.3*(-10) + 0.7*(-10+100) = -3 + 63 = 60.
    expect(verts[0]).toBeCloseTo(60, 6);
    expect(verts[1]).toBeCloseTo(-5, 6);
    // An unpainted vertex (index 4, center) stays fully on bone A.
    expect(verts[8]).toBeCloseTo(0, 6);

    cmd.undo();
    expect(engine.skeleton.data.attachments[0]!.weights).toBeUndefined();
    cmd.do();
    expect(engine.skeleton.data.attachments[0]!.weights).toBeDefined();
  });

  it('set mode raises weights to the dab amount (never lowers)', () => {
    const { engine, slotId } = setupSlot();
    const second = structuredClone(engine.skeleton.data.bones[0]!);
    second.id = 'brush-target'; second.name = 'brush target';
    engine.skeleton.data.bones.push(second); engine.skeleton.rebuild();
    const add = new AddMeshCommand(engine, slotId, { textureId: TEX, x: 0, y: 0, width: 20, height: 10, cols: 2, rows: 2 });
    add.do();
    const cmd = new PaintWeightsCommand(engine, add.attachmentId);
    cmd.open();
    cmd.update(0, 1, 0, 0.5, 'set');
    cmd.update(0, 1, 0, 0.3, 'set'); // weaker dab — must not lower 0.5.
    cmd.commit();
    expect(vertexWeightOf(engine.skeleton.data.attachments[0]!.weights, 0, 1)).toBeCloseTo(0.5, 6);
  });

  it('smooth mode relaxes toward the neighbor average', () => {
    const { engine, slotId } = setupSlot();
    const second = structuredClone(engine.skeleton.data.bones[0]!);
    second.id = 'brush-target'; second.name = 'brush target';
    engine.skeleton.data.bones.push(second); engine.skeleton.rebuild();
    const add = new AddMeshCommand(engine, slotId, { textureId: TEX, x: 0, y: 0, width: 20, height: 10, cols: 2, rows: 2 });
    add.do();
    const mesh = engine.skeleton.data.attachments[0]!;
    const adjacency = meshAdjacency(mesh.meshTriangles!);
    // 3x3 lattice: center vertex 4 touches corners 0/8 and edge midpoints 1/3/5/7.
    expect(adjacency[4]!.slice().sort((a, b) => a - b)).toEqual([0, 1, 3, 5, 7, 8]);

    const cmd = new PaintWeightsCommand(engine, add.attachmentId);
    cmd.open(adjacency);
    cmd.update(1, 1, 0, 1, 'set'); // one neighbor fully on bone B, others stay 0.
    cmd.update(4, 1, 0, 1, 'smooth'); // full relax → avg = 1/6.
    cmd.commit();
    expect(vertexWeightOf(mesh.weights, 4, 1)).toBeCloseTo(1 / 6, 6);
  });
});

describe('triangulateMesh (cdt2d)', () => {
  it('uses interior Steiner points: square hull + center → 4 triangles', () => {
    const verts = [0, 0, 10, 0, 10, 10, 0, 10, 5, 5];
    const tris = triangulateMesh(verts, [0, 1, 2, 3]);
    expect(tris).toHaveLength(12); // 2n-2-h = 10-2-4 = 4 triangles × 3 indices.
    const used = new Set(tris);
    for (let i = 0; i < 5; i++) expect(used.has(i)).toBe(true); // center included.
  });

  it('falls back to all-vertices-as-ring when hull is absent', () => {
    const tris = triangulateMesh([0, 0, 10, 0, 5, 8]);
    expect(tris).toHaveLength(3); // one triangle.
  });

  it('rejects degenerate input explicitly', () => {
    expect(() => triangulateMesh([0, 0, 5, 5], [0, 1])).toThrow(/three/);
  });
});

describe('hull helpers', () => {
  it('buildGridMesh perimeter walks the lattice ring (8 of 9 vertices)', () => {
    const g = buildGridMesh({ textureId: TEX, x: 0, y: 0, width: 20, height: 10, cols: 2, rows: 2 });
    expect(g.hull).toEqual([0, 1, 2, 5, 8, 7, 6, 3]); // top →, right ↓, bottom ←, left ↑.
    expect(new Set(g.hull).size).toBe(8);
  });

  it('buildHullMesh maps UVs over the region quad and triangulates', () => {
    const h = buildHullMesh([-10, -5, 10, -5, 10, 5, -10, 5], { x: 0, y: 0, width: 20, height: 10 });
    expect(h.uvs).toEqual([0, 0, 1, 0, 1, 1, 0, 1]);
    expect(h.triangles).toHaveLength(6); // quad = 2 triangles.
    expect(h.hull).toEqual([0, 1, 2, 3]);
  });

  it('dedupeHull drops consecutive and wrap-around duplicates', () => {
    expect(dedupeHull([0, 0, 10, 0, 10.001, 0, 10, 10])).toEqual([0, 0, 10, 0, 10, 10]);
    expect(dedupeHull([0, 0, 10, 0, 0.001, 0.001])).toEqual([0, 0, 10, 0]);
  });

  it('uvAtPoint interpolates UVs barycentrically inside the containing triangle', () => {
    const mesh = {
      meshVertices: [0, 0, 10, 0, 10, 10, 0, 10],
      meshTriangles: [0, 1, 2, 0, 2, 3],
      meshUVs: [0, 0, 1, 0, 1, 1, 0, 1],
    };
    expect(uvAtPoint(mesh, 5, 0)).toEqual({ u: 0.5, v: 0 }); // on the top edge midpoint.
    expect(uvAtPoint(mesh, -5, 0)).toEqual({ u: 0, v: 0 }); // outside → fallback.
  });

  it('pointInMeshHull tests containment against the hull ring', () => {
    const mesh = { meshVertices: [0, 0, 10, 0, 10, 10, 0, 10], meshHull: [0, 1, 2, 3] };
    expect(pointInMeshHull(mesh, 5, 5)).toBe(true);
    expect(pointInMeshHull(mesh, 15, 5)).toBe(false);
  });
});

describe('CreateHullMeshCommand', () => {
  it('converts the shown region into a hull mesh; undo restores the region', () => {
    const { engine, slotId } = setupSlot();
    const region = new AddAttachmentCommand(engine, slotId, { textureId: TEX, x: 0, y: 0, width: 20, height: 10 });
    region.do();
    engine.tick(0);

    const hull = [-10, -5, 10, -5, 10, 5, -10, 5];
    const cmd = new CreateHullMeshCommand(engine, slotId, hull);
    cmd.do();
    const slot = engine.skeleton.data.slots[0]!;
    expect(slot.defaultAttachmentId).toBe(cmd.attachmentId);
    const mesh = engine.skeleton.data.attachments.find((a) => a.id === cmd.attachmentId)!;
    expect(mesh.type).toBe('mesh');
    expect(mesh.meshVertices).toHaveLength(8);
    expect(mesh.meshHull).toEqual([0, 1, 2, 3]);
    expect(mesh.meshTriangles).toHaveLength(6);

    engine.tick(0); // Skinning runs on the new mesh.
    const state = engine.skeleton.pose.attachments.get(cmd.attachmentId)!;
    expect([...state.verts]).toEqual(hull); // Root bone identity → world == local.

    cmd.undo();
    expect(engine.skeleton.data.attachments.find((a) => a.id === cmd.attachmentId)).toBeUndefined();
    expect(slot.defaultAttachmentId).toBe(region.attachmentId);
    cmd.do();
    expect(slot.defaultAttachmentId).toBe(cmd.attachmentId);
  });

  it('rejects when the slot does not show a region', () => {
    const { engine, slotId } = setupSlot();
    expect(() => new CreateHullMeshCommand(engine, slotId, [0, 0, 10, 0, 10, 10])).toThrow(/region/);
  });
});

describe('AddMeshVertexCommand / RemoveMeshVertexCommand', () => {
  it('infers an omitted mesh boundary for picking and edits, restoring omission on undo', () => {
    const { engine, meshId } = setupAnimatedMesh();
    delete engine.skeleton.data.attachments[0]!.meshHull;
    const before = structuredClone(engine.project);
    expect(pointInMeshHull(engine.skeleton.data.attachments[0]!, 2, 0)).toBe(true);
    const command = new AddMeshVertexCommand(engine, meshId, 2, 0);
    command.do();
    expect(engine.skeleton.data.attachments[0]!.meshHull).toHaveLength(8);
    command.undo(); expect(engine.project).toEqual(before);
    const remove = new RemoveMeshVertexCommand(engine, meshId, 4);
    remove.do(); expect(engine.skeleton.data.attachments[0]!.meshHull).toHaveLength(8);
    remove.undo(); expect(engine.project).toEqual(before);
  });

  it('rejects bad inserts/removals without losing deform keys, pose or redo', () => {
    const { engine, meshId } = setupAnimatedMesh();
    upsertDeformKeyframe(engine.currentAnimation!, meshId, 0, new Array(18).fill(1));
    engine.tick(0);
    const history = new HistoryManager();
    history.execute(new AddMeshVertexCommand(engine, meshId, 2, 0));
    const added = structuredClone(engine.project);
    history.undo();
    engine.tick(0);
    const before = structuredClone(engine.project);
    const pose = [...engine.skeleton.pose.attachments.get(meshId)!.verts];
    for (const command of [
      new AddMeshVertexCommand(engine, meshId, 0, 0),
      new AddMeshVertexCommand(engine, meshId, 30, 0),
      new AddMeshVertexCommand(engine, meshId, 2, -5),
      new AddMeshVertexCommand(engine, meshId, NaN, 0),
      new RemoveMeshVertexCommand(engine, meshId, -1),
      new RemoveMeshVertexCommand(engine, meshId, 100),
    ]) {
      expect(() => history.execute(command)).toThrow();
      expect(engine.project).toEqual(before);
      expect([...engine.skeleton.pose.attachments.get(meshId)!.verts]).toEqual(pose);
      expect(history.canRedo).toBe(true);
    }
    history.redo(); expect(engine.project).toEqual(added);
    history.undo(); expect(engine.project).toEqual(before);
  });

  it('rejects a removal that strands an interior vertex on the new boundary', () => {
    const { engine, meshId } = setupAnimatedMesh();
    new RemoveMeshVertexCommand(engine, meshId, 0).do();
    new RemoveMeshVertexCommand(engine, meshId, 0).do();
    upsertDeformKeyframe(engine.currentAnimation!, meshId, 0, new Array(14).fill(2));
    const before = structuredClone(engine.project);
    expect(() => new RemoveMeshVertexCommand(engine, meshId, 0).do()).toThrow(/boundary/);
    expect(engine.project).toEqual(before);
  });

  it('keeps the last valid drag preview and deformation keys on invalid coordinates', () => {
    const { engine, meshId } = setupAnimatedMesh();
    upsertDeformKeyframe(engine.currentAnimation!, meshId, 0, new Array(18).fill(1));
    const before = structuredClone(engine.project);
    const cmd = new SetMeshVerticesCommand(engine, meshId); cmd.open();
    cmd.update(4, 2, 1);
    const preview = structuredClone(engine.project);
    for (const [index, x, y] of [[4, NaN, 0], [4, 30, 0], [4, -10, -5], [-1, 0, 0]]) {
      expect(() => cmd.update(index!, x!, y!)).toThrow();
      expect(engine.project).toEqual(preview);
    }
    cmd.commit(); cmd.undo(); expect(engine.project).toEqual(before);
    cmd.do(); expect(engine.project).toEqual(preview);
  });

  it('adds an interior vertex: UV barycentric, re-triangulated, deform keys stripped+restored', () => {
    const { engine, meshId } = setupAnimatedMesh();
    upsertDeformKeyframe(engine.currentAnimation!, meshId, 0, new Array(18).fill(0));
    const beforeTris = engine.skeleton.data.attachments[0]!.meshTriangles!.length;

    const cmd = new AddMeshVertexCommand(engine, meshId, 2, 0); // just right of center
    cmd.do();
    const mesh = engine.skeleton.data.attachments[0]!;
    expect(mesh.meshVertices!.length / 2).toBe(10);
    expect(mesh.meshUVs![18]).toBeCloseTo(0.6, 9); // (2+10)/20.
    expect(mesh.meshUVs![19]).toBeCloseTo(0.5, 9);
    expect(mesh.meshHull).toHaveLength(8); // ring unchanged — new vertex is interior.
    expect(mesh.meshTriangles!.length).toBeGreaterThan(beforeTris);
    // Deform keys were invalidated by the vertex-count change → stripped.
    expect(engine.currentAnimation!.timelines.find((tl) => tl.kind === 'deform')).toBeUndefined();

    cmd.undo();
    const restored = engine.skeleton.data.attachments[0]!;
    expect(restored.meshVertices!.length / 2).toBe(9);
    expect(restored.meshUVs).toHaveLength(18);
    const tl = engine.currentAnimation!.timelines[0]!;
    expect(tl.kind).toBe('deform');
    expect(tl.keyframes).toHaveLength(1);
    cmd.do();
    expect(engine.currentAnimation!.timelines.find((tl) => tl.kind === 'deform')).toBeUndefined();
  });

  it('removes a hull vertex: hull remapped, weights entry dropped, never below 3', () => {
    const { engine, meshId } = setupAnimatedMesh();
    const boneB = new AddBoneCommand(engine, null, { x: 100, y: 0 });
    boneB.do(); // bone index 1 — the paint target.
    const paint = new PaintWeightsCommand(engine, meshId);
    paint.open();
    paint.update(0, 1, 0, 0.5); // vertex 0 is a HULL vertex with a 5-number entry.
    paint.commit();

    const cmd = new RemoveMeshVertexCommand(engine, meshId, 0);
    cmd.do();
    const mesh = engine.skeleton.data.attachments[0]!;
    expect(mesh.meshVertices!.length / 2).toBe(8);
    expect(mesh.meshHull).toEqual([0, 1, 4, 7, 6, 5, 2]); // old [1,2,5,8,7,6,3] shifted down.
    // v0's [2, b0, w, b1, w] entry (5 numbers) gone; the rest shift up.
    expect(mesh.weights!.slice(0, 3)).toEqual([0, 0, 0]); // old v1's rigid entry.
    expect(mesh.meshTriangles!.length).toBeGreaterThan(0);

    cmd.undo();
    expect(engine.skeleton.data.attachments[0]!.meshVertices!.length / 2).toBe(9);
    expect(vertexWeightOf(engine.skeleton.data.attachments[0]!.weights, 0, 1)).toBeCloseTo(0.5, 6);

    // A final triangle remains intact; every gesture is a fresh command.
    const triangle = engine.skeleton.data.attachments[0]!;
    triangle.meshVertices = [0, 0, 10, 0, 0, 10]; triangle.meshUVs = [0, 0, 1, 0, 0, 1];
    triangle.meshTriangles = [0, 1, 2]; triangle.meshHull = [0, 1, 2]; delete triangle.weights;
    engine.document.animations[0]!.timelines = []; engine.skeleton.rebuild();
    const before = structuredClone(engine.project);
    for (let i = 0; i < 3; i++) new RemoveMeshVertexCommand(engine, meshId, 0).do();
    expect(engine.project).toEqual(before);
  });
});

describe('AutoKeyDeformCommand', () => {
  it('keys offsets vs the setup mesh at the playhead; undo removes the timeline', () => {
    const { engine, meshId } = setupAnimatedMesh();
    const cmd = new AutoKeyDeformCommand(engine, meshId);
    cmd.open();
    cmd.update(4, 5, 3); // center vertex (setup 0,0) → offsets (5,3).
    cmd.commit();
    expect(cmd.changed).toBe(true);

    const tl = engine.currentAnimation!.timelines[0] as DeformTimelineView;
    expect(tl.kind).toBe('deform');
    expect(tl.keyframes).toHaveLength(1);
    expect(tl.keyframes[0]!.offsets![8]).toBe(5);
    expect(tl.keyframes[0]!.offsets![9]).toBe(3);
    expect(tl.keyframes[0]!.offsets).toHaveLength(18);

    engine.tick(0); // Pipeline applies the deform and skins it.
    const verts = [...engine.skeleton.pose.attachments.get(meshId)!.verts];
    expect(verts[8]).toBeCloseTo(5, 6); // root bone identity: world == bone-local.
    expect(verts[9]).toBeCloseTo(3, 6);

    cmd.undo(); // Timeline did not exist before → removed entirely.
    expect(engine.currentAnimation!.timelines).toHaveLength(0);
    cmd.do();
    expect(engine.currentAnimation!.timelines).toHaveLength(1);
  });

  it('replaces (not stacks) the keyframe at the same time and restores the prior one on undo', () => {
    const { engine, meshId } = setupAnimatedMesh();
    upsertDeformKeyframe(engine.currentAnimation!, meshId, 0, new Array(18).fill(1));
    engine.tick(0); // Apply so the pose carries the all-ones offsets at open().

    const cmd = new AutoKeyDeformCommand(engine, meshId);
    cmd.open(); // base = the interpolated pose at t=0 (all ones).
    cmd.update(4, 6, 6); // setup (0,0) → offsets (6,6), everything else stays 1.
    cmd.commit();
    const tl = engine.currentAnimation!.timelines[0] as DeformTimelineView;
    expect(tl.keyframes).toHaveLength(1);
    expect(tl.keyframes[0]!.offsets![0]).toBe(1); // untouched vertex keeps the base.
    expect(tl.keyframes[0]!.offsets![8]).toBe(6);

    cmd.undo();
    expect(tl.keyframes[0]!.offsets!.every((v) => v === 1)).toBe(true);
  });

  it('DeleteDeformKeyframeCommand removes a single key', () => {
    const { engine, meshId } = setupAnimatedMesh();
    upsertDeformKeyframe(engine.currentAnimation!, meshId, 0, null);
    upsertDeformKeyframe(engine.currentAnimation!, meshId, 0.5, null);
    const cmd = new DeleteDeformKeyframeCommand(engine, meshId, 0.5);
    cmd.do();
    const tl = engine.currentAnimation!.timelines[0] as { keyframes: { time: number }[] };
    expect(tl.keyframes.map((k) => k.time)).toEqual([0]);
    cmd.undo();
    expect(tl.keyframes.map((k) => k.time)).toEqual([0, 0.5]);
  });
});
