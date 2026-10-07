import type { Artboard, BoneByBoneProject, SceneNode } from './model';

export interface UIInsets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
export interface UILayoutAxis {
  anchorMin: number;
  anchorMax: number;
  offsetMin: number;
  offsetMax: number;
  size: number;
  pivot: number;
  min?: number;
  max?: number;
}
export interface UILayout {
  x: UILayoutAxis;
  y: UILayoutAxis;
  aspect?: number;
  safeArea?: boolean;
}
export type UIOverrideValue = string | number | boolean;
export type UIExposedProperty = 'text' | 'tint' | 'opacity' | 'visible';
export interface UIComponent {
  id: string;
  name: string;
  revision: number;
  width: number;
  height: number;
  nodes: SceneNode[];
  exposed: { name: string; nodeId: string; property: UIExposedProperty }[];
}
export interface UIBox {
  x: number;
  y: number;
  width: number;
  height: number;
}
export const UI_MASK_LIMIT = 8;
export const UI_COMPONENT_LIMIT = 16;
export const UI_EXPANDED_NODE_LIMIT = 100000;
export const DEVICE_PRESETS = [
  { name: 'Phone portrait', width: 390, height: 844, safeArea: { left: 0, right: 0, top: 47, bottom: 34 } },
  { name: 'Phone landscape', width: 844, height: 390, safeArea: { left: 47, right: 47, top: 0, bottom: 21 } },
  { name: 'Tablet', width: 1024, height: 768, safeArea: { left: 0, right: 0, top: 24, bottom: 20 } },
  { name: 'Desktop', width: 1280, height: 720, safeArea: { left: 0, right: 0, top: 0, bottom: 0 } },
] as const;

export function uiAxis(size = 100, anchor = 0.5): UILayoutAxis {
  return { anchorMin: anchor, anchorMax: anchor, offsetMin: 0, offsetMax: 0, size, pivot: 0.5 };
}
export function uiLayout(width = 100, height = 100): UILayout {
  return { x: uiAxis(width), y: uiAxis(height) };
}
function axisBox(axis: UILayoutAxis, size: number, origin: number) {
  const start = origin - size / 2 + size * axis.anchorMin + axis.offsetMin;
  const available =
    axis.anchorMin === axis.anchorMax
      ? axis.size
      : Math.max(0, size * (axis.anchorMax - axis.anchorMin) - axis.offsetMin - axis.offsetMax);
  const result = Math.min(axis.max ?? Infinity, Math.max(axis.min ?? 0, available));
  const center =
    axis.anchorMin === axis.anchorMax
      ? start + (0.5 - axis.pivot) * result
      : start + axis.pivot * available + (0.5 - axis.pivot) * result;
  return { size: result, center };
}
/** Pure, deterministic box solver. Transforms are applied later; dimensions never include scale. */
export function resolveUIBox(layout: UILayout, parent: UIBox): UIBox {
  const x = axisBox(layout.x, parent.width, parent.x),
    y = axisBox(layout.y, parent.height, parent.y);
  let width = x.size,
    height = y.size;
  if (layout.aspect) {
    width = Math.min(width, height * layout.aspect);
    height = width / layout.aspect;
    // Reapply minima jointly while preserving the ratio; validation guarantees max compatibility.
    const minimumWidth = Math.max(layout.x.min ?? 0, (layout.y.min ?? 0) * layout.aspect);
    width = Math.max(width, minimumWidth);
    height = width / layout.aspect;
  }
  return {
    x: x.center + (0.5 - layout.x.pivot) * (width - x.size),
    y: y.center + (0.5 - layout.y.pivot) * (height - y.size),
    width,
    height,
  };
}
export function safeUIBox(artboard: Pick<Artboard, 'width' | 'height' | 'safeArea'>): UIBox {
  const s = artboard.safeArea ?? { left: 0, right: 0, top: 0, bottom: 0 };
  return {
    x: (s.left - s.right) / 2,
    y: (s.top - s.bottom) / 2,
    width: artboard.width - s.left - s.right,
    height: artboard.height - s.top - s.bottom,
  };
}
/** Layout boxes indexed by source node ID. Input must have passed project validation. */
export function resolveSceneLayout(artboard: Artboard): Map<string, UIBox> {
  const children = new Map<string | null, SceneNode[]>();
  for (const node of artboard.nodes) {
    const list = children.get(node.parentId) ?? [];
    list.push(node);
    children.set(node.parentId, list);
  }
  const root = { x: 0, y: 0, width: artboard.width, height: artboard.height };
  const result = new Map<string, UIBox>();
  const stack: { node: SceneNode; parent: UIBox }[] = (children.get(null) ?? []).map((node) => ({
    node,
    parent: root,
  }));
  while (stack.length) {
    const { node, parent } = stack.pop()!;
    const containing = node.parentId === null && node.layout?.safeArea ? safeUIBox(artboard) : parent;
    const box = node.layout
      ? resolveUIBox(node.layout, containing)
      : {
          x: 0,
          y: 0,
          width: 'width' in node ? node.width : parent.width,
          height: 'height' in node ? node.height : parent.height,
        };
    result.set(node.id, box);
    for (const child of children.get(node.id) ?? [])
      stack.push({ node: child, parent: { ...box, x: 0, y: 0 } });
  }
  return result;
}
/** Exact source/destination strips; destination corners only shrink when borders cannot fit. */
export function nineSliceGrid(
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
  borders: UIInsets,
) {
  const sx = Math.min(1, width / Math.max(Number.EPSILON, borders.left + borders.right));
  const sy = Math.min(1, height / Math.max(Number.EPSILON, borders.top + borders.bottom));
  return {
    sourceX: [0, borders.left, sourceWidth - borders.right, sourceWidth],
    sourceY: [0, borders.top, sourceHeight - borders.bottom, sourceHeight],
    x: [-width / 2, -width / 2 + borders.left * sx, width / 2 - borders.right * sx, width / 2],
    y: [-height / 2, -height / 2 + borders.top * sy, height / 2 - borders.bottom * sy, height / 2],
  };
}
export interface ExpandedUIScene {
  artboard: Artboard;
  owners: Map<string, string>;
}
/** Definitions stay shared; expansion never mutates source nodes or stored overrides. */
export function expandUIComponents(
  project: Pick<BoneByBoneProject, 'components'>,
  artboard: Artboard,
): ExpandedUIScene {
  const definitions = new Map((project.components ?? []).map((component) => [component.id, component]));
  const nodes: SceneNode[] = [],
    owners = new Map<string, string>();
  const reserved = new Set(artboard.nodes.map((node) => node.id));
  const append = (
    source: SceneNode[],
    parentId: string | null,
    path: string[],
    owner: string | null,
    chain: string[],
    overrides: Map<string, Partial<SceneNode>>,
  ) => {
    if (chain.length > UI_COMPONENT_LIMIT) throw new Error('Component nesting exceeds the supported limit.');
    const ids = new Map(
      source.map((node) => [node.id, path.length ? JSON.stringify([...path, node.id]) : node.id]),
    );
    for (const original of source) {
      const id = ids.get(original.id)!;
      if (path.length && reserved.has(id))
        throw new Error('Expanded component ID collides with an authored node.');
      if (path.length) reserved.add(id);
      const node = {
        ...original,
        ...overrides.get(original.id),
        id,
        parentId: original.parentId === null ? parentId : ids.get(original.parentId)!,
      } as SceneNode;
      nodes.push(node);
      owners.set(id, owner ?? original.id);
      if (nodes.length > UI_EXPANDED_NODE_LIMIT) throw new Error('Expanded component node budget exceeded.');
      if (node.type !== 'instance') continue;
      const definition = definitions.get(node.componentId);
      if (!definition) throw new Error('Component definition is missing.');
      if (chain.includes(definition.id)) throw new Error('Component dependency cycle.');
      const patches = new Map<string, Partial<SceneNode>>();
      for (const exposed of definition.exposed) {
        if (!Object.hasOwn(node.overrides, exposed.name)) continue;
        patches.set(exposed.nodeId, {
          ...patches.get(exposed.nodeId),
          [exposed.property]: node.overrides[exposed.name],
        });
      }
      append(
        definition.nodes,
        id,
        [...path, original.id],
        owner ?? original.id,
        [...chain, definition.id],
        patches,
      );
    }
  };
  append(artboard.nodes, null, [], null, [], new Map());
  return { artboard: { ...artboard, nodes }, owners };
}
