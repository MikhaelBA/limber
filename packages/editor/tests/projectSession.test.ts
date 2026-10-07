import { describe, expect, it } from 'vitest';
import { activeRigDocument, deserializeProject, serializeProject } from '@limber/core';
import { EditorEngine } from '../src/engine/EditorEngine';
import { AddBoneCommand, MoveBoneCommand } from '../src/commands/boneCommands';
import { HistoryManager } from '../src/history/history';
import { seededRandom } from '../../core/tests/fixtures';

describe('project-backed legacy editor', () => {
  it('persists edits through the new authoring envelope', () => {
    const engine = new EditorEngine();
    const add = new AddBoneCommand(engine, null, { x: 40, y: 60 });
    add.do();
    const reloaded = new EditorEngine();
    reloaded.loadProject(deserializeProject(serializeProject(engine.project)));
    expect(reloaded.document).toEqual(engine.document);
    expect(reloaded.skeleton.boneIndexMap.has(add.boneId)).toBe(true);
    expect(activeRigDocument(engine.project)!.skeleton).toBe(engine.document.skeleton);
  });

  it('does not replace the active project when validation fails', () => {
    const engine = new EditorEngine();
    const original = engine.project;
    const invalid = structuredClone(original);
    invalid.editor.activeArtboardId = 'missing';
    expect(() => engine.loadProject(invalid)).toThrow();
    expect(engine.project).toBe(original);
    expect(engine.skeleton.data).toBe(engine.document.skeleton);
  });

  it('loads transformed and scene-only artboards without discarding content', () => {
    const engine = new EditorEngine();
    const project = structuredClone(engine.project);
    project.artboards[0]!.nodes[0]!.transform.x = 100;
    engine.loadProject(project);
    expect(engine.project).toBe(project);
    project.artboards[0]!.nodes = [];
    project.editor.activeRigId = null;
    engine.loadProject(project);
    expect(engine.skeleton.data.bones).toHaveLength(0);
  });

  it('round-trips 1000 seeded transform transactions through undo and redo', () => {
    const engine = new EditorEngine();
    const random = seededRandom();
    const history = new HistoryManager();
    const boneId = engine.document.skeleton.bones[0]!.id;
    // History retains 200 entries, so test ten independent batches of 100.
    for (let batch = 0; batch < 10; batch++) {
      history.clear();
      const before = serializeProject(engine.project);
      for (let i = 0; i < 100; i++) {
        const cmd = new MoveBoneCommand(engine, boneId);
        cmd.open();
        cmd.update(random() * 2000 - 1000, random() * 2000 - 1000);
        cmd.commit();
        history.execute(cmd);
      }
      const after = serializeProject(engine.project);
      for (let i = 0; i < 100; i++) expect(history.undo()).toBe(true);
      expect(serializeProject(engine.project)).toBe(before);
      for (let i = 0; i < 100; i++) expect(history.redo()).toBe(true);
      expect(serializeProject(engine.project)).toBe(after);
    }
  });
});
