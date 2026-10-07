import { describe, expect, it } from 'vitest';
import {
  evaluateScene,
  sceneLocalMatrix,
  sceneTransform,
  scenePoint,
  inverseSceneMatrix,
  type Artboard,
} from '../src';

describe('scene evaluation', () => {
  it('composes mirrored nonuniform shear and pivot transforms with inherited visibility and opacity', () => {
    const artboard: Artboard = {
      id: 'a',
      name: 'A',
      width: 100,
      height: 100,
      nodes: [
        {
          id: 'child',
          name: 'Child',
          type: 'group',
          parentId: 'parent',
          transform: { ...sceneTransform(), x: 10, pivotX: 3 },
          opacity: 0.4,
          visible: true,
        },
        {
          id: 'parent',
          name: 'Parent',
          type: 'group',
          parentId: null,
          transform: { ...sceneTransform(), scaleX: -2, scaleY: 3, shearX: 0.2, x: 20 },
          opacity: 0.5,
          visible: false,
        },
      ],
    };
    const result = evaluateScene(artboard);
    expect(result.map((n) => n.node.id)).toEqual(['parent', 'child']);
    expect(result[1]!.opacity).toBeCloseTo(0.2);
    expect(result[1]!.visible).toBe(false);
    expect(scenePoint(result[1]!.world, 3, 0)).toEqual({ x: 0, y: 0 });
    const m = sceneLocalMatrix({
      ...sceneTransform(),
      rotation: 0.6,
      scaleX: -2,
      scaleY: 3,
      shearX: 0.2,
      shearY: -0.1,
      pivotX: 10,
      pivotY: 20,
      x: 4,
      y: 7,
    });
    const p = scenePoint(m, 30, -40);
    const back = scenePoint(inverseSceneMatrix(m), p.x, p.y);
    expect(back.x).toBeCloseTo(30, 10);
    expect(back.y).toBeCloseTo(-40, 10);
    expect(scenePoint(m, 10, 20).x).toBeCloseTo(4);
    expect(scenePoint(m, 10, 20).y).toBeCloseTo(7);
  });
  it('traverses 10000 ancestors without recursion and rejects singular inverses', () => {
    const artboard: Artboard = {
      id: 'a',
      name: 'A',
      width: 100,
      height: 100,
      nodes: Array.from({ length: 10000 }, (_, i) => ({
        id: String(i),
        name: 'G',
        type: 'group',
        parentId: i ? String(i - 1) : null,
        transform: { ...sceneTransform(), x: 1 },
        opacity: 1,
        visible: true,
      })),
    };
    const result = evaluateScene(artboard);
    expect(result.at(-1)!.world[4]).toBe(10000);
    expect(() => inverseSceneMatrix([0, 0, 0, 1, 0, 0])).toThrow(/zero-scale/);
  });
});
