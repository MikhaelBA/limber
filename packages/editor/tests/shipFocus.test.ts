import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { deserializeProject, type RigNode } from '@limber/core';
import { resolveShipFocus } from '../src/persistence/shipFocus';

const source = () =>
  deserializeProject(
    readFileSync(new URL('../../../fixtures/bbbproj-v10-logic.json', import.meta.url), 'utf8'),
  );
const finding = (objectId: string | null) => ({
  code: 'TEST',
  severity: 'warning' as const,
  objectId,
  explanation: 'Test',
  remedy: 'Inspect',
});
describe('actionable source inspection ownership', () => {
  it('returns every local-rig identity candidate and respects explicit Doctor owner context without source mutation', () => {
    const project = source(),
      board = project.artboards[0]!,
      rig = board.nodes.find((node) => node.type === 'rig') as RigNode;
    const second = structuredClone(rig);
    second.id = 'second-rig';
    second.name = 'Second';
    board.nodes.push(second);
    const before = JSON.stringify(project),
      boneId = rig.skeleton.bones[0]!.id;
    const targets = resolveShipFocus(project, finding(boneId));
    expect(targets.map((target) => target.rigId)).toEqual([rig.id, second.id]);
    expect(targets.every((target) => target.boneId === boneId && target.workspace === 'rig')).toBe(true);
    const qualified = { ...finding(boneId), artboardId: board.id, rigId: second.id };
    expect(resolveShipFocus(project, qualified)).toHaveLength(1);
    expect(resolveShipFocus(project, qualified)[0]!.rigId).toBe(second.id);
    expect(JSON.stringify(project)).toBe(before);
    expect(resolveShipFocus(project, finding('missing'))).toEqual([]);
    expect(resolveShipFocus(project, finding(null))).toEqual([]);
  });
  it('maps expanded component rig findings to their authored instance instead of inventing an editable rig', () => {
    const project = source(),
      board = project.artboards[0]!,
      rig = board.nodes[0] as RigNode;
    project.components = [
      {
        id: 'definition',
        name: 'Definition',
        revision: 1,
        width: 100,
        height: 100,
        nodes: [rig],
        exposed: [],
      },
    ];
    board.nodes = [
      {
        id: 'instance',
        name: 'Instance',
        type: 'instance',
        parentId: null,
        transform: rig.transform,
        opacity: 1,
        visible: true,
        componentId: 'definition',
        width: 100,
        height: 100,
        overrides: {},
      },
    ];
    const target = resolveShipFocus(project, {
      ...finding(rig.skeleton.bones[0]!.id),
      rigId: JSON.stringify(['instance', rig.id]),
      artboardId: board.id,
    })[0]!;
    expect(target).toMatchObject({
      workspace: 'scene',
      nodeId: 'instance',
      rigId: null,
      boneId: null,
      slotId: null,
    });
    expect(target.label).toContain('component instance');
    expect(resolveShipFocus(project, finding(rig.id))[0]).toMatchObject({
      workspace: 'scene',
      nodeId: 'instance',
      rigId: null,
    });
  });
  it('resolves graph owners, source textures and attachment slots for inspection', () => {
    const project = source(),
      board = project.artboards[0]!,
      rig = board.nodes[0] as RigNode;
    expect(resolveShipFocus(project, finding(board.logic!.parameters[0]!.id))[0]).toMatchObject({
      workspace: 'logic',
      rigId: null,
    });
    expect(resolveShipFocus(project, finding(rig.logic!.id))[0]).toMatchObject({
      workspace: 'logic',
      rigId: rig.id,
    });
    const slot = rig.skeleton.slots.find((slot) => slot.defaultAttachmentId !== null)!;
    const target = resolveShipFocus(project, finding(slot.defaultAttachmentId))[0]!;
    expect(target).toMatchObject({ workspace: 'rig', rigId: rig.id, slotId: slot.id });
    const textureId = rig.skeleton.attachments.find(
      (attachment) => attachment.id === slot.defaultAttachmentId,
    )!.textureId;
    expect(resolveShipFocus(project, finding(textureId)).some((target) => target.slotId === slot.id)).toBe(
      true,
    );
  });
});
