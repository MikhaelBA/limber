import {
  sceneTransformFromMatrix,
  transformedSceneSelection,
  sceneReparentTransform,
  multiplySceneMatrices,
  multiplySceneTint,
} from '../src';
import { seededRandom } from './fixtures';
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

describe('scene gesture math', () => {
  it('round-trips 1000 mirrored, sheared and pivoted affine transforms', () => {
    const random = seededRandom();
    for (let i = 0; i < 1000; i++) {
      const t = {
        ...sceneTransform(),
        x: random() * 500,
        y: random() * 500,
        rotation: random() * 6 - 3,
        scaleX: (random() + 0.1) * (i % 2 ? -1 : 1),
        scaleY: (random() + 0.1) * (i % 3 ? -1 : 1),
        shearX: random() - 0.5,
        shearY: random() - 0.5,
        pivotX: random() * 50,
        pivotY: random() * 50,
      };
      const m = sceneLocalMatrix(t),
        roundtrip = sceneLocalMatrix(sceneTransformFromMatrix(m, t.pivotX, t.pivotY));
      m.forEach((value, index) => expect(roundtrip[index]).toBeCloseTo(value, 8));
    }
  });
  it('moves selected parents and children exactly once while retaining channel values', () => {
    const artboard: Artboard = {
      id: 'a',
      name: 'A',
      width: 100,
      height: 100,
      nodes: [
        {
          id: 'parent',
          name: 'P',
          type: 'group',
          parentId: null,
          transform: { ...sceneTransform(), scaleX: -2, shearY: 0.2 },
          opacity: 1,
          visible: true,
        },
        {
          id: 'child',
          name: 'C',
          type: 'group',
          parentId: 'parent',
          transform: { ...sceneTransform(), x: 10 },
          opacity: 1,
          visible: true,
        },
      ],
    };
    const before = evaluateScene(artboard),
      values = transformedSceneSelection(artboard, ['parent', 'child'], [1, 0, 0, 1, 30, 40]);
    expect(Object.keys(values)).toEqual(['parent']);
    expect(values.parent!.scaleX).toBe(-2);
    expect(values.parent!.shearY).toBe(0.2);
    const after = evaluateScene({
      ...artboard,
      nodes: artboard.nodes.map((n) => (values[n.id] ? { ...n, transform: values[n.id]! } : n)),
    });
    expect(after[1]!.world[4] - before[1]!.world[4]).toBeCloseTo(30);
    expect(after[1]!.world[5] - before[1]!.world[5]).toBeCloseTo(40);
  });
  it('preserves world transforms when changing mirrored and nonuniform parents', () => {
    const artboard: Artboard = {
      id: 'a',
      name: 'A',
      width: 100,
      height: 100,
      nodes: [
        {
          id: 'old',
          name: 'P',
          type: 'group',
          parentId: null,
          transform: { ...sceneTransform(), scaleX: -2, scaleY: 3, rotation: 0.5 },
          opacity: 1,
          visible: true,
        },
        {
          id: 'new',
          name: 'P',
          type: 'group',
          parentId: null,
          transform: { ...sceneTransform(), scaleX: 4, scaleY: -2, shearX: 0.4, rotation: -0.8 },
          opacity: 1,
          visible: true,
        },
        {
          id: 'child',
          name: 'C',
          type: 'group',
          parentId: 'old',
          transform: { ...sceneTransform(), x: 10, y: 20, pivotX: 4, pivotY: 6 },
          opacity: 1,
          visible: true,
        },
      ],
    };
    const before = evaluateScene(artboard).find((n) => n.node.id === 'child')!.world;
    const transform = sceneReparentTransform(artboard, 'child', 'new');
    const parent = evaluateScene(artboard).find((n) => n.node.id === 'new')!.world;
    const after = multiplySceneMatrices(parent, sceneLocalMatrix(transform));
    before.forEach((value, i) => expect(after[i]).toBeCloseTo(value, 8));
    expect(multiplySceneTint(0xff8080, 0x80ff80)).toBe(0x808040);
  });
});
