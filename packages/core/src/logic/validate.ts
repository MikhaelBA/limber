import type { LogicGraph, LogicClipCatalog, LogicParameter, LogicValue, LogicBinding } from './model';
import { LOGIC_ROUTE_EVENTS } from './model';
export class LogicValidationError extends Error {
  constructor(
    readonly code: string,
    readonly objectId: string | null,
    message: string,
  ) {
    super(message);
    this.name = 'LogicValidationError';
  }
}
function fail(code: string, message: string, id: string | null = null): never {
  throw new LogicValidationError(code, id, message);
}
function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    fail('INVALID_OBJECT', `${label} must be an object.`);
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) fail('INVALID_TEXT', `${label} must be a nonempty string.`);
}
function bounded(
  value: unknown,
  min: number,
  max: number,
  label: string,
  id: string | null = null,
): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    fail('INVALID_NUMBER', `${label} must be finite in [${min}, ${max}].`, id);
}
function list(value: unknown, max: number, label: string): unknown[] {
  if (!Array.isArray(value) || value.length > max)
    fail('INVALID_ARRAY', `${label} must be an array of at most ${max} entries.`);
  return value;
}
/** Validate first; float evaluation then canonicalizes to IEEE-754 binary32. */
export function validateLogicValue(
  type: LogicParameter['type'],
  value: unknown,
  label = 'Parameter',
): asserts value is LogicValue {
  if (type === 'bool' || type === 'trigger') {
    if (typeof value !== 'boolean') fail('INVALID_VALUE', `${label} requires a boolean.`);
  } else if (type === 'string') {
    if (typeof value !== 'string' || value.length > 4096)
      fail('INVALID_VALUE', `${label} requires a string of at most 4096 code units.`);
  } else {
    if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isFinite(Math.fround(value)))
      fail('INVALID_VALUE', `${label} requires a finite Float32-range number.`);
    if (type === 'int' && (!Number.isInteger(value) || value < -2147483648 || value > 2147483647))
      fail('INVALID_VALUE', `${label} requires a signed 32-bit integer.`);
  }
}
export function canonicalLogicValue(type: LogicParameter['type'], value: LogicValue): LogicValue {
  return type === 'float' ? Math.fround(value as number) : value;
}
export const LOGIC_BINDING_TYPES = {
  text: 'string',
  visible: 'bool',
  opacity: 'float',
  tint: 'int',
} as const;
/** Property domains validate before parameter publication, including authored initial values. */
export function validateLogicBindingValue(
  property: LogicBinding['property'],
  value: unknown,
  id: string,
): void {
  validateLogicValue(LOGIC_BINDING_TYPES[property], value, `Binding ${id}`);
  if (
    (property === 'opacity' && ((value as number) < 0 || (value as number) > 1)) ||
    (property === 'tint' && ((value as number) < 0 || (value as number) > 0xffffff))
  )
    fail(
      'INVALID_BINDING_VALUE',
      `Binding ${id} requires ${property} in ${property === 'opacity' ? '[0,1]' : '[0,0xffffff]'}.`,
      id,
    );
}

/** Pure bounded structural validation; never sorts or mutates source. */
export function validateLogicGraph(value: unknown, catalog: LogicClipCatalog): asserts value is LogicGraph {
  const graph = record(value, 'Logic graph'),
    ids = new Set<string>();
  const take = (value: unknown, label: string) => {
    text(value, label);
    if (ids.has(value)) fail('DUPLICATE_ID', `Duplicate Logic ID ${value}.`, value);
    ids.add(value);
    return value;
  };
  take(graph.id, 'Graph ID');
  text(graph.name, 'Graph name');
  text(graph.entryStateId, 'Entry state ID');
  if (typeof graph.enabled !== 'boolean') fail('INVALID_ENABLED', 'Logic enabled must be boolean.');
  const parameters = new Map<string, Record<string, unknown>>(),
    names = new Set<string>();
  for (const item of list(graph.parameters, 128, 'Parameters')) {
    const p = record(item, 'Parameter'),
      id = take(p.id, 'Parameter ID');
    text(p.name, 'Parameter name');
    if (names.has(p.name)) fail('DUPLICATE_NAME', `Duplicate parameter name ${p.name}.`, id);
    names.add(p.name);
    if (typeof p.type !== 'string' || !['bool', 'float', 'int', 'string', 'trigger'].includes(p.type))
      fail('INVALID_TYPE', 'Unknown parameter type.', id);
    validateLogicValue(p.type as LogicParameter['type'], p.initial, `Parameter ${p.name}`);
    if (p.type === 'trigger' && p.initial !== false)
      fail('INVALID_TRIGGER', 'Triggers must start false.', id);
    parameters.set(id, p);
  }
  const states = new Map<string, Record<string, unknown>>();
  names.clear();
  const stateItems = list(graph.states, 256, 'States');
  if (!stateItems.length) fail('EMPTY_GRAPH', 'Create at least one state.');
  for (const item of stateItems) {
    const state = record(item, 'State'),
      id = take(state.id, 'State ID');
    text(state.name, 'State name');
    if (names.has(state.name)) fail('DUPLICATE_NAME', `Duplicate state name ${state.name}.`, id);
    names.add(state.name);
    if (state.clip !== null) {
      text(state.clip, 'State clip');
      const clip = catalog.get(state.clip);
      if (!clip || !Number.isFinite(clip.duration) || clip.duration <= 0)
        fail('MISSING_CLIP', `State ${state.name} needs an existing positive-duration clip.`, id);
    }
    if (typeof state.loop !== 'boolean') fail('INVALID_LOOP', 'State loop must be boolean.', id);
    if (state.position !== undefined) {
      const p = record(state.position, 'State position');
      bounded(p.x, -1e6, 1e6, 'Graph X', id);
      bounded(p.y, -1e6, 1e6, 'Graph Y', id);
    }
    states.set(id, state);
  }
  if (!states.has(graph.entryStateId))
    fail('MISSING_ENTRY', 'Entry state does not exist.', graph.entryStateId);
  const priorities = new Set<number>(),
    immediate = new Map([...states.keys()].map((id) => [id, [] as string[]]));
  for (const item of list(graph.transitions, 1024, 'Transitions')) {
    const t = record(item, 'Transition'),
      id = take(t.id, 'Transition ID');
    text(t.to, 'Destination state');
    if (!states.has(t.to)) fail('MISSING_STATE', 'Transition destination does not exist.', id);
    if (t.from !== null) {
      text(t.from, 'Source state');
      if (!states.has(t.from)) fail('MISSING_STATE', 'Transition source does not exist.', id);
    }
    if (t.from === t.to)
      fail('SELF_TRANSITION', 'Local self transitions are unsupported; use another destination.', id);
    bounded(t.priority, 0, Number.MAX_SAFE_INTEGER, 'Transition priority', id);
    if (!Number.isSafeInteger(t.priority) || priorities.has(t.priority))
      fail('DUPLICATE_PRIORITY', 'Use a unique nonnegative integer transition priority.', id);
    priorities.add(t.priority);
    bounded(t.blendDuration, 0, 10, 'Blend duration', id);
    if (typeof t.interruption !== 'string' || !['none', 'higherPriority'].includes(t.interruption))
      fail('INVALID_INTERRUPTION', 'Unknown transition interruption policy.', id);
    if (t.exitTime !== undefined) {
      bounded(t.exitTime, 0, 1, 'Normalized exit time', id);
      if (t.from === null) fail('ANY_EXIT_TIME', 'Any State cannot use an exit-time guard.', id);
      if (t.exitTime > 0 && states.get(t.from as string)!.clip === null)
        fail('SETUP_EXIT_TIME', 'A setup state cannot use positive exit time.', id);
    }
    const conditions = list(t.conditions, 32, 'Conditions');
    for (const item of conditions) {
      const c = record(item, 'Condition');
      text(c.parameterId, 'Condition parameter');
      const p = parameters.get(c.parameterId);
      if (!p) fail('MISSING_PARAMETER', 'Condition parameter does not exist.', id);
      if (p.type === 'trigger') {
        if (c.operator !== 'fired' || c.value !== undefined)
          fail('INVALID_CONDITION', 'Trigger conditions use fired without a literal.', id);
      } else {
        const operators =
          p.type === 'float' || p.type === 'int' ? ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'] : ['eq', 'neq'];
        if (typeof c.operator !== 'string' || !operators.includes(c.operator))
          fail('INVALID_CONDITION', `Condition operator is incompatible with ${String(p.type)}.`, id);
        validateLogicValue(p.type as LogicParameter['type'], c.value, 'Condition literal');
      }
    }
    if (!conditions.length && (t.exitTime === undefined || t.exitTime === 0)) {
      const sources = t.from === null ? [...states.keys()].filter((s) => s !== t.to) : [t.from as string];
      for (const source of sources) immediate.get(source)!.push(t.to);
    }
  }
  const writers = new Set<string>();
  for (const item of list(graph.bindings === undefined ? [] : graph.bindings, 256, 'Bindings')) {
    const b = record(item, 'Binding'),
      id = take(b.id, 'Binding ID');
    for (const key of Object.keys(b))
      if (!['id', 'parameterId', 'instanceId', 'exposureName', 'property'].includes(key))
        fail('INVALID_BINDING', `Unknown binding field ${key}.`, id);
    text(b.parameterId, 'Binding parameter');
    text(b.instanceId, 'Binding instance');
    text(b.exposureName, 'Binding exposure');
    if (typeof b.property !== 'string' || !Object.hasOwn(LOGIC_BINDING_TYPES, b.property))
      fail('INVALID_BINDING_PROPERTY', 'Bind text, visible, opacity or tint.', id);
    const p = parameters.get(b.parameterId);
    if (!p) fail('MISSING_PARAMETER', 'Binding parameter does not exist.', id);
    const property = b.property as LogicBinding['property'];
    if (p.type !== LOGIC_BINDING_TYPES[property])
      fail('INVALID_BINDING_TYPE', `${property} binding requires ${LOGIC_BINDING_TYPES[property]}.`, id);
    validateLogicBindingValue(property, p.initial, id);
    const target = JSON.stringify([b.instanceId, b.exposureName]);
    if (writers.has(target)) fail('DUPLICATE_BINDING', 'Only one parameter may write an exposure.', id);
    writers.add(target);
  }
  for (const item of list(graph.routes === undefined ? [] : graph.routes, 256, 'Routes')) {
    const route = record(item, 'Route'),
      id = take(route.id, 'Route ID');
    for (const key of Object.keys(route))
      if (!['id', 'targetId', 'event', 'parameterId', 'value'].includes(key))
        fail('INVALID_ROUTE', `Unknown route field ${key}.`, id);
    if (route.targetId !== null) text(route.targetId, 'Route target');
    if (!(LOGIC_ROUTE_EVENTS as readonly unknown[]).includes(route.event))
      fail('INVALID_ROUTE_EVENT', 'Use a pointer, focus or test event.', id);
    text(route.parameterId, 'Route parameter');
    const p = parameters.get(route.parameterId);
    if (!p) fail('MISSING_PARAMETER', 'Route parameter does not exist.', id);
    if (p.type === 'trigger') {
      if (Object.hasOwn(route, 'value'))
        fail('INVALID_ROUTE_VALUE', 'Trigger routes fire without a value.', id);
    } else {
      validateLogicValue(p.type as LogicParameter['type'], route.value, `Route ${id}`);
      for (const binding of (graph.bindings ?? []) as LogicBinding[])
        if (binding.parameterId === route.parameterId)
          validateLogicBindingValue(binding.property, route.value, id);
    }
  }
  // Reject only unconditional immediate cycles. Guarded locomotion cycles are valid.
  const indegree = new Map([...states.keys()].map((id) => [id, 0]));
  for (const destinations of immediate.values())
    for (const to of destinations) indegree.set(to, indegree.get(to)! + 1);
  const ready = [...indegree].filter(([, n]) => n === 0).map(([id]) => id);
  for (let n = 0; n < ready.length; n++)
    for (const to of immediate.get(ready[n]!)!)
      if (indegree.set(to, indegree.get(to)! - 1).get(to) === 0) ready.push(to);
  if (ready.length !== states.size)
    fail('IMMEDIATE_CYCLE', 'Unconditional immediate cycle: add a condition or positive exit time.');
}
