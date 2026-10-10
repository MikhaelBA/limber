import { describe, expect, it } from 'vitest';
import { constraintFixture } from '../../../tools/constraint-fixtures.mjs';
import { RuntimePlayer } from '../../runtime/src/player';
import { deserializeProject, serializeProject, validateProject } from '../src/index';
describe('combined character-alpha weighted fixtures', () => {
  for (const kind of ['Standard', 'Heavy'] as const)
    it(`${kind}: all solver stages, weighted motion/deform and source roundtrip remain deterministic`, () => {
      const project = constraintFixture(kind);
      validateProject(project);
      const before = structuredClone(project);
      expect(deserializeProject(serializeProject(project))).toEqual(project);
      const node = project.artboards[0]!.nodes.find((n) => n.type === 'rig');
      if (!node || node.type !== 'rig') throw new Error('Expected combined rig');
      const a = new RuntimePlayer({
          skeleton: structuredClone(node.skeleton),
          animations: structuredClone(node.animations),
        }),
        b = new RuntimePlayer({
          skeleton: structuredClone(node.skeleton),
          animations: structuredClone(node.animations),
        });
      for (const p of [a, b]) p.setAnimation(node.animations[0]!.name, { loop: false });
      for (let n = 0; n < 60; n++) a.update(1 / 60);
      for (let n = 0; n < 10; n++) b.update(0.1);
      expect(a.getWorldTransforms()).toEqual(b.getWorldTransforms());
      expect(a.getWorldTransforms().every(Number.isFinite)).toBe(true);
      const mesh = node.skeleton.attachments.find((a) => a.type === 'mesh')!;
      expect(a.getDeformedVertices(mesh.id)).toEqual(b.getDeformedVertices(mesh.id));
      expect(a.getDeformedVertices(mesh.id).every(Number.isFinite)).toBe(true);
      expect(project).toEqual(before);
      expect(node.skeleton.secondaryConstraints?.length).toBe(kind === 'Standard' ? 12 : 22);
    }, 15000);
});
