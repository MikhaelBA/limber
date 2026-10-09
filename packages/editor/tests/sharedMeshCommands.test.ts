import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deserializeProject, serializeProject, MESH_GEOMETRY_FIELDS } from '@limber/core';
import { EditorEngine } from '../src/engine/EditorEngine';
import { CreateSharedMeshCommand, DetachSharedMeshCommand, SetMeshTextureCommand } from '../src/commands/sharedMeshCommands';
import { AddMeshVertexCommand, RemoveMeshVertexCommand, SetMeshVerticesCommand, PaintWeightsCommand } from '../src/commands/meshCommands';
import { RemoveAttachmentCommand } from '../src/commands/attachmentCommands';
import { BindMeshCommand } from '../src/commands/bindMeshCommand';
import { HistoryManager } from '../src/history/history';

function setup() {
  const engine = new EditorEngine();
  engine.loadProject(deserializeProject(readFileSync('fixtures/bbbproj-v6-shared-mesh.json', 'utf8')));
  const history = new HistoryManager();
  const save = () => JSON.parse(serializeProject(engine.project));
  const mesh = (id: string) => engine.skeleton.attachmentById.get(id)!;
  return { engine, history, save, mesh };
}
describe('shared mesh authoring', () => {
  it('copies binding/weights/Deform independently, flattens links, and has exact history', () => {
    const { engine, history, save, mesh } = setup(), before = save();
    const command = new CreateSharedMeshCommand(engine, 'variant', 'variant-slot');
    history.execute(command); const after = save(), link = mesh(command.attachmentId);
    expect(link.meshSourceId).toBe('mesh');
    expect(link.meshVertices).toBe(mesh('mesh').meshVertices);
    expect(link.weights).toEqual(mesh('variant').weights); expect(link.weights).not.toBe(mesh('variant').weights);
    expect(link.boneBindings).not.toBe(mesh('variant').boneBindings);
    const tracks = engine.document.animations[0]!.timelines.filter((item) => item.kind === 'deform');
    expect(tracks).toHaveLength(2); expect(tracks[0]!.keyframes).not.toBe(tracks[1]!.keyframes);
    history.undo(); expect(save()).toEqual(before); history.redo(); expect(save()).toEqual(after);
  });
  it('shares setup vertex edits and preserves each animation through undo/redo', () => {
    const { engine, history, save, mesh } = setup(), before = save();
    const command = new SetMeshVerticesCommand(engine, 'variant');
    command.open(); command.update(0, -45, 85); command.commit(); history.execute(command);
    expect(mesh('variant').meshVertices).toBe(mesh('mesh').meshVertices);
    expect(mesh('mesh').meshVertices!.slice(0, 2)).toEqual([-45,85]);
    const after = save(); history.undo(); expect(save()).toEqual(before); history.redo(); expect(save()).toEqual(after);
  });
  it('changes vertex count for all weight rows and invalidates all dependent Deform tracks atomically', () => {
    const { engine, history, save, mesh } = setup(), before = save();
    history.execute(new AddMeshVertexCommand(engine, 'variant', 0, 150));
    for (const id of ['mesh','variant']) {
      expect(mesh(id).meshVertices).toHaveLength(10);
      expect(mesh(id).weights!.at(-1)).toBe(0);
    }
    expect(engine.document.animations[0]!.timelines.some((item) => item.kind === 'deform')).toBe(false);
    const after = save(); history.undo(); expect(save()).toEqual(before); history.redo(); expect(save()).toEqual(after);
    history.execute(new RemoveMeshVertexCommand(engine, 'variant', 4));
    expect(mesh('mesh').weights).toHaveLength(12); expect(mesh('variant').weights).toHaveLength(12);
    history.undo(); expect(save()).toEqual(after);
    expect(() => history.execute(new RemoveMeshVertexCommand(engine, 'variant', -1))).toThrow(/vertex/);
    history.redo(); expect(mesh('variant').meshVertices).toHaveLength(8);
  });
  it('keeps painting, rebinding and texture changes local to the instance', () => {
    const { engine, history, mesh } = setup();
    const original = structuredClone(mesh('mesh'));
    history.execute(new BindMeshCommand(engine, 'variant', 'variant-slot', ['root','tip']));
    const paint = new PaintWeightsCommand(engine, 'variant');
    paint.open(); paint.update(0, 1, 0, 1, 'set'); paint.commit(); history.execute(paint);
    expect(mesh('mesh')).toEqual(original);
    expect(mesh('variant').weights).not.toEqual(original.weights);
    engine.document.assetManifest.other = { name: 'other.png', source: 'embedded' };
    history.execute(new SetMeshTextureCommand(engine, 'variant', 'other'));
    expect(mesh('variant').textureId).toBe('other'); expect(mesh('mesh').textureId).toBe('');
  });
  it('detaches without changing independent data and guards source deletion without losing redo', () => {
    const { engine, history, save, mesh } = setup(), before = save();
    history.execute(new DetachSharedMeshCommand(engine, 'variant')); const detached = save();
    for (const key of MESH_GEOMETRY_FIELDS) { expect(mesh('variant')[key]).toEqual(mesh('mesh')[key]); expect(mesh('variant')[key]).not.toBe(mesh('mesh')[key]); }
    history.undo(); expect(save()).toEqual(before);
    expect(() => history.execute(new RemoveAttachmentCommand(engine, 'mesh'))).toThrow(/Detach shared/);
    expect(save()).toEqual(before); history.redo(); expect(save()).toEqual(detached);
    history.execute(new RemoveAttachmentCommand(engine, 'mesh'));
    expect(mesh('variant').meshVertices).toHaveLength(8); history.undo(); expect(save()).toEqual(detached);
  });
  it('removes only the instance and its tracks, and restores original attachment order exactly', () => {
    const { engine, history, save } = setup(), before = save();
    history.execute(new RemoveAttachmentCommand(engine, 'variant')); const after = save();
    expect(engine.document.animations[0]!.timelines.some((item) => item.kind === 'deform')).toBe(false);
    history.undo(); expect(save()).toEqual(before); history.redo(); expect(save()).toEqual(after);
  });
  it('assigns to the active skin and rejects creation/detach in Animate before mutation', () => {
    const { engine, history, save } = setup();
    engine.skeleton.data.skins.push({ name: 'variant-skin', attachments: {} }); engine.skeleton.data.activeSkin = 'variant-skin';
    const command = new CreateSharedMeshCommand(engine, 'variant', 'variant-slot', 'skin'); history.execute(command);
    expect(engine.skeleton.data.skins[0]!.attachments['variant-slot']).toBe(command.attachmentId);
    const before = save(); engine.mode = 'animate';
    expect(() => history.execute(new DetachSharedMeshCommand(engine, command.attachmentId))).toThrow(/Setup/);
    expect(() => history.execute(new CreateSharedMeshCommand(engine, 'variant', 'variant-slot'))).toThrow(/Setup/);
    expect(save()).toEqual(before);
  });
});
