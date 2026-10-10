import { runtimeFail } from './model';

type Shape =
  | { kind: 'scalar'; types: readonly string[] }
  | { kind: 'enum'; values: readonly (string | number | boolean | null)[] }
  | { kind: 'object'; required: Record<string, Shape>; optional: Record<string, Shape> }
  | { kind: 'array'; item: Shape }
  | { kind: 'dictionary'; item: Shape }
  | { kind: 'tag'; tag: string; variants: Record<string, Shape> }
  | { kind: 'nullable'; item: Shape }
  | { kind: 'payload' };
const scalar = (...types: string[]): Shape => ({ kind: 'scalar', types });
const str = scalar('string'),
  num = scalar('number'),
  bool = scalar('boolean');
const maybeStr = scalar('string', 'null'),
  value = scalar('string', 'number', 'boolean');
const enumeration = (...values: (string | number | boolean | null)[]): Shape => ({ kind: 'enum', values });
const array = (item: Shape): Shape => ({ kind: 'array', item });
const dictionary = (item: Shape): Shape => ({ kind: 'dictionary', item });
const object = (required: Record<string, Shape>, optional: Record<string, Shape> = {}): Shape => ({
  kind: 'object',
  required,
  optional,
});
const tagged = (tag: string, variants: Record<string, Shape>): Shape => ({ kind: 'tag', tag, variants });
const numbers = array(num),
  strings = array(str);
const transformFields = { x: num, y: num, rotation: num, scaleX: num, scaleY: num, shearX: num, shearY: num };
const transform = object(transformFields);
const insets = object({ left: num, right: num, top: num, bottom: num });
const axis = object(
  { anchorMin: num, anchorMax: num, offsetMin: num, offsetMax: num, size: num, pivot: num },
  { min: num, max: num },
);
const layout = object({ x: axis, y: axis }, { aspect: num, safeArea: bool });
const curve = tagged('type', {
  linear: object({ type: enumeration('linear') }),
  stepped: object({ type: enumeration('stepped') }),
  bezier: object({ type: enumeration('bezier') }, { c1: num, c2: num, c3: num, c4: num }),
});
const payload: Shape = { kind: 'payload' };
const typedPayload = tagged(
  'type',
  Object.fromEntries(
    ['bool', 'float', 'int', 'string'].map((type) => [
      type,
      object({ type: enumeration(type), value: type === 'bool' ? bool : type === 'string' ? str : num }),
    ]),
  ),
);
const keyBase = { time: num, curve };
const timeline = tagged('kind', {
  boneProperty: object({
    kind: enumeration('boneProperty'),
    boneId: str,
    property: enumeration('x', 'y', 'rotation', 'scaleX', 'scaleY', 'shearX', 'shearY'),
    keyframes: array(object({ ...keyBase, value: num })),
  }),
  slotColor: object({
    kind: enumeration('slotColor'),
    slotId: str,
    keyframes: array(object({ ...keyBase, value: num })),
  }),
  slotAttachment: object({
    kind: enumeration('slotAttachment'),
    slotId: str,
    keyframes: array(object({ ...keyBase, attachmentId: maybeStr })),
  }),
  drawOrder: object({
    kind: enumeration('drawOrder'),
    keyframes: array(object({ ...keyBase, slotOrder: numbers })),
  }),
  deform: object({
    kind: enumeration('deform'),
    attachmentId: str,
    keyframes: array(object({ ...keyBase, offsets: { kind: 'nullable', item: numbers } })),
  }),
  event: object({
    kind: enumeration('event'),
    keyframes: array(object({ ...keyBase, eventName: str }, { payload })),
  }),
});
const animation = object({ name: str, duration: num, loop: bool, timelines: array(timeline) });
const attachmentCommon = { id: str, name: str, textureId: str };
const attachmentOptional = {
  weights: numbers,
  boneBindings: array(object({ boneId: str, matrix: numbers })),
};
const attachment = tagged('type', {
  region: object(
    { ...attachmentCommon, type: enumeration('region') },
    { ...attachmentOptional, vertices: numbers, uvs: numbers },
  ),
  mesh: object(
    { ...attachmentCommon, type: enumeration('mesh') },
    {
      ...attachmentOptional,
      meshSourceId: str,
      meshVertices: numbers,
      meshTriangles: numbers,
      meshUVs: numbers,
      meshHull: numbers,
    },
  ),
  boundingBox: object(
    { ...attachmentCommon, type: enumeration('boundingBox') },
    { meshVertices: numbers, meshHull: numbers },
  ),
  clipping: object(
    { ...attachmentCommon, type: enumeration('clipping') },
    { meshVertices: numbers, meshHull: numbers, endSlotId: maybeStr },
  ),
});
const markerCommon = { id: str, name: str, boneId: str, transform };
const markerShape = tagged('type', {
  rectangle: object({ type: enumeration('rectangle'), width: num, height: num }),
  polygon: object({ type: enumeration('polygon'), vertices: numbers }),
});
const marker = tagged(
  'kind',
  Object.fromEntries(
    ['point', 'socket', 'spawnPoint', 'hitbox', 'hurtbox', 'trigger'].map((kind) => [
      kind,
      object({
        ...markerCommon,
        kind: enumeration(kind),
        ...(['hitbox', 'hurtbox', 'trigger'].includes(kind) ? { shape: markerShape } : {}),
      }),
    ]),
  ),
);
const skeleton = object(
  {
    bones: array(object({ id: str, name: str, parentId: maybeStr, length: num, setupPose: transform })),
    slots: array(
      object(
        { id: str, name: str, boneId: str, defaultAttachmentId: maybeStr, color: num },
        { blendMode: enumeration('normal', 'add') },
      ),
    ),
    attachments: array(attachment),
    ikConstraints: array(
      object({
        id: str,
        bones: strings,
        targetId: str,
        poleVectorId: maybeStr,
        bendDirection: enumeration(1, -1),
        mix: num,
        softness: num,
        order: num,
      }),
    ),
    skins: array(object({ name: str, attachments: dictionary(str) })),
    activeSkin: str,
  },
  {
    markers: array(marker),
    transformConstraints: array(
      object({
        id: str,
        boneId: str,
        targetId: str,
        space: enumeration('world', 'local'),
        offset: transform,
        mixTranslation: num,
        mixRotation: num,
        mixScale: num,
        mixShear: num,
        order: num,
      }),
    ),
    paths: array(object({ id: str, name: str, boneId: str, segments: array(numbers), closed: bool })),
    pathConstraints: array(
      object({
        id: str,
        bones: strings,
        pathId: str,
        progress: num,
        driverId: maybeStr,
        spacing: num,
        mixTranslation: num,
        mixRotation: num,
        rotationOffset: num,
        order: num,
      }),
    ),
    secondaryConstraints: array(
      object({
        id: str,
        boneId: str,
        preset: enumeration('soft', 'bouncy', 'firm'),
        frequency: num,
        damping: num,
        mix: num,
        maxAngle: num,
        order: num,
      }),
    ),
  },
);
const condition = tagged(
  'operator',
  Object.fromEntries(
    ['fired', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte'].map((operator) => [
      operator,
      object({
        parameterId: str,
        operator: enumeration(operator),
        ...(operator === 'fired' ? {} : { value }),
      }),
    ]),
  ),
);
const parameter = tagged(
  'type',
  Object.fromEntries(
    ['bool', 'float', 'int', 'string', 'trigger'].map((type) => [
      type,
      object({
        id: str,
        name: str,
        type: enumeration(type),
        initial:
          type === 'trigger' ? enumeration(false) : type === 'bool' ? bool : type === 'string' ? str : num,
      }),
    ]),
  ),
);
const graph = object(
  {
    id: str,
    name: str,
    enabled: bool,
    entryStateId: str,
    parameters: array(parameter),
    states: array(object({ id: str, name: str, clip: maybeStr, loop: bool })),
    transitions: array(
      object(
        {
          id: str,
          from: maybeStr,
          to: str,
          priority: num,
          conditions: array(condition),
          blendDuration: num,
          interruption: enumeration('none', 'higherPriority'),
        },
        { exitTime: num },
      ),
    ),
  },
  {
    bindings: array(
      object({
        id: str,
        parameterId: str,
        instanceId: str,
        exposureName: str,
        property: enumeration('text', 'visible', 'opacity', 'tint'),
      }),
    ),
    routes: array(
      object(
        {
          id: str,
          targetId: maybeStr,
          event: enumeration(
            'pointerDown',
            'pointerUp',
            'pointerEnter',
            'pointerLeave',
            'click',
            'focus',
            'blur',
            'test',
          ),
          parameterId: str,
        },
        { value },
      ),
    ),
  },
);
const nodeCommon = {
  id: str,
  name: str,
  parentId: maybeStr,
  transform: object({ ...transformFields, pivotX: num, pivotY: num }),
  opacity: num,
  visible: bool,
};
const nodeOptional = { tint: num, layout };
const dimensions = { width: num, height: num };
const node = tagged('type', {
  group: object({ ...nodeCommon, type: enumeration('group') }, nodeOptional),
  image: object({ ...nodeCommon, type: enumeration('image'), textureId: str, ...dimensions }, nodeOptional),
  rig: object(
    { ...nodeCommon, type: enumeration('rig'), skeleton, animations: array(animation) },
    { ...nodeOptional, logic: graph },
  ),
  nineSlice: object(
    {
      ...nodeCommon,
      type: enumeration('nineSlice'),
      textureId: str,
      ...dimensions,
      sourceWidth: num,
      sourceHeight: num,
      borders: insets,
    },
    nodeOptional,
  ),
  text: object(
    {
      ...nodeCommon,
      type: enumeration('text'),
      ...dimensions,
      text: str,
      fontFamilies: strings,
      fontSize: num,
      lineHeight: num,
      direction: enumeration('ltr', 'rtl'),
      align: enumeration('start', 'center', 'end'),
      color: num,
    },
    { ...nodeOptional, binding: str },
  ),
  mask: object({ ...nodeCommon, type: enumeration('mask'), ...dimensions }, nodeOptional),
  shape: object(
    { ...nodeCommon, type: enumeration('shape'), ...dimensions, color: num, radius: num },
    nodeOptional,
  ),
  instance: object(
    {
      ...nodeCommon,
      type: enumeration('instance'),
      ...dimensions,
      componentId: str,
      overrides: dictionary(value),
    },
    nodeOptional,
  ),
});
const clip = object({
  id: str,
  name: str,
  duration: num,
  loop: bool,
  tracks: array(
    object({
      nodeId: str,
      property: enumeration(
        'x',
        'y',
        'rotation',
        'scaleX',
        'scaleY',
        'shearX',
        'shearY',
        'pivotX',
        'pivotY',
        'opacity',
      ),
      keys: array(object({ time: num, value: num, curve })),
    }),
  ),
  events: array(object({ time: num, name: str }, { payload })),
});
const boardCommon = { id: str, name: str, ...dimensions, nodes: array(node) };
export const runtimeShape = object({
  format: enumeration('bonebybone-runtime'),
  version: enumeration(1),
  id: str,
  name: str,
  defaultArtboardId: str,
  features: strings,
  textures: array(
    object({ id: str, mime: enumeration('image/png', 'image/jpeg', 'image/webp'), base64: str }),
  ),
  artboards: array(object(boardCommon, { safeArea: insets, clips: array(clip), logic: graph })),
  components: array(
    object({
      ...boardCommon,
      exposed: array(
        object({ name: str, nodeId: str, property: enumeration('text', 'tint', 'opacity', 'visible') }),
      ),
    }),
  ),
});

/** The same whitelist projects compiler output and rejects unknown fields at ingestion. */
export function projectRuntimeShape(input: unknown, strict: boolean): unknown {
  let visits = 0;
  const walk = (shape: Shape, value: unknown, path: string, owner: string | null, depth: number): unknown => {
    if (++visits > 4_000_000 || depth > 64)
      runtimeFail(
        'RESOURCE_LIMIT',
        `Runtime structure exceeds the bounded ingestion limit at ${path}.`,
        owner,
        'Split the export into smaller artboards/assets.',
      );
    const fail = (message: string, code = 'INVALID_STRUCTURE'): never =>
      runtimeFail(code, `${path}: ${message}`, owner);
    if (shape.kind === 'scalar' || shape.kind === 'enum') {
      if (
        shape.kind === 'enum'
          ? !shape.values.includes(value as string)
          : !shape.types.includes(value === null ? 'null' : typeof value)
      )
        fail('Unsupported scalar value.');
      if (typeof value === 'number' && !Number.isFinite(value)) fail('Numbers must be finite.');
      if (
        typeof value === 'string' &&
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)
      )
        fail('Strings must contain valid Unicode.');
      return value;
    }
    if (shape.kind === 'payload')
      return walk(
        typeof value === 'object' ? typedPayload : scalar('string', 'number'),
        value,
        path,
        owner,
        depth + 1,
      );
    if (shape.kind === 'array') {
      if (!Array.isArray(value)) return fail('Expected an array.');
      const result: unknown[] = [];
      for (let i = 0; i < value.length; i++)
        result.push(walk(shape.item, value[i], `${path}[${i}]`, owner, depth + 1));
      return result;
    }
    if (shape.kind === 'nullable')
      return value === null ? null : walk(shape.item, value, path, owner, depth + 1);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('Expected an object.');
    const record = value as Record<string, unknown>;
    if (Object.hasOwn(record, 'id') && typeof record.id === 'string') owner = record.id;
    if (shape.kind === 'tag') {
      const tag = record[shape.tag];
      if (typeof tag !== 'string' || !Object.hasOwn(shape.variants, tag))
        return fail(`Unknown ${shape.tag}.`);
      return walk(shape.variants[tag]!, value, path, owner, depth + 1);
    }
    if (shape.kind === 'dictionary')
      return Object.fromEntries(
        Object.keys(record)
          .sort()
          .map((key) => {
            walk(str, key, `${path} key`, owner, depth + 1);
            return [key, walk(shape.item, record[key], `${path}[${JSON.stringify(key)}]`, owner, depth + 1)];
          }),
      );
    if (strict)
      for (const key of Object.keys(record)) {
        if (!Object.hasOwn(shape.required, key) && !Object.hasOwn(shape.optional, key))
          fail(`Unknown field ${key}.`, 'UNKNOWN_FIELD');
      }
    const entries: [string, unknown][] = [];
    for (const [key, child] of Object.entries(shape.required)) {
      if (!Object.hasOwn(record, key)) fail(`Missing required field ${key}.`);
      entries.push([key, walk(child, record[key], `${path}.${key}`, owner, depth + 1)]);
    }
    for (const [key, child] of Object.entries(shape.optional))
      if (Object.hasOwn(record, key) && (strict || record[key] !== undefined)) {
        if (
          record.type === 'mesh' &&
          record.meshSourceId !== undefined &&
          ['meshVertices', 'meshUVs', 'meshTriangles', 'meshHull'].includes(key)
        ) {
          if (strict) fail('Linked meshes must omit derived geometry aliases.', 'DERIVED_GEOMETRY');
          continue;
        }
        entries.push([key, walk(child, record[key], `${path}.${key}`, owner, depth + 1)]);
      }
    return Object.fromEntries(entries);
  };
  return walk(runtimeShape, input, '$', null, 0);
}
