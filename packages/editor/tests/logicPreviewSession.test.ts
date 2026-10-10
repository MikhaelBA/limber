import { describe, expect, it } from 'vitest';
import { serializeProject } from '@limber/core';
import { logicRoutesFixture } from '../../../tools/logic-routes-fixture.mjs';
import { LogicPreviewSession } from '../src/engine/LogicPreviewSession';
import { EditLogicCommand } from '../src/commands/logicCommands';
describe('isolated Logic editor preview sessions', () => {
  it('poses simultaneous artboard/rig graphs without changing authoring, with paused step and reset', () => {
    const p = logicRoutesFixture(),
      board = p.artboards[0]!,
      before = serializeProject(p),
      session = new LogicPreviewSession(p, { artboardId: board.id, rigId: null });
    expect(session.playing).toBe(false);
    expect(session.player!.snapshot().tick).toBe(0);
    session.dispatch('click', 'instance');
    session.advance(1);
    expect(session.player!.snapshot().tick).toBe(0);
    session.step();
    expect(session.playing).toBe(false);
    expect(session.player!.snapshot().stateId).toBe('active');
    expect(session.player!.snapshot().tick).toBe(1);
    expect([...session.rigs.values()][0]!.snapshot().tick).toBe(1);
    expect(session.view.nodes.find((n) => n.id === 'direct')).toMatchObject({ text: 'Clicked 🌿' });
    session.play();
    session.advance(0.05);
    session.pause();
    const held = session.player!.snapshot();
    session.advance(5);
    expect(session.player!.snapshot()).toEqual(held);
    session.reset();
    expect(session.playing).toBe(false);
    expect(session.player!.snapshot().tick).toBe(0);
    expect(session.player!.inputRouter.recentDispatches()).toEqual([]);
    expect(serializeProject(p)).toBe(before);
  });
  it('uses viewport routes for character owners and holds authored view on disable', () => {
    const p = logicRoutesFixture(),
      board = p.artboards[0]!,
      rig = board.nodes.find((n) => n.type === 'rig')!,
      before = serializeProject(p),
      owner = { artboardId: board.id, rigId: rig.id },
      session = new LogicPreviewSession(p, owner);
    owner.rigId = 'changed';
    expect(session.owner.rigId).toBe(rig.id);
    expect(session.scene).toBeNull();
    session.dispatch('click', 'instance');
    session.step();
    expect(session.player!.snapshot().stateId).toBe('rig-active');
    const held = session.player!.snapshot();
    session.setEnabled(false);
    session.play();
    session.advance(1);
    session.setEnabled(true);
    expect(session.player!.snapshot().transition).toEqual(held.transition);
    expect(serializeProject(p)).toBe(before);
  });
  it('publishes fresh paused sessions after source edits while older baked previews remain isolated', () => {
    const p = logicRoutesFixture(),
      owner = { artboardId: 'board', rigId: null },
      old = new LogicPreviewSession(p, owner);
    old.play();
    old.dispatch('click', 'instance');
    old.advance(0.05);
    new EditLogicCommand(p, owner, {
      kind: 'parameter',
      id: 'label',
      parameter: { id: 'label', name: 'caption', type: 'string', initial: 'New default' },
    }).do();
    const fresh = new LogicPreviewSession(p, owner);
    expect(fresh.playing).toBe(false);
    expect(fresh.player!.snapshot().tick).toBe(0);
    expect(fresh.player!.getParameter('caption')).toBe('New default');
    expect(old.player!.getParameter('label')).toBe('Clicked 🌿');
    expect(() => new LogicPreviewSession(p, { artboardId: 'missing', rigId: null })).toThrow();
    expect(() => new LogicPreviewSession(p, { artboardId: 'board', rigId: 'direct' })).toThrow();
  });
});
