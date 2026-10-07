import type { Artboard, BoneByBoneProject, SceneNode } from './model';
import { expandUIComponents, UI_MASK_LIMIT } from './ui';

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}
function number(value: unknown, label: string, min = 0, max = Infinity): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw new Error(`Invalid ${label}.`);
}
function text(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid ${label}.`);
}
function list(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}
function color(value: unknown) {
  number(value, 'UI color', 0, 0xffffff);
  if (!Number.isInteger(value)) throw new Error('UI color must be an integer.');
}
export function validateUIInsets(value: unknown, width: number, height: number): void {
  const inset = object(value, 'Insets');
  for (const key of ['left', 'right', 'top', 'bottom']) number(inset[key], `inset ${key}`);
  if (Number(inset.left) + Number(inset.right) > width || Number(inset.top) + Number(inset.bottom) > height)
    throw new Error('Opposing insets exceed the source dimensions.');
}
export function validateUINode(node: Record<string, unknown>): void {
  if (node.layout !== undefined) {
    const layout = object(node.layout, 'Layout');
    for (const key of ['x', 'y']) {
      const axis = object(layout[key], `Layout ${key}`);
      number(axis.anchorMin, 'minimum anchor', 0, 1);
      number(axis.anchorMax, 'maximum anchor', Number(axis.anchorMin), 1);
      number(axis.offsetMin, 'start offset', -Infinity);
      number(axis.offsetMax, 'end offset', -Infinity);
      number(axis.size, 'fixed size');
      number(axis.pivot, 'layout pivot', 0, 1);
      if (axis.min !== undefined) number(axis.min, 'minimum size');
      if (axis.max !== undefined) number(axis.max, 'maximum size', Number(axis.min ?? 0));
    }
    if (layout.aspect !== undefined) {
      number(layout.aspect, 'aspect ratio', Number.EPSILON);
      const x = object(layout.x, 'Layout x'),
        y = object(layout.y, 'Layout y');
      if (
        Math.max(Number(x.min ?? 0), Number(y.min ?? 0) * layout.aspect) >
        Math.min(Number(x.max ?? Infinity), Number(y.max ?? Infinity) * layout.aspect)
      )
        throw new Error('Aspect ratio is incompatible with size bounds.');
    }
    if (layout.safeArea !== undefined && typeof layout.safeArea !== 'boolean')
      throw new Error('Safe-area layout flag must be boolean.');
  }
  if (['text', 'mask', 'shape', 'instance', 'nineSlice'].includes(String(node.type))) {
    number(node.width, 'UI width');
    number(node.height, 'UI height');
  }
  if (node.type === 'nineSlice') {
    number(node.sourceWidth, 'slice source width', 1);
    number(node.sourceHeight, 'slice source height', 1);
    validateUIInsets(node.borders, node.sourceWidth, node.sourceHeight);
  } else if (node.type === 'text') {
    if (typeof node.text !== 'string') throw new Error('Text content must be a string.');
    const fonts = list(node.fontFamilies, 'Font families');
    if (!fonts.length) throw new Error('Text requires a font fallback list.');
    for (const font of fonts) text(font, 'font family');
    number(node.fontSize, 'font size', 1, 512);
    number(node.lineHeight, 'line height', 1, 4096);
    if (!['ltr', 'rtl'].includes(String(node.direction)))
      throw new Error('Text direction must be ltr or rtl.');
    if (!['start', 'center', 'end'].includes(String(node.align))) throw new Error('Invalid text alignment.');
    color(node.color);
    if (node.binding !== undefined) text(node.binding, 'text binding');
  } else if (node.type === 'shape') {
    color(node.color);
    number(node.radius, 'shape radius');
  } else if (node.type === 'instance') {
    text(node.componentId, 'component reference');
    object(node.overrides, 'Component overrides');
  }
}
/** Called after the common project node/hierarchy validation, before the editor sees the project. */
export function validateUIProject(project: BoneByBoneProject): void {
  const definitions = project.components ?? [];
  for (const definition of definitions) {
    number(definition.revision, 'component revision', 1);
    if (!Number.isInteger(definition.revision)) throw new Error('Component revision must be an integer.');
    const exposedNames = new Set<string>();
    const targets = new Set<string>();
    for (const raw of list(definition.exposed, 'Exposed properties')) {
      const exposed = object(raw, 'Exposed property');
      text(exposed.name, 'exposed property name');
      text(exposed.nodeId, 'exposed target');
      const target = definition.nodes.find((node) => node.id === exposed.nodeId);
      if (!target) throw new Error('Exposed component target is missing.');
      if (
        !['text', 'tint', 'opacity', 'visible'].includes(String(exposed.property)) ||
        (exposed.property === 'text' && target.type !== 'text')
      )
        throw new Error('Unsupported exposed component property.');
      const key = JSON.stringify([exposed.nodeId, exposed.property]);
      if (exposedNames.has(exposed.name) || targets.has(key))
        throw new Error('Duplicate exposed component property.');
      exposedNames.add(exposed.name);
      targets.add(key);
    }
  }
  for (const container of [...project.artboards, ...definitions]) {
    for (const node of container.nodes) {
      if (node.type !== 'instance') continue;
      const definition = definitions.find((definition) => definition.id === node.componentId);
      if (!definition) throw new Error('Component definition is missing.');
      for (const [name, value] of Object.entries(node.overrides)) {
        const exposed = definition.exposed.find((exposed) => exposed.name === name);
        if (!exposed)
          throw new Error(
            `Unknown component override ${name}; explicitly migrate overrides before removing exposed properties.`,
          );
        if (exposed.property === 'text') {
          if (typeof value !== 'string') throw new Error('Text override must be a string.');
        } else if (exposed.property === 'visible') {
          if (typeof value !== 'boolean') throw new Error('Visibility override must be boolean.');
        } else if (exposed.property === 'opacity') number(value, 'opacity override', 0, 1);
        else color(value);
      }
    }
    const expanded = expandUIComponents(project, container as Artboard).artboard;
    // Count all masks in the expanded ancestry, including masks crossing component boundaries.
    const byId = new Map(expanded.nodes.map((node) => [node.id, node]));
    const depths = new Map<string, number>();
    for (const node of expanded.nodes) {
      const path = [];
      let cursor: string | null = node.id;
      while (cursor !== null && !depths.has(cursor)) {
        const entry: SceneNode = byId.get(cursor)!;
        path.push(entry);
        cursor = entry.parentId;
      }
      let depth = cursor === null ? 0 : depths.get(cursor)!;
      for (const entry of path.reverse()) {
        depth += entry.type === 'mask' ? 1 : 0;
        if (depth > UI_MASK_LIMIT) throw new Error(`Mask nesting exceeds ${UI_MASK_LIMIT}.`);
        depths.set(entry.id, depth);
      }
    }
  }
}
