import { describe, expect, it } from 'vitest';
import { updateSkinning } from '@limber/core';
import { EditorEngine } from '../src/engine/EditorEngine';
import {
  AddMeshCommand,
  PaintWeightsCommand,
  SetMeshVerticesCommand,
  buildGridMesh,
  setVertexWeight,
  vertexWeightOf,
  weightEntryAt,
} from '../src/commands/meshCommands';
import { AddSlotCommand } from '../src/commands/slotCommands';
import { AddBoneCommand } from '../src/commands/boneCommands';
import { AddTextureCommand } from '../src/commands/attachmentCommands';

const TEX = 'tex-1';

function setupSlot() {
  const engine = new EditorEngine();
  const rootId = engine.skeleton.data.bones[0]!.id;
  const slotCmd = new AddSlotCommand(engine, rootId);
  slotCmd.do();
  new AddTextureCommand(engine, TEX, 'spot.png').do();
  return { engine, rootId, slotId: slotCmd.slotId };
}

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
    // Painting the SLOT's own bone collapses to rigid at any strength.
    const w3 = setVertexWeight(w1, 0, 0, 0.9, 0);
    expect(w3).toEqual([1, 0, 1, 0, 0]);
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
    cmd.update(4, 3, 7); // center vertex
    cmd.commit();
    expect(cmd.changed).toBe(true);

    const mesh = engine.skeleton.data.attachments[0] as { type: 'mesh'; meshVertices?: number[] };
    expect(mesh.meshVertices!.slice(8, 10)).toEqual([3, 7]);
    cmd.undo();
    expect(mesh.meshVertices!.slice(8, 10)).toEqual([0, 0]);
    cmd.do();
    expect(mesh.meshVertices!.slice(8, 10)).toEqual([3, 7]);
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
});
