import { useState } from 'react';
import type { LogicGraph, LogicValue } from '@limber/core';
import type { NativeArtboardPlayer } from '@limber/runtime';
import { LogicValueInput } from './LogicValueInput';

/** Controls operate on packaged player state only; source graphs remain read-only. */
export function NativeLogicControls({
  player,
  graph,
  owner,
  refresh,
  onError,
}: {
  player: NativeArtboardPlayer;
  graph: LogicGraph | undefined;
  owner: string;
  refresh: () => void;
  onError: (message: string) => void;
}) {
  const [error, setError] = useState('');
  const target = owner ? player.getRig(owner) : player.scene;
  const snapshot = target.snapshot().logic;
  const run = (action: () => void) => {
    try {
      action();
      setError('');
      refresh();
      return true;
    } catch (failure) {
      const message = (failure as Error).message;
      setError(message);
      onError(message);
      return false;
    }
  };
  if (!graph) return <p>This owner has no packaged Logic graph.</p>;
  if (target.mode !== 'logic')
    return (
      <button
        className="rounded border border-neutral-600 px-2 py-1"
        onClick={() => run(() => target.useLogic())}
      >
        Use packaged Logic
      </button>
    );
  const change = (name: string, type: string, value: LogicValue) =>
    run(() => {
      switch (type) {
        case 'bool':
          target.setBool(name, value as boolean);
          break;
        case 'float':
          target.setFloat(name, value as number);
          break;
        case 'int':
          target.setInt(name, value as number);
          break;
        case 'string':
          target.setString(name, value as string);
          break;
      }
    });
  const routes = [
    ...new Map(
      (graph.routes ?? []).map((route) => [JSON.stringify([route.event, route.targetId]), route]),
    ).values(),
  ];
  return (
    <div aria-label="Native Logic controls" className="space-y-2">
      <label className="block">
        <input
          type="checkbox"
          aria-label="Native Logic enabled"
          checked={snapshot?.enabled ?? false}
          onChange={(e) => run(() => target.setLogicEnabled(e.target.checked))}
        />{' '}
        Logic enabled
      </label>
      <p data-testid="native-logic-state">
        State: {graph.states.find((state) => state.id === snapshot?.stateId)?.name ?? 'Unmeasured'}
      </p>
      <p>Changes are queued for the next accepted native tick. Pause and Step to inspect them.</p>
      {graph.parameters.map((parameter) => (
        <label key={parameter.id} className="block">
          {parameter.name} · {parameter.type}
          {parameter.type === 'trigger' ? (
            <span className="flex gap-1">
              <button
                className="rounded border border-neutral-600 px-2 py-1"
                onClick={() => run(() => target.fire(parameter.name))}
              >
                Fire {parameter.name}
              </button>
              <button
                className="rounded border border-neutral-600 px-2 py-1"
                onClick={() => run(() => target.resetTrigger(parameter.name))}
              >
                Reset {parameter.name}
              </button>
            </span>
          ) : (
            <LogicValueInput
              type={parameter.type}
              value={snapshot?.parameters[parameter.name] ?? parameter.initial}
              label={`Native parameter ${parameter.name}`}
              onChange={(value) => change(parameter.name, parameter.type, value)}
            />
          )}
        </label>
      ))}
      {routes.map((route) => (
        <button
          key={JSON.stringify([route.event, route.targetId])}
          className="mr-1 rounded border border-neutral-600 px-2 py-1"
          onClick={() =>
            run(() => {
              if (owner) player.getRig(owner).dispatch(route.event);
              else player.dispatch(route.event, route.targetId);
            })
          }
        >
          Send {route.event} · {route.targetId ?? 'Viewport'}
        </button>
      ))}
      {snapshot && (
        <details>
          <summary>Native Logic snapshot</summary>
          <pre className="overflow-auto text-[10px]" data-testid="native-logic-snapshot">
            {JSON.stringify(snapshot, null, 2)}
          </pre>
        </details>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
