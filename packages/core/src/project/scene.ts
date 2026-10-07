import type { Artboard, SceneNode, SceneTransform } from './model';
import { resolveSceneLayout, type UIBox } from './ui';

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

/** Canonical affine decomposition: reflection is retained in scaleY, shearY is absorbed into shearX. */
export function sceneTransformFromMatrix(m: SceneMatrix, pivotX = 0, pivotY = 0): SceneTransform {
  const scaleX = Math.hypot(m[0], m[1]);
  if (scaleX < 1e-12) throw new Error('Cannot decompose a zero X scale.');
  const rotation = Math.atan2(m[1], m[0]),
    c = Math.cos(rotation),
    s = Math.sin(rotation);
  const scaleY = -s * m[2] + c * m[3];
  if (Math.abs(scaleY) < 1e-12) throw new Error('Cannot decompose a zero Y scale.');
  return {
    x: m[4] + m[0] * pivotX + m[2] * pivotY,
    y: m[5] + m[1] * pivotX + m[3] * pivotY,
    rotation,
    scaleX,
    scaleY,
    shearX: Math.atan((c * m[2] + s * m[3]) / scaleY),
    shearY: 0,
    pivotX,
    pivotY,
  };
}

/** Selected descendants follow their selected ancestor once, never twice. */
export function sceneSelectionRoots(artboard: Artboard, ids: readonly string[]): string[] {
  const selected = new Set(ids),
    byId = new Map(artboard.nodes.map((node) => [node.id, node]));
  return [...selected].filter((id) => {
    const node = byId.get(id);
    if (!node) throw new Error(`Scene node ${id} no longer exists.`);
    let parent = node.parentId;
    while (parent !== null) {
      if (selected.has(parent)) return false;
      parent = byId.get(parent)?.parentId ?? null;
    }
    return true;
  });
}

export function transformedSceneSelection(
  artboard: Artboard,
  ids: readonly string[],
  delta: SceneMatrix,
): Record<string, SceneTransform> {
  const evaluated = new Map(evaluateScene(artboard).map((entry) => [entry.node.id, entry]));
  return Object.fromEntries(
    sceneSelectionRoots(artboard, ids).map((id) => {
      const entry = evaluated.get(id)!;
      const parent = entry.node.parentId ? evaluated.get(entry.node.parentId)!.world : identitySceneMatrix();
      const inverse = inverseSceneMatrix(parent);
      if (delta[0] === 1 && delta[1] === 0 && delta[2] === 0 && delta[3] === 1)
        return [
          id,
          {
            ...entry.node.transform,
            x: entry.node.transform.x + inverse[0] * delta[4] + inverse[2] * delta[5],
            y: entry.node.transform.y + inverse[1] * delta[4] + inverse[3] * delta[5],
          },
        ];
      const local = multiplySceneMatrices(inverse, multiplySceneMatrices(delta, entry.world));
      const transform = sceneTransformFromMatrix(
        local,
        entry.node.transform.pivotX,
        entry.node.transform.pivotY,
      );
      transform.x -= entry.box.x;
      transform.y -= entry.box.y;
      return [id, transform];
    }),
  );
}

export function sceneReparentTransform(
  artboard: Artboard,
  nodeId: string,
  parentId: string | null,
): SceneTransform {
  const evaluated = new Map(evaluateScene(artboard).map((entry) => [entry.node.id, entry]));
  const entry = evaluated.get(nodeId);
  const parent = parentId ? evaluated.get(parentId) : null;
  if (!entry || (parentId && !parent)) throw new Error('Reparent target does not exist.');
  const local = multiplySceneMatrices(
    inverseSceneMatrix(parent?.world ?? identitySceneMatrix()),
    entry.world,
  );
  const transform = sceneTransformFromMatrix(local, entry.node.transform.pivotX, entry.node.transform.pivotY);
  const box = resolveSceneLayout({
    ...artboard,
    nodes: artboard.nodes.map((node) => (node.id === nodeId ? { ...node, parentId } : node)),
  }).get(nodeId)!;
  transform.x -= box.x;
  transform.y -= box.y;
  return transform;
}
export interface EvaluatedSceneNode {
  box: UIBox;
  node: SceneNode;
  world: SceneMatrix;
  opacity: number;
  visible: boolean;
  depth: number;
  tint: number;
}
/** Iterative depth-first traversal preserves subtree stacking and sibling array order. */
export function evaluateScene(artboard: Artboard): EvaluatedSceneNode[] {
  const boxes = resolveSceneLayout(artboard);
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
    tint: number,
  ) => {
    const list = children.get(parentId) ?? [];
    for (let i = list.length - 1; i >= 0; i--) {
      const node = list[i]!;
      const box = boxes.get(node.id)!;
      stack.push({
        node,
        box,
        world: multiplySceneMatrices(
          world,
          sceneLocalMatrix({ ...node.transform, x: node.transform.x + box.x, y: node.transform.y + box.y }),
        ),
        opacity: opacity * node.opacity,
        visible: visible && node.visible,
        depth,
        tint: multiplySceneTint(tint, node.tint ?? 0xffffff),
      });
    }
  };
  push(null, identitySceneMatrix(), 1, true, 0, 0xffffff);
  const result: EvaluatedSceneNode[] = [];
  while (stack.length) {
    const entry = stack.pop()!;
    result.push(entry);
    push(entry.node.id, entry.world, entry.opacity, entry.visible, entry.depth + 1, entry.tint);
  }
  return result;
}

export function multiplySceneTint(a: number, b: number): number {
  const channel = (shift: number) => Math.round((((a >>> shift) & 255) * ((b >>> shift) & 255)) / 255);
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}
