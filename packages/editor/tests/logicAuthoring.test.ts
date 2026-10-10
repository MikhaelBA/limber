import { describe, it, expect } from 'vitest';
import {
  activeRigNode,
  serializeProject,
  deserializeProject,
  validateProject,
  assertSpineProjectSupported,
  type LogicGraph,
} from '@limber/core';
import { EditorEngine } from '../src/engine/EditorEngine';
import { EditLogicCommand, type LogicOwner } from '../src/commands/logicCommands';
import { HistoryManager } from '../src/history/history';
import {
  AddAnimationCommand,
  RemoveAnimationCommand,
  SetAnimationMetaCommand,
} from '../src/commands/animationCommands';
import { EditSceneMotionCommand } from '../src/commands/sceneMotionCommands';
import { duplicateSceneCommand } from '../src/commands/sceneCommands';
const graph = (clip: string): LogicGraph => ({
  id: 'graph',
  name: 'Behavior',
  enabled: true,
  entryStateId: 'idle',
  parameters: [{ id: 'speed', name: 'speed', type: 'float', initial: 0 }],
  states: [{ id: 'idle', name: 'Idle', clip, loop: true }],
  transitions: [],
});
function fixture() {
  const engine = new EditorEngine();
  new AddAnimationCommand(engine, 'wave').do();
  const board = engine.project.artboards[0]!;
  board.clips = [{ id: 'move', name: 'Move', duration: 1, loop: true, fps: 30, tracks: [], events: [] }];
  const rig = activeRigNode(engine.project)!;
  return {
    engine,
    project: engine.project,
    board,
    rig,
    sceneOwner: { artboardId: board.id, rigId: null } as LogicOwner,
    rigOwner: { artboardId: board.id, rigId: rig.id } as LogicOwner,
  };
}
describe('native Logic source and atomic graph commands', () => {
  it('stores independent scene/rig graphs with owner-scoped references and preserves payload identities/history', () => {
    const { project, board, rig, sceneOwner, rigOwner } = fixture(),
      before = serializeProject(project),
      h = new HistoryManager();
    const skeleton = rig.skeleton,
      clips = board.clips,
      animations = rig.animations;
    h.execute(new EditLogicCommand(project, sceneOwner, { kind: 'create', graph: graph('move') }));
    h.execute(new EditLogicCommand(project, rigOwner, { kind: 'create', graph: graph('wave') }));
    const after = serializeProject(project);
    expect(deserializeProject(after)).toEqual(project);
    expect(project.schemaVersion).toBe(10);
    expect(rig.skeleton).toBe(skeleton);
    expect(rig.animations).toBe(animations);
    expect(board.clips).toBe(clips);
    h.undo();
    h.undo();
    expect(serializeProject(project)).toBe(before);
    h.redo();
    h.redo();
    expect(serializeProject(project)).toBe(after);
    const bad = structuredClone(project);
    bad.artboards[0]!.logic!.states[0]!.clip = 'wave';
    expect(() => validateProject(bad)).toThrow(/existing positive-duration clip/);
  });
  it('creates/edits states, parameters and guards, and removes dependent edges without weakening them', () => {
    const { project, board, sceneOwner } = fixture(),
      h = new HistoryManager();
    h.execute(new EditLogicCommand(project, sceneOwner, { kind: 'create', graph: graph('move') }));
    const commands = [
      new EditLogicCommand(project, sceneOwner, {
        kind: 'addParameter',
        parameter: { id: 'open', name: 'open', type: 'trigger', initial: false },
      }),
      new EditLogicCommand(project, sceneOwner, {
        kind: 'addState',
        state: { id: 'active', name: 'Active', clip: null, loop: false, position: { x: 200, y: 20 } },
      }),
      new EditLogicCommand(project, sceneOwner, {
        kind: 'addTransition',
        transition: {
          id: 'start',
          from: 'idle',
          to: 'active',
          priority: 0,
          blendDuration: 0.2,
          interruption: 'higherPriority',
          conditions: [{ parameterId: 'open', operator: 'fired' }],
        },
      }),
      new EditLogicCommand(project, sceneOwner, {
        kind: 'state',
        id: 'active',
        patch: { name: 'Opened', position: { x: 300, y: 10 } },
      }),
      new EditLogicCommand(project, sceneOwner, {
        kind: 'parameter',
        id: 'speed',
        parameter: { id: 'speed', name: 'velocity', type: 'float', initial: 2 },
      }),
      new EditLogicCommand(project, sceneOwner, {
        kind: 'transition',
        id: 'start',
        patch: { blendDuration: 0.1 },
      }),
    ];
    const before = serializeProject(project);
    for (const cmd of commands) h.execute(cmd);
    const after = serializeProject(project);
    for (const _cmd of commands) h.undo();
    expect(serializeProject(project)).toBe(before);
    for (const _cmd of commands) h.redo();
    expect(serializeProject(project)).toBe(after);
    h.execute(new EditLogicCommand(project, sceneOwner, { kind: 'removeParameter', id: 'open' }));
    expect(board.logic!.transitions).toEqual([]);
    h.undo();
    expect(serializeProject(project)).toBe(after);
    h.execute(new EditLogicCommand(project, sceneOwner, { kind: 'removeState', id: 'idle' }));
    expect(board.logic!.entryStateId).toBe('active');
    expect(board.logic!.transitions).toEqual([]);
    h.undo();
    expect(serializeProject(project)).toBe(after);
  });
  it('rejects invalid edits before publication and preserves redo, including attempted identity changes', () => {
    const { project, board, sceneOwner } = fixture(),
      h = new HistoryManager();
    h.execute(new EditLogicCommand(project, sceneOwner, { kind: 'create', graph: graph('move') }));
    h.execute(new EditLogicCommand(project, sceneOwner, { kind: 'settings', patch: { enabled: false } }));
    h.undo();
    const before = serializeProject(project);
    for (const cmd of [
      new EditLogicCommand(project, sceneOwner, { kind: 'create', graph: graph('move') }),
      new EditLogicCommand(project, sceneOwner, { kind: 'state', id: 'idle', patch: { clip: 'missing' } }),
      new EditLogicCommand(project, sceneOwner, {
        kind: 'state',
        id: 'idle',
        patch: { id: 'changed' } as never,
      }),
      new EditLogicCommand(project, sceneOwner, { kind: 'removeState', id: 'idle' }),
      new EditLogicCommand(project, sceneOwner, {
        kind: 'parameter',
        id: 'speed',
        parameter: { id: 'changed', name: 'new', type: 'float', initial: 0 },
      }),
      new EditLogicCommand(project, sceneOwner, { kind: 'settings', patch: { entryStateId: 'missing' } }),
      new EditLogicCommand(project, { ...sceneOwner, rigId: 'missing' }, { kind: 'removeGraph' }),
    ]) {
      expect(() => h.execute(cmd)).toThrow();
      expect(serializeProject(project)).toBe(before);
      expect(h.canRedo).toBe(true);
    }
    h.redo();
    expect(board.logic!.enabled).toBe(false);
  });
  it('updates rig clip references atomically on rename and blocks deleting referenced scene/rig clips', () => {
    const { engine, project, board, rig, sceneOwner, rigOwner } = fixture();
    new EditLogicCommand(project, sceneOwner, { kind: 'create', graph: graph('move') }).do();
    new EditLogicCommand(project, rigOwner, { kind: 'create', graph: graph('wave') }).do();
    engine.setAnimation('wave');
    const before = serializeProject(project),
      rename = new SetAnimationMetaCommand(engine, 'wave', { newName: 'hello', duration: 2 });
    rename.do();
    expect(rig.logic!.states[0]!.clip).toBe('hello');
    expect(engine.activeAnimationName).toBe('hello');
    const after = serializeProject(project);
    rename.undo();
    expect(serializeProject(project)).toBe(before);
    rename.do();
    expect(serializeProject(project)).toBe(after);
    expect(() => new RemoveAnimationCommand(engine, 'hello').do()).toThrow(/used by a Logic state/);
    expect(() =>
      new EditSceneMotionCommand(project, board.id, { kind: 'remove', clipId: 'move' }).do(),
    ).toThrow(/existing positive-duration clip/);
    expect(() => new SetAnimationMetaCommand(engine, 'hello', { duration: Infinity }).do()).toThrow();
    expect(serializeProject(project)).toBe(after);
    new AddAnimationCommand(engine, 'other').do();
    const withOther = serializeProject(project);
    expect(() => new SetAnimationMetaCommand(engine, 'hello', { newName: 'other' }).do()).toThrow(
      /unique animation names/,
    );
    expect(serializeProject(project)).toBe(withOther);
  });
  it('removes/recreates graphs without touching raw animations and allows owner-scoped graph copies', () => {
    const { project, rig, rigOwner } = fixture(),
      before = structuredClone(rig.animations);
    new EditLogicCommand(project, rigOwner, { kind: 'create', graph: graph('wave') }).do();
    const saved = serializeProject(project);
    const remove = new EditLogicCommand(project, rigOwner, { kind: 'removeGraph' });
    remove.do();
    expect(rig.logic).toBeUndefined();
    expect(rig.animations).toEqual(before);
    remove.undo();
    expect(serializeProject(project)).toBe(saved);
    const duplicate = duplicateSceneCommand(project, rigOwner.artboardId, [rig.id]);
    duplicate.do();
    validateProject(project);
    expect(project.artboards[0]!.nodes.filter((n) => n.type === 'rig')).toHaveLength(2);
    duplicate.undo();
    expect(serializeProject(project)).toBe(saved);
  });
  it('rejects malformed native graph imports and compatibility export before replacing the current project', () => {
    const { engine, project, sceneOwner, rigOwner } = fixture();
    expect(() => assertSpineProjectSupported(project)).not.toThrow();
    new EditLogicCommand(project, rigOwner, { kind: 'create', graph: graph('wave') }).do();
    expect(() => assertSpineProjectSupported(project)).toThrow(/Native Logic/);
    const before = serializeProject(project),
      bad = structuredClone(project);
    activeRigNode(bad)!.logic!.parameters[0]!.initial = 'wrong' as never;
    expect(() => engine.loadProject(bad)).toThrow(/finite Float32/);
    expect(serializeProject(engine.project)).toBe(before);
    expect(() =>
      deserializeProject(JSON.stringify({ ...project, artboards: [{ ...project.artboards[0], logic: {} }] })),
    ).toThrow();
    new EditLogicCommand(project, rigOwner, { kind: 'removeGraph' }).do();
    new EditLogicCommand(project, sceneOwner, { kind: 'create', graph: graph('move') }).do();
    expect(() => assertSpineProjectSupported(project)).toThrow(/Native Logic/);
  });
});
