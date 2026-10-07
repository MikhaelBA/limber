import { useState } from 'react';
import {
  sceneTransform,
  uuid,
  type Artboard,
  type BoneByBoneProject,
  type UIExposedProperty,
} from '@limber/core';
import { EditUICommand } from '../commands/uiCommands';
import { EditSceneCommand, sceneSubtreeIds } from '../commands/sceneCommands';
import type { Command } from '../history/history';
import { UINodeInspector } from './UINodeInspector';

const button = 'rounded border border-neutral-600 px-2 py-1 text-xs hover:bg-neutral-700 disabled:opacity-40';
const input = 'rounded border border-neutral-600 bg-neutral-900 p-1 text-xs';
export function UIComponentLibrary({
  project,
  artboard,
  selection,
  run,
}: {
  project: BoneByBoneProject;
  artboard: Artboard;
  selection: string[];
  run: (command: Command) => boolean;
}) {
  const [componentId, setComponentId] = useState(''),
    [nodeId, setNodeId] = useState(''),
    [property, setProperty] = useState<UIExposedProperty>('text'),
    [name, setName] = useState('label');
  const components = project.components ?? [],
    component = components.find((c) => c.id === componentId) ?? components[0];
  const node = component?.nodes.find((node) => node.id === nodeId) ?? component?.nodes[0];
  return (
    <details className="relative text-xs">
      <summary className={button}>Components</summary>
      <div
        className="absolute left-0 top-full z-30 max-h-[65vh] w-80 overflow-auto rounded border border-neutral-600 bg-neutral-900 p-3 shadow-xl"
        aria-label="Component library"
      >
        <button
          className={button}
          disabled={selection.length !== 1}
          onClick={() => {
            const id = uuid(),
              nodeId = selection[0]!;
            if (
              run(
                new EditUICommand(project, {
                  kind: 'extract',
                  artboardId: artboard.id,
                  nodeId,
                  componentId: id,
                  idMap: Object.fromEntries(
                    [...sceneSubtreeIds(artboard.nodes, [nodeId])].map((id) => [id, uuid()]),
                  ),
                }),
              )
            )
              setComponentId(id);
          }}
        >
          Make component from selection
        </button>
        <label className="my-2 block">
          Definition
          <select
            className={`${input} w-full`}
            aria-label="Component definition"
            value={component?.id ?? ''}
            onChange={(e) => {
              setComponentId(e.target.value);
              setNodeId('');
            }}
          >
            <option value="" disabled>
              Select component
            </option>
            {components.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · v{c.revision}
              </option>
            ))}
          </select>
        </label>
        {component && (
          <>
            <button
              className={button}
              onClick={() =>
                run(
                  new EditSceneCommand(project, artboard.id, {
                    kind: 'add',
                    node: {
                      id: uuid(),
                      name: component.name,
                      type: 'instance',
                      componentId: component.id,
                      parentId: null,
                      transform: sceneTransform(),
                      opacity: 1,
                      visible: true,
                      width: component.width,
                      height: component.height,
                      overrides: {},
                    },
                  }),
                )
              }
            >
              Add instance
            </button>
            <button
              className={`${button} ml-1`}
              onClick={() =>
                run(new EditUICommand(project, { kind: 'removeComponent', componentId: component.id }))
              }
            >
              Delete definition
            </button>
            <label className="my-2 block">
              Definition node
              <select
                className={`${input} w-full`}
                aria-label="Component node"
                value={node?.id ?? ''}
                onChange={(e) => setNodeId(e.target.value)}
              >
                {component.nodes.map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.name} · {node.type}
                  </option>
                ))}
              </select>
            </label>
            {node && (
              <>
                <UINodeInspector
                  node={node}
                  components={components}
                  onChange={(updated) =>
                    run(
                      new EditUICommand(project, {
                        kind: 'component',
                        component: {
                          ...component,
                          nodes: component.nodes.map((n) => (n.id === updated.id ? updated : n)),
                        },
                      }),
                    )
                  }
                />
                <div className="flex gap-1">
                  <input
                    className={`${input} w-24`}
                    aria-label="Exposed property name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                  <select
                    className={input}
                    aria-label="Exposed property"
                    value={property}
                    onChange={(e) => setProperty(e.target.value as UIExposedProperty)}
                  >
                    {(['text', 'tint', 'opacity', 'visible'] as const).map((p) => (
                      <option key={p} disabled={p === 'text' && node.type !== 'text'}>
                        {p}
                      </option>
                    ))}
                  </select>
                  <button
                    className={button}
                    disabled={!name.trim()}
                    onClick={() =>
                      run(
                        new EditUICommand(project, {
                          kind: 'component',
                          component: {
                            ...component,
                            exposed: [...component.exposed, { name: name.trim(), nodeId: node.id, property }],
                          },
                        }),
                      )
                    }
                  >
                    Expose
                  </button>
                </div>
              </>
            )}
            <ul className="mt-2 space-y-1">
              {component.exposed.map((exposed) => (
                <li key={exposed.name}>
                  {exposed.name} → {exposed.property}{' '}
                  <button
                    className={button}
                    aria-label={`Remove exposed ${exposed.name}`}
                    onClick={() =>
                      run(
                        new EditUICommand(project, {
                          kind: 'component',
                          component: {
                            ...component,
                            exposed: component.exposed.filter((p) => p.name !== exposed.name),
                          },
                        }),
                      )
                    }
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </details>
  );
}
