import type { Artboard, SceneNode, SceneTransform } from './model';

export type SceneMatrix = [number, number, number, number, number, number];
export const identitySceneMatrix = (): SceneMatrix => [1, 0, 0, 1, 0, 0];

/** Same R · shearX · shearY · scale convention as the skeletal FK solver. */
export function sceneLocalMatrix(t: SceneTransform): SceneMatrix {
  const c = Math.cos(t.rotation),
    s = Math.sin(t.rotation);
  const ex = c * Math.tan(t.shearX) - s,
    ey = s * Math.tan(t.shearX) + c;
  const a = (c + ex * Math.tan(t.shearY)) * t.scaleX;
  const b = (s + ey * Math.tan(t.shearY)) * t.scaleX;
  const cc = ex * t.scaleY,
    d = ey * t.scaleY;
  return [a, b, cc, d, t.x - a * t.pivotX - cc * t.pivotY, t.y - b * t.pivotX - d * t.pivotY];
}
export function multiplySceneMatrices(p: SceneMatrix, l: SceneMatrix): SceneMatrix {
  return [
    p[0] * l[0] + p[2] * l[1],
    p[1] * l[0] + p[3] * l[1],
    p[0] * l[2] + p[2] * l[3],
    p[1] * l[2] + p[3] * l[3],
    p[0] * l[4] + p[2] * l[5] + p[4],
    p[1] * l[4] + p[3] * l[5] + p[5],
  ];
}
export function scenePoint(m: SceneMatrix, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}
export function inverseSceneMatrix(m: SceneMatrix): SceneMatrix {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) throw new Error('Cannot edit through a zero-scale transform.');
  const a = m[3] / det,
    b = -m[1] / det,
    c = -m[2] / det,
    d = m[0] / det;
  return [a, b, c, d, -a * m[4] - c * m[5], -b * m[4] - d * m[5]];
}
export interface EvaluatedSceneNode {
  node: SceneNode;
  world: SceneMatrix;
  opacity: number;
  visible: boolean;
  depth: number;
}
/** Iterative depth-first traversal preserves subtree stacking and sibling array order. */
export function evaluateScene(artboard: Artboard): EvaluatedSceneNode[] {
  const children = new Map<string | null, SceneNode[]>();
  for (const node of artboard.nodes) {
    const list = children.get(node.parentId) ?? [];
    list.push(node);
    children.set(node.parentId, list);
  }
  const stack: EvaluatedSceneNode[] = [];
  const push = (
    parentId: string | null,
    world: SceneMatrix,
    opacity: number,
    visible: boolean,
    depth: number,
  ) => {
    const list = children.get(parentId) ?? [];
    for (let i = list.length - 1; i >= 0; i--) {
      const node = list[i]!;
      stack.push({
        node,
        world: multiplySceneMatrices(world, sceneLocalMatrix(node.transform)),
        opacity: opacity * node.opacity,
        visible: visible && node.visible,
        depth,
      });
    }
  };
  push(null, identitySceneMatrix(), 1, true, 0);
  const result: EvaluatedSceneNode[] = [];
  while (stack.length) {
    const entry = stack.pop()!;
    result.push(entry);
    push(entry.node.id, entry.world, entry.opacity, entry.visible, entry.depth + 1);
  }
  return result;
}
