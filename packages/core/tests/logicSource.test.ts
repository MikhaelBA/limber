import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  deserializeProject,
  serializeProject,
  activeRigNode,
  LogicMachine,
  type LogicGraph,
} from '../src/index';
describe('saved native Logic source', () => {
  it('reopens the actual editor-saved scene/rig graphs and independently resolves their clip libraries', () => {
    const project = deserializeProject(readFileSync('fixtures/bbbproj-v10-logic.json', 'utf8')),
      before = structuredClone(project);
    expect(deserializeProject(serializeProject(project))).toEqual(project);
    const board = project.artboards[0]!,
      rig = activeRigNode(project)!;
    const scene = new LogicMachine(
      board.logic!,
      new Map(board.clips!.map((c) => [c.id, { duration: c.duration }])),
    );
    const character = new LogicMachine(
      rig.logic!,
      new Map(rig.animations.map((c) => [c.name, { duration: c.duration }])),
    );
    for (const m of [scene, character]) {
      expect(m.snapshot().clip).toBeNull();
      m.fire('open');
      m.step();
      expect(m.getParameter('open')).toBe(false);
      expect(m.snapshot().transition?.progress).toBeCloseTo(1 / 12, 12);
    }
    expect(scene.snapshot().clip).toBe('logic-scene-clip');
    expect(character.snapshot().clip).toBe(rig.animations[0]!.name);
    expect(project).toEqual(before);
  });
  it('rejects graphs on unsupported node/component owners before replacing source', () => {
    const project = deserializeProject(readFileSync('fixtures/bbbproj-v10-logic.json', 'utf8'));
    const graph = project.artboards[0]!.logic as LogicGraph;
    const bad = structuredClone(project);
    bad.artboards[0]!.nodes.push({
      id: 'bad-group',
      name: 'Bad',
      type: 'group',
      parentId: null,
      transform: {
        x: 0,
        y: 0,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        shearX: 0,
        shearY: 0,
        pivotX: 0,
        pivotY: 0,
      },
      visible: true,
      opacity: 1,
      logic: graph,
    } as never);
    expect(() => deserializeProject(JSON.stringify(bad))).toThrow(/Only artboards and rig/);
    const component = structuredClone(project);
    component.components = [
      {
        id: 'component',
        name: 'Component',
        revision: 1,
        width: 10,
        height: 10,
        nodes: [],
        exposed: [],
        logic: graph,
      } as never,
    ];
    expect(() => deserializeProject(JSON.stringify(component))).toThrow(/Component-local/);
  });
});
