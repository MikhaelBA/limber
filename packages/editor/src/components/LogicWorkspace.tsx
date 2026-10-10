import { useMemo, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { uuid, formatEventPayload, type LogicParameter, type LogicInput } from '@limber/core';
import { useEngine } from '../hooks/useEngine';
import { useEditorStore } from '../store/editorStore';
import { EditLogicCommand, type LogicEdit } from '../commands/logicCommands';
import { LogicPreviewSession } from '../engine/LogicPreviewSession';
import { LogicViewport } from './LogicViewport';
import { LogicGraphCanvas } from './LogicGraphCanvas';
import { LogicInspector } from './LogicInspector';
import { LogicValueInput } from './LogicValueInput';
const button = 'rounded border border-neutral-600 px-2 py-1 text-xs hover:bg-neutral-700 disabled:opacity-40';
const input = 'rounded border border-neutral-600 bg-neutral-900 px-2 py-1 text-xs';
export function LogicWorkspace() {
  const engine = useEngine(),
    ui = useEditorStore();
  const [boardId, setBoardId] = useState(engine.project.editor.activeArtboardId),
    [rigId, setRigId] = useState<string | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [error, setError] = useState(''),
    [, redraw] = useState(0);
  const board = engine.project.artboards.find((b) => b.id === boardId) ?? engine.project.artboards[0]!;
  const rig = board.nodes.find((node) => node.id === rigId && node.type === 'rig');
  const owner = { artboardId: board.id, rigId: rig?.id ?? null };
  const graph = rig?.type === 'rig' ? rig.logic : board.logic;
  const session = useMemo(
    () => new LogicPreviewSession(engine.project, owner),
    [engine, ui.documentEpoch, ui.dataRevision, owner.artboardId, owner.rigId],
  );
  const snapshot = session.player?.snapshot() ?? null;
  const inputGroups = [
    ...new Map(
      (graph?.routes ?? []).map((route) => [JSON.stringify([route.event, route.targetId]), route]),
    ).values(),
  ];
  const update = () => redraw((value) => value + 1);
  const run = (action: () => void): boolean => {
    try {
      action();
      setError('');
      update();
      return true;
    } catch (error) {
      const message = (error as Error).message;
      setError(message);
      ui.setStatus(message);
      return false;
    }
  };
  const edit = (intent: LogicEdit) =>
    run(() => ui.execute(new EditLogicCommand(engine.project, owner, intent)));
  const clips =
    rig?.type === 'rig'
      ? rig.animations.filter((clip) => clip.duration > 0).map((clip) => ({ id: clip.name, name: clip.name }))
      : (board.clips ?? [])
          .filter((clip) => clip.duration > 0)
          .map((clip) => ({ id: clip.id, name: clip.name }));
  const create = () => {
    const id = uuid(),
      parameters: LogicParameter[] = [];
    if (owner.rigId === null)
      for (const node of board.nodes)
        if (
          node.type === 'text' &&
          node.binding !== undefined &&
          !parameters.some((p) => p.name === node.binding)
        )
          parameters.push({ id: uuid(), name: node.binding, type: 'string', initial: node.text });
    edit({
      kind: 'create',
      graph: {
        id: uuid(),
        name: `${rig?.name ?? board.name} behavior`,
        enabled: true,
        entryStateId: id,
        parameters,
        states: [{ id, name: 'Idle', clip: null, loop: false, position: { x: 30, y: 100 } }],
        transitions: [],
      },
    });
    setSelected(id);
  };
  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Logic workspace">
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-700 px-3 py-2">
        <label>
          Artboard{' '}
          <select
            aria-label="Logic artboard"
            className={input}
            value={board.id}
            onChange={(event) => {
              setBoardId(event.target.value);
              setRigId(null);
              setSelected(null);
            }}
          >
            {engine.project.artboards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Graph owner{' '}
          <select
            aria-label="Logic owner"
            className={input}
            value={owner.rigId ?? ''}
            onChange={(event) => {
              setRigId(event.target.value || null);
              setSelected(null);
            }}
          >
            {[
              <option key="scene" value="">
                Scene · {board.name}
              </option>,
              ...board.nodes
                .filter((n) => n.type === 'rig')
                .map((node) => (
                  <option key={node.id} value={node.id}>
                    Character · {node.name}
                  </option>
                )),
            ]}
          </select>
        </label>
        <button className={button} disabled={!ui.canUndo} onClick={() => run(() => ui.undo())}>
          Undo
        </button>
        <button className={button} disabled={!ui.canRedo} onClick={() => run(() => ui.redo())}>
          Redo
        </button>
        <span className="text-xs text-neutral-400">
          Source edits reset preview. Test values are temporary.
        </span>
      </div>
      {error && (
        <p role="alert" className="border-b border-red-700 bg-red-950 px-3 py-2 text-sm">
          {error}
        </p>
      )}
      <PanelGroup direction="vertical" className="min-h-0 flex-1">
        <Panel defaultSize={65} minSize={30}>
          <PanelGroup direction="horizontal">
            <Panel defaultSize={21} minSize={14}>
              <aside className="h-full overflow-y-auto p-3 text-xs" aria-label="Logic test controls">
                <h2 className="mb-2 font-semibold">Interaction preview</h2>
                <div className="mb-3 flex flex-wrap gap-1">
                  <button
                    className={button}
                    disabled={!session.player}
                    onClick={() => run(() => (session.playing ? session.pause() : session.play()))}
                  >
                    {session.playing ? 'Pause Logic' : 'Play Logic'}
                  </button>
                  <button
                    className={button}
                    disabled={!session.player || session.playing}
                    onClick={() => run(() => session.step())}
                  >
                    Step Logic
                  </button>
                  <button
                    className={button}
                    disabled={!session.player}
                    onClick={() => run(() => session.reset())}
                  >
                    Reset Logic
                  </button>
                </div>
                {snapshot && (
                  <label className="mb-3 flex gap-2">
                    <input
                      type="checkbox"
                      checked={snapshot.enabled}
                      onChange={(event) => run(() => session.setEnabled(event.target.checked))}
                    />
                    Test Logic enabled
                  </label>
                )}
                {graph?.parameters.map((parameter) => (
                  <div key={parameter.id} className="mb-3">
                    <label className="mb-1 block">
                      {parameter.name} <span className="text-neutral-400">({parameter.type})</span>
                    </label>
                    {parameter.type === 'trigger' ? (
                      <div className="flex gap-1">
                        <button
                          className={button}
                          onClick={() => run(() => session.player!.fire(parameter.name))}
                        >
                          Fire {parameter.name}
                        </button>
                        <button
                          className={button}
                          onClick={() => run(() => session.player!.resetTrigger(parameter.name))}
                        >
                          Clear {parameter.name}
                        </button>
                      </div>
                    ) : (
                      <LogicValueInput
                        key={`${ui.dataRevision}:${parameter.id}`}
                        type={parameter.type}
                        value={snapshot!.parameters[parameter.name]!}
                        label={`Test ${parameter.name}`}
                        onChange={(value) => {
                          if (
                            !run(() =>
                              session.input({
                                name: parameter.name,
                                type: parameter.type,
                                value,
                              } as LogicInput),
                            )
                          )
                            throw new Error('Invalid test value.');
                        }}
                      />
                    )}
                  </div>
                ))}
                {!!graph?.routes?.length && <h3 className="my-2 font-semibold">Send authored inputs</h3>}
                {inputGroups.map((route) => (
                  <button
                    key={route.id}
                    className={`${button} mb-1 block w-full text-left`}
                    onClick={() => run(() => session.dispatch(route.event, route.targetId))}
                  >
                    Send {route.event} to{' '}
                    {route.targetId === null
                      ? 'viewport'
                      : board.nodes.find((n) => n.id === route.targetId)?.name}
                  </button>
                ))}
                <p className="mt-3 text-neutral-400">
                  Click or focus the preview, or use typed test controls. Pause holds state; Step commits one
                  tick.
                </p>
              </aside>
            </Panel>
            <PanelResizeHandle className="w-1 bg-neutral-800 hover:bg-sky-600" />
            <Panel minSize={30}>
              <div className="relative flex h-full min-h-0 flex-col">
                <div
                  className="pointer-events-none absolute left-2 top-2 z-10 rounded bg-neutral-950/90 px-3 py-2 text-xs"
                  aria-label="Logic debug overlay"
                >
                  <output data-testid="logic-state">
                    State: {graph?.states.find((s) => s.id === snapshot?.stateId)?.name ?? 'No graph'}
                  </output>
                  <div>
                    Tick: <output data-testid="logic-tick">{snapshot?.tick ?? 0}</output> ·{' '}
                    {snapshot?.enabled ? 'Enabled' : 'Disabled'} · {session.playing ? 'Playing' : 'Paused'}
                  </div>
                  <div data-testid="logic-blend">
                    Blend:{' '}
                    {snapshot?.transition
                      ? `${(snapshot.transition.progress * 100).toFixed(1)}% · priority ${snapshot.transition.priority}`
                      : '—'}
                  </div>
                </div>
                <LogicViewport
                  session={session}
                  fonts={engine.project.fonts}
                  components={engine.project.components}
                  onFrame={update}
                  onError={(message) => {
                    setError(message);
                    ui.setStatus(message);
                  }}
                />
              </div>
            </Panel>
            <PanelResizeHandle className="w-1 bg-neutral-800 hover:bg-sky-600" />
            <Panel defaultSize={28} minSize={18}>
              {graph ? (
                <LogicInspector
                  graph={graph}
                  board={board}
                  components={engine.project.components}
                  rig={owner.rigId !== null}
                  clips={clips}
                  selected={selected}
                  onSelect={setSelected}
                  onEdit={edit}
                />
              ) : (
                <div className="p-4 text-sm">
                  <p className="mb-3">Create a graph for this owner to author states and inputs.</p>
                  <button className={button} onClick={create}>
                    Create Logic graph
                  </button>
                </div>
              )}
            </Panel>
          </PanelGroup>
        </Panel>
        <PanelResizeHandle className="h-1 bg-neutral-800 hover:bg-sky-600" />
        <Panel defaultSize={35} minSize={15}>
          <div className="flex h-full min-h-0">
            {graph ? (
              <LogicGraphCanvas
                key={`${ui.documentEpoch}:${graph.id}`}
                graph={graph}
                snapshot={snapshot}
                selected={selected}
                onSelect={setSelected}
                onEdit={edit}
              />
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-neutral-400">
                States and transitions appear here.
              </div>
            )}
            <aside
              className="w-72 shrink-0 overflow-y-auto border-l border-neutral-700 p-2 text-xs"
              aria-label="Logic debug history"
            >
              <h3 className="font-semibold">Recent changes</h3>
              {session.player
                ?.recentChanges()
                .slice(-8)
                .map((change, i) => (
                  <div key={i}>
                    {change.tick}: {change.kind} · {change.name} = {String(change.value).slice(0, 128)}
                  </div>
                ))}
              <h3 className="mt-2 font-semibold">Input receipts</h3>
              {session.player?.inputRouter.recentDispatches(8).map((receipt) => (
                <div key={receipt.sequence}>
                  {receipt.tick}/{receipt.sequence}: {receipt.event} · {receipt.routeIds.length} writes
                </div>
              ))}
              <h3 className="mt-2 font-semibold">Events</h3>
              {session.recentEvents.slice(-8).map(({ event, ownerId }, i) => (
                <div key={i} title={ownerId}>
                  {event.eventName} · {formatEventPayload(event.payload)}
                </div>
              ))}
            </aside>
          </div>
        </Panel>
      </PanelGroup>
    </section>
  );
}
