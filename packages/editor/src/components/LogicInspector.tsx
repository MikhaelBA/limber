import {
  uuid,
  LOGIC_BINDING_TYPES,
  LOGIC_ROUTE_EVENTS,
  type LogicGraph,
  type LogicParameter,
  type LogicCondition,
  type LogicValue,
  type Artboard,
  type UIComponent,
} from '@limber/core';
import type { LogicEdit } from '../commands/logicCommands';
import { LogicValueInput } from './LogicValueInput';
const input = 'w-full rounded border border-neutral-600 bg-neutral-900 px-2 py-1';
const button = 'rounded border border-neutral-600 px-2 py-1 hover:bg-neutral-700 disabled:opacity-40';
function Field({
  label,
  value,
  numeric = false,
  commit,
}: {
  label: string;
  value: string | number;
  numeric?: boolean;
  commit: (value: string) => boolean;
}) {
  return (
    <label className="block">
      {label}
      <input
        key={String(value)}
        aria-label={label}
        className={input}
        type={numeric ? 'number' : 'text'}
        step="any"
        defaultValue={value}
        onBlur={(event) => {
          if (event.target.value !== String(value) && !commit(event.target.value))
            event.target.value = String(value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
    </label>
  );
}
const name = (values: readonly { name: string }[], base: string) => {
  for (let i = 1; ; i++) if (!values.some((v) => v.name === `${base} ${i}`)) return `${base} ${i}`;
};
function condition(p: LogicParameter): LogicCondition {
  return p.type === 'trigger'
    ? { parameterId: p.id, operator: 'fired' }
    : { parameterId: p.id, operator: 'eq', value: p.initial };
}
interface Props {
  graph: LogicGraph;
  board: Artboard;
  components?: UIComponent[];
  rig: boolean;
  clips: { id: string; name: string }[];
  selected: string | null;
  onSelect: (id: string) => void;
  onEdit: (edit: LogicEdit) => boolean;
}
export function LogicInspector({
  graph,
  board,
  components = [],
  rig,
  clips,
  selected,
  onSelect,
  onEdit,
}: Props) {
  const parameter = graph.parameters.find((p) => p.id === selected),
    state = graph.states.find((s) => s.id === selected),
    transition = graph.transitions.find((t) => t.id === selected),
    binding = graph.bindings?.find((b) => b.id === selected),
    route = graph.routes?.find((r) => r.id === selected);
  const add = (edit: LogicEdit, id: string) => {
    if (onEdit(edit)) onSelect(id);
  };
  const instances = board.nodes.filter((n) => n.type === 'instance');
  const candidates = instances.flatMap(
    (instance) =>
      components
        .find((c) => c.id === instance.componentId)
        ?.exposed.map((exposure) => ({ instance, exposure })) ?? [],
  );
  const availableBinding = candidates.find(
    ({ instance, exposure }) =>
      graph.parameters.some((p) => p.type === LOGIC_BINDING_TYPES[exposure.property]) &&
      !graph.bindings?.some((b) => b.instanceId === instance.id && b.exposureName === exposure.name),
  );
  const routeParameter = route && graph.parameters.find((p) => p.id === route.parameterId);
  const checked = (ok: boolean) => {
    if (!ok) throw new Error('Invalid Logic value.');
  };
  return (
    <aside
      className="h-full overflow-y-auto border-l border-neutral-700 p-3 text-xs"
      aria-label="Logic inspector"
    >
      <div className="space-y-2">
        <Field
          label="Graph name"
          value={graph.name}
          commit={(name) => onEdit({ kind: 'settings', patch: { name } })}
        />
        <label className="flex gap-2">
          <input
            type="checkbox"
            checked={graph.enabled}
            onChange={(event) => onEdit({ kind: 'settings', patch: { enabled: event.target.checked } })}
          />
          Graph enabled by default
        </label>
        <label className="block">
          Entry state
          <select
            aria-label="Entry state"
            className={input}
            value={graph.entryStateId}
            onChange={(event) => onEdit({ kind: 'settings', patch: { entryStateId: event.target.value } })}
          >
            {graph.states.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-1">
          <button
            className={button}
            onClick={() => {
              const id = uuid();
              add(
                {
                  kind: 'addParameter',
                  parameter: { id, name: name(graph.parameters, 'Parameter'), type: 'float', initial: 0 },
                },
                id,
              );
            }}
          >
            Add parameter
          </button>
          <button
            className={button}
            onClick={() => {
              const id = uuid();
              add(
                {
                  kind: 'addState',
                  state: {
                    id,
                    name: name(graph.states, 'State'),
                    clip: null,
                    loop: false,
                    position: {
                      x: 30 + (graph.states.length % 4) * 230,
                      y: 100 + Math.floor(graph.states.length / 4) * 120,
                    },
                  },
                },
                id,
              );
            }}
          >
            Add state
          </button>
          <button
            className={button}
            disabled={graph.states.length < 2}
            onClick={() => {
              const id = uuid(),
                from = state ?? graph.states[0]!,
                to = graph.states.find((s) => s.id !== from.id)!;
              add(
                {
                  kind: 'addTransition',
                  transition: {
                    id,
                    from: from.id,
                    to: to.id,
                    priority: Math.max(-1, ...graph.transitions.map((t) => t.priority)) + 1,
                    conditions: graph.parameters[0] ? [condition(graph.parameters[0])] : [],
                    blendDuration: 0.1,
                    interruption: 'higherPriority',
                  },
                },
                id,
              );
            }}
          >
            Add transition
          </button>
          <button
            className={button}
            disabled={rig || !availableBinding}
            onClick={() => {
              if (!availableBinding) return;
              const { instance, exposure } = availableBinding,
                id = uuid();
              add(
                {
                  kind: 'addBinding',
                  binding: {
                    id,
                    instanceId: instance.id,
                    exposureName: exposure.name,
                    property: exposure.property,
                    parameterId: graph.parameters.find(
                      (p) => p.type === LOGIC_BINDING_TYPES[exposure.property],
                    )!.id,
                  },
                },
                id,
              );
            }}
          >
            Add binding
          </button>
          <button
            className={button}
            disabled={!graph.parameters.length}
            onClick={() => {
              const id = uuid(),
                p = graph.parameters[0]!;
              add(
                {
                  kind: 'addRoute',
                  route: {
                    id,
                    targetId: null,
                    event: 'test',
                    parameterId: p.id,
                    ...(p.type === 'trigger' ? {} : { value: p.initial }),
                  },
                },
                id,
              );
            }}
          >
            Add input route
          </button>
        </div>
      </div>
      <div className="my-3 space-y-2 border-y border-neutral-700 py-2">
        {(
          [
            ['Parameters', graph.parameters],
            ['States', graph.states],
            [
              'Transitions',
              graph.transitions.map((t) => ({
                id: t.id,
                name: `${t.from === null ? 'Any State' : graph.states.find((s) => s.id === t.from)!.name} → ${graph.states.find((s) => s.id === t.to)!.name} (${t.priority})`,
              })),
            ],
            [
              'Bindings',
              (graph.bindings ?? []).map((b) => ({
                id: b.id,
                name: `${b.exposureName} ← ${graph.parameters.find((p) => p.id === b.parameterId)!.name}`,
              })),
            ],
            [
              'Input routes',
              (graph.routes ?? []).map((r) => ({
                id: r.id,
                name: `${r.event} → ${graph.parameters.find((p) => p.id === r.parameterId)!.name}`,
              })),
            ],
          ] as [string, { id: string; name: string }[]][]
        ).map(([label, values]) => (
          <details key={label} open>
            <summary>
              {label} ({values.length})
            </summary>
            <div className="mt-1 flex flex-col gap-1">
              {values.map((value) => (
                <button
                  key={value.id}
                  className={`rounded px-2 py-1 text-left ${selected === value.id ? 'bg-sky-900' : 'hover:bg-neutral-800'}`}
                  onClick={() => onSelect(value.id)}
                >
                  {value.name}
                </button>
              ))}
            </div>
          </details>
        ))}
      </div>
      <div className="space-y-2" key={selected}>
        {parameter && (
          <>
            <Field
              label="Parameter name"
              value={parameter.name}
              commit={(name) =>
                onEdit({ kind: 'parameter', id: parameter.id, parameter: { ...parameter, name } })
              }
            />
            <label className="block">
              Parameter type
              <select
                aria-label="Parameter type"
                className={input}
                value={parameter.type}
                onChange={(event) => {
                  const type = event.target.value as LogicParameter['type'];
                  onEdit({
                    kind: 'parameter',
                    id: parameter.id,
                    parameter: {
                      id: parameter.id,
                      name: parameter.name,
                      type,
                      initial: type === 'string' ? '' : type === 'trigger' || type === 'bool' ? false : 0,
                    } as LogicParameter,
                  });
                }}
              >
                {['bool', 'float', 'int', 'string', 'trigger'].map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
            </label>
            {parameter.type !== 'trigger' && (
              <label className="block">
                Initial value
                <LogicValueInput
                  type={parameter.type}
                  value={parameter.initial}
                  label="Parameter initial value"
                  onChange={(initial) => {
                    if (initial !== parameter.initial)
                      checked(
                        onEdit({
                          kind: 'parameter',
                          id: parameter.id,
                          parameter: { ...parameter, initial } as LogicParameter,
                        }),
                      );
                  }}
                />
              </label>
            )}
            <button className={button} onClick={() => onEdit({ kind: 'removeParameter', id: parameter.id })}>
              Delete parameter
            </button>
          </>
        )}
        {state && (
          <>
            <Field
              label="State name"
              value={state.name}
              commit={(name) => onEdit({ kind: 'state', id: state.id, patch: { name } })}
            />
            <label className="block">
              State clip
              <select
                aria-label="State clip"
                className={input}
                value={state.clip ?? ''}
                onChange={(event) =>
                  onEdit({ kind: 'state', id: state.id, patch: { clip: event.target.value || null } })
                }
              >
                <option value="">Setup</option>
                {clips.map((clip) => (
                  <option key={clip.id} value={clip.id}>
                    {clip.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex gap-2">
              <input
                type="checkbox"
                checked={state.loop}
                onChange={(event) =>
                  onEdit({ kind: 'state', id: state.id, patch: { loop: event.target.checked } })
                }
              />
              Loop state clip
            </label>
            <button
              className={button}
              disabled={graph.states.length === 1}
              onClick={() => onEdit({ kind: 'removeState', id: state.id })}
            >
              Delete state
            </button>
          </>
        )}
        {transition && (
          <>
            <label className="block">
              From
              <select
                aria-label="Transition from"
                className={input}
                value={transition.from ?? ''}
                onChange={(event) =>
                  onEdit({
                    kind: 'transition',
                    id: transition.id,
                    patch: { from: event.target.value || null },
                  })
                }
              >
                <option value="">Any State</option>
                {graph.states.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              To
              <select
                aria-label="Transition to"
                className={input}
                value={transition.to}
                onChange={(event) =>
                  onEdit({ kind: 'transition', id: transition.id, patch: { to: event.target.value } })
                }
              >
                {graph.states.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <Field
              label="Transition priority"
              numeric
              value={transition.priority}
              commit={(value) =>
                onEdit({
                  kind: 'transition',
                  id: transition.id,
                  patch: { priority: value.trim() ? Number(value) : NaN },
                })
              }
            />
            <Field
              label="Blend seconds"
              numeric
              value={transition.blendDuration}
              commit={(value) =>
                onEdit({
                  kind: 'transition',
                  id: transition.id,
                  patch: { blendDuration: value.trim() ? Number(value) : NaN },
                })
              }
            />
            <Field
              label="Exit time (0–1, blank for none)"
              numeric
              value={transition.exitTime ?? ''}
              commit={(value) =>
                onEdit({
                  kind: 'transition',
                  id: transition.id,
                  patch: { exitTime: value.trim() ? Number(value) : undefined },
                })
              }
            />
            <label className="block">
              Interruption
              <select
                aria-label="Transition interruption"
                className={input}
                value={transition.interruption}
                onChange={(event) =>
                  onEdit({
                    kind: 'transition',
                    id: transition.id,
                    patch: { interruption: event.target.value as 'none' | 'higherPriority' },
                  })
                }
              >
                <option value="none">None</option>
                <option value="higherPriority">Higher priority</option>
              </select>
            </label>
            <p>All conditions must pass.</p>
            {transition.conditions.map((guard, i) => {
              const p = graph.parameters.find((p) => p.id === guard.parameterId)!,
                change = (next: LogicCondition | null) =>
                  onEdit({
                    kind: 'transition',
                    id: transition.id,
                    patch: {
                      conditions: transition.conditions.flatMap((g, index) =>
                        index !== i ? [g] : next ? [next] : [],
                      ),
                    },
                  });
              return (
                <div key={`${i}:${p.id}`} className="space-y-1 rounded border border-neutral-700 p-2">
                  <select
                    aria-label={`Condition ${i + 1} parameter`}
                    className={input}
                    value={p.id}
                    onChange={(event) =>
                      change(condition(graph.parameters.find((p) => p.id === event.target.value)!))
                    }
                  >
                    {graph.parameters.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label={`Condition ${i + 1} operator`}
                    className={input}
                    value={guard.operator}
                    onChange={(event) =>
                      change({
                        ...guard,
                        operator: event.target.value,
                        ...(p.type === 'trigger'
                          ? {}
                          : { value: 'value' in guard ? guard.value : p.initial }),
                      } as LogicCondition)
                    }
                  >
                    {(p.type === 'trigger'
                      ? ['fired']
                      : p.type === 'bool' || p.type === 'string'
                        ? ['eq', 'neq']
                        : ['eq', 'neq', 'gt', 'gte', 'lt', 'lte']
                    ).map((op) => (
                      <option key={op}>{op}</option>
                    ))}
                  </select>
                  {'value' in guard && (
                    <LogicValueInput
                      type={p.type}
                      value={guard.value}
                      label={`Condition ${i + 1} value`}
                      onChange={(value) => {
                        if (value !== guard.value) checked(change({ ...guard, value }));
                      }}
                    />
                  )}
                  <button className={button} onClick={() => change(null)}>
                    Remove condition {i + 1}
                  </button>
                </div>
              );
            })}
            <button
              className={button}
              disabled={!graph.parameters.length}
              onClick={() =>
                onEdit({
                  kind: 'transition',
                  id: transition.id,
                  patch: { conditions: [...transition.conditions, condition(graph.parameters[0]!)] },
                })
              }
            >
              Add condition
            </button>
            <button
              className={button}
              onClick={() => onEdit({ kind: 'removeTransition', id: transition.id })}
            >
              Delete transition
            </button>
          </>
        )}
        {binding && (
          <>
            <label className="block">
              Binding exposure
              <select
                aria-label="Binding exposure"
                className={input}
                value={JSON.stringify([binding.instanceId, binding.exposureName])}
                onChange={(event) => {
                  const [instanceId, exposureName] = JSON.parse(event.target.value) as string[],
                    target = candidates.find(
                      (c) => c.instance.id === instanceId && c.exposure.name === exposureName,
                    )!;
                  const p = graph.parameters.find(
                    (p) => p.type === LOGIC_BINDING_TYPES[target.exposure.property],
                  );
                  if (p)
                    onEdit({
                      kind: 'binding',
                      id: binding.id,
                      patch: {
                        instanceId,
                        exposureName,
                        property: target.exposure.property,
                        parameterId: p.id,
                      },
                    });
                }}
              >
                {candidates
                  .filter((c) =>
                    graph.parameters.some((p) => p.type === LOGIC_BINDING_TYPES[c.exposure.property]),
                  )
                  .map(({ instance, exposure }) => (
                    <option
                      key={JSON.stringify([instance.id, exposure.name])}
                      value={JSON.stringify([instance.id, exposure.name])}
                    >
                      {instance.name} · {exposure.name} ({exposure.property})
                    </option>
                  ))}
              </select>
            </label>
            <label className="block">
              Binding parameter
              <select
                aria-label="Binding parameter"
                className={input}
                value={binding.parameterId}
                onChange={(event) =>
                  onEdit({ kind: 'binding', id: binding.id, patch: { parameterId: event.target.value } })
                }
              >
                {graph.parameters
                  .filter((p) => p.type === LOGIC_BINDING_TYPES[binding.property])
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
            <button className={button} onClick={() => onEdit({ kind: 'removeBinding', id: binding.id })}>
              Delete binding
            </button>
          </>
        )}
        {route && routeParameter && (
          <>
            <label className="block">
              Input target
              <select
                aria-label="Input target"
                className={input}
                value={route.targetId ?? ''}
                onChange={(event) =>
                  onEdit({ kind: 'route', id: route.id, patch: { targetId: event.target.value || null } })
                }
              >
                <option value="">Viewport</option>
                {!rig &&
                  board.nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="block">
              Input event
              <select
                aria-label="Input event"
                className={input}
                value={route.event}
                onChange={(event) =>
                  onEdit({
                    kind: 'route',
                    id: route.id,
                    patch: { event: event.target.value as typeof route.event },
                  })
                }
              >
                {LOGIC_ROUTE_EVENTS.map((event) => (
                  <option key={event}>{event}</option>
                ))}
              </select>
            </label>
            <label className="block">
              Input parameter
              <select
                aria-label="Input parameter"
                className={input}
                value={route.parameterId}
                onChange={(event) => {
                  const p = graph.parameters.find((p) => p.id === event.target.value)!;
                  onEdit({
                    kind: 'route',
                    id: route.id,
                    patch: { parameterId: p.id, value: p.type === 'trigger' ? undefined : p.initial },
                  });
                }}
              >
                {graph.parameters.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            {routeParameter.type === 'trigger' ? (
              <p>Fires the trigger.</p>
            ) : (
              <LogicValueInput
                type={routeParameter.type}
                value={route.value as LogicValue}
                label="Input value"
                onChange={(value) => {
                  if (value !== route.value)
                    checked(onEdit({ kind: 'route', id: route.id, patch: { value } }));
                }}
              />
            )}
            <button className={button} onClick={() => onEdit({ kind: 'removeRoute', id: route.id })}>
              Delete input route
            </button>
          </>
        )}
        {!parameter && !state && !transition && !binding && !route && <p>Select a graph item to edit it.</p>}
      </div>
      <button className={`${button} mt-4 text-red-300`} onClick={() => onEdit({ kind: 'removeGraph' })}>
        Remove graph
      </button>
    </aside>
  );
}
