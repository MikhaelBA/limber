import { SceneMotionSession } from '../engine/SceneMotionSession';
import { EditSceneMotionCommand } from '../commands/sceneMotionCommands';
import { SceneTimeline } from './SceneTimeline';
import { SceneTree } from './SceneTree';
import { useEffect, useRef, useState } from 'react';
import {
  sceneTransform,
  uuid,
  type SceneNode,
  type SceneTransform,
  type SceneProperty,
  type SceneMotionPose,
} from '@limber/core';
import { useEngine } from '../hooks/useEngine';
import { emptySkeletonData } from '../engine/EditorEngine';
import { textureRegistry } from '../engine/TextureRegistry';
import { useEditorStore } from '../store/editorStore';
import { EditSceneCommand, duplicateSceneCommand, type SceneEdit } from '../commands/sceneCommands';
import { EditArtboardCommand } from '../commands/artboardCommands';
import { SceneViewport } from './SceneViewport';
import { CompositeCommand, type Command } from '../history/history';

const button = 'rounded border border-neutral-600 px-2 py-1 text-xs hover:bg-neutral-700 disabled:opacity-40';
const input = 'w-full rounded border border-neutral-600 bg-neutral-900 px-2 py-1 text-sm';

export function SceneWorkspace() {
  const engine = useEngine();
  const state = useEditorStore();
  const project = engine.project;
  const artboard = project.artboards.find((a) => a.id === project.editor.activeArtboardId)!;
  const boardRef = useRef(artboard);
  boardRef.current = artboard;
  const [motion] = useState(() => new SceneMotionSession(() => boardRef.current));
  const [motionOpen, setMotionOpen] = useState(false);
  const [, redrawMotion] = useState(0);
  useEffect(() => motion.subscribe(() => redrawMotion((value) => value + 1)), [motion]);
  const [selection, setSelection] = useState<string[]>([]);
  const selected = selection.filter((id) => artboard.nodes.some((n) => n.id === id));
  const node = motion.view().nodes.find((n) => n.id === selected[0]);
  const imageInput = useRef<HTMLInputElement>(null);
  const run = (command: Command) => {
    try {
      state.execute(command);
      return true;
    } catch (error) {
      state.setStatus((error as Error).message);
      return false;
    }
  };
  const keyEntries = (entries: { nodeId: string; property: SceneProperty; value: number }[]) => {
    const clip = motion.clip;
    if (!clip || !entries.length) return;
    const time = Math.min(clip.duration, Math.round(motion.time * clip.fps) / clip.fps);
    const commands = entries.map(
      (entry) =>
        new EditSceneMotionCommand(project, artboard.id, {
          kind: 'key',
          clipId: clip.id,
          ...entry,
          trackId: uuid(),
          key: { id: uuid(), time, value: entry.value, curve: { type: 'linear' } },
        }),
    );
    const composite = new CompositeCommand('Key scene properties', commands);
    if (
      run({
        scope: 'project',
        label: composite.label,
        do: () => composite.do(),
        undo: () => composite.undo(),
      })
    ) {
      motion.refresh();
      motion.clearDraft();
    }
  };
  const keyProperty = (property: SceneProperty, value?: number) => {
    const nodes = motion.view().nodes;
    keyEntries(
      selected.map((id) => {
        const node = nodes.find((n) => n.id === id)!;
        return {
          nodeId: id,
          property,
          value: value ?? (property === 'opacity' ? node.opacity : node.transform[property]),
        };
      }),
    );
  };
  const edit = (intent: SceneEdit) => {
    if (
      motion.enabled &&
      motion.clip &&
      (intent.kind === 'transforms' ||
        (intent.kind === 'update' && (intent.patch.transform || intent.patch.opacity !== undefined)))
    ) {
      const pose: SceneMotionPose =
        intent.kind === 'transforms'
          ? { transforms: intent.values, opacity: {} }
          : {
              transforms: intent.patch.transform ? { [intent.nodeId]: intent.patch.transform } : {},
              opacity: intent.patch.opacity !== undefined ? { [intent.nodeId]: intent.patch.opacity } : {},
            };
      if (motion.autoKey) {
        const entries: { nodeId: string; property: SceneProperty; value: number }[] = [];
        const view = new Map(motion.view().nodes.map((node) => [node.id, node]));
        for (const [id, transform] of Object.entries(pose.transforms))
          for (const property of Object.keys(transform) as (keyof SceneTransform)[])
            if (transform[property] !== view.get(id)!.transform[property])
              entries.push({ nodeId: id, property, value: transform[property] });
        for (const [id, value] of Object.entries(pose.opacity))
          entries.push({ nodeId: id, property: 'opacity', value });
        keyEntries(entries);
      } else {
        motion.setDraft(pose);
        state.setStatus('Preview changed — press Key property to save it, or enable Auto-key.');
      }
    } else run(new EditSceneCommand(project, artboard.id, intent));
  };
  const select = (id: string, add: boolean) =>
    setSelection(add ? (selected.includes(id) ? selected.filter((n) => n !== id) : [...selected, id]) : [id]);
  const add = (type: 'group' | 'rig') => {
    const base = {
      id: uuid(),
      name: type === 'group' ? 'Group' : 'Character rig',
      parentId: null,
      transform: sceneTransform(),
      opacity: 1,
      visible: true,
    };
    const node: SceneNode =
      type === 'group'
        ? { ...base, type }
        : { ...base, type, skeleton: emptySkeletonData(true), animations: [] };
    edit({ kind: 'add', node });
    setSelection([node.id]);
  };
  const switchArtboard = (id: string) => {
    const target = project.artboards.find((a) => a.id === id)!;
    engine.focusRig(id, target.nodes.find((n) => n.type === 'rig')?.id ?? null);
    state.clearSelection();
    state.setPlaying(false);
    state.setMode('setup');
    state.touch();
    setSelection([]);
  };
  const importImage = async (file: File) => {
    const targetProject = project,
      targetBoard = artboard.id;
    try {
      const loaded = await textureRegistry.loadFile(file);
      if (engine.project !== targetProject)
        throw new Error('Project changed while importing. Please import again.');
      const node: SceneNode = {
        id: uuid(),
        name: file.name,
        type: 'image',
        parentId: null,
        transform: sceneTransform(),
        opacity: 1,
        visible: true,
        textureId: loaded.textureId,
        width: loaded.width,
        height: loaded.height,
      };
      const addNode = new EditSceneCommand(project, targetBoard, { kind: 'add', node });
      run({
        scope: 'project',
        label: 'Import scene image',
        do() {
          project.assetManifest[loaded.textureId] = { name: loaded.name, source: 'embedded' };
          try {
            addNode.do();
          } catch (error) {
            delete project.assetManifest[loaded.textureId];
            throw error;
          }
        },
        undo() {
          addNode.undo();
          delete project.assetManifest[loaded.textureId];
        },
      });
      setSelection([node.id]);
    } catch (error) {
      state.setStatus((error as Error).message);
    }
  };
  const property = (key: keyof SceneTransform, value: number) => {
    if (node && Number.isFinite(value))
      edit({ kind: 'update', nodeId: node.id, patch: { transform: { ...node.transform, [key]: value } } });
  };
  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Scene workspace">
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-700 p-2">
        <button
          className={button}
          aria-pressed={motionOpen}
          onClick={() => {
            setMotionOpen(!motionOpen);
            if (motionOpen) motion.setEnabled(false);
          }}
        >
          Animation
        </button>
        <label className="text-xs">
          Artboard{' '}
          <select
            aria-label="Active artboard"
            className={input}
            value={artboard.id}
            onChange={(e) => switchArtboard(e.target.value)}
          >
            {project.artboards.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className={button}
          onClick={() => {
            const id = uuid();
            run(
              new EditArtboardCommand(project, {
                kind: 'add',
                artboard: {
                  id,
                  name: `Artboard ${project.artboards.length + 1}`,
                  width: 1920,
                  height: 1080,
                  nodes: [],
                },
              }),
            );
            switchArtboard(id);
          }}
        >
          Add artboard
        </button>
        <button
          className={button}
          disabled={project.artboards.length < 2}
          onClick={() => run(new EditArtboardCommand(project, { kind: 'remove', id: artboard.id }))}
        >
          Delete artboard
        </button>
        <button className={button} onClick={() => add('group')}>
          Add group
        </button>
        <button className={button} onClick={() => add('rig')}>
          Add rig
        </button>
        <button className={button} onClick={() => imageInput.current?.click()}>
          Import image
        </button>
        <input
          ref={imageInput}
          hidden
          type="file"
          accept="image/*"
          aria-label="Import scene image"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void importImage(file);
          }}
        />
        <button className={button} disabled={!state.canUndo} onClick={state.undo}>
          Undo
        </button>
        <button className={button} disabled={!state.canRedo} onClick={state.redo}>
          Redo
        </button>
      </div>
      <div className="flex min-h-0 flex-1">
        <aside
          className="flex w-56 shrink-0 flex-col overflow-hidden border-r border-neutral-700 p-2"
          aria-label="Scene hierarchy"
        >
          <h2 className="mb-2 text-sm font-semibold">Scene</h2>
          <SceneTree
            key={artboard.id}
            artboard={artboard}
            revision={state.dataRevision}
            selected={selected}
            onSelect={select}
          />
          {!artboard.nodes.length && (
            <p className="text-sm text-neutral-400">Import an image or add a rig to begin.</p>
          )}
          <div className="mt-3 flex flex-wrap gap-1">
            <button
              className={button}
              disabled={!selected.length}
              onClick={() => edit({ kind: 'group', nodeIds: selected, groupId: uuid(), name: 'Group' })}
            >
              Group
            </button>
            <button
              className={button}
              disabled={!selected.length}
              onClick={() => run(duplicateSceneCommand(project, artboard.id, selected))}
            >
              Duplicate
            </button>
            <button
              className={button}
              disabled={!selected.length}
              onClick={() => edit({ kind: 'remove', nodeIds: selected })}
            >
              Delete nodes
            </button>
          </div>
        </aside>
        <SceneViewport
          motion={motion}
          artboard={artboard}
          revision={state.dataRevision}
          selected={selected}
          onSelect={select}
          onCommit={(values) => edit({ kind: 'transforms', values })}
          onClear={() => setSelection([])}
        />
        <aside
          className="w-60 shrink-0 overflow-auto border-l border-neutral-700 p-3"
          aria-label="Scene properties"
        >
          <h2 className="mb-2 text-sm font-semibold">{node ? 'Node properties' : 'Artboard properties'}</h2>
          <label className="mb-2 block text-xs">
            Name
            <input
              aria-label="Scene name"
              key={`${node?.id ?? artboard.id}-${node?.name ?? artboard.name}`}
              className={input}
              defaultValue={node?.name ?? artboard.name}
              onBlur={(e) => {
                if (!e.target.value.trim() || e.target.value === (node?.name ?? artboard.name)) return;
                if (node) edit({ kind: 'update', nodeId: node.id, patch: { name: e.target.value } });
                else
                  run(
                    new EditArtboardCommand(project, {
                      kind: 'update',
                      id: artboard.id,
                      patch: { name: e.target.value },
                    }),
                  );
              }}
            />
          </label>
          {!node &&
            (['width', 'height'] as const).map((key) => (
              <label className="mb-2 block text-xs" key={key}>
                {key}
                <input
                  aria-label={`Artboard ${key}`}
                  className={input}
                  type="number"
                  min="1"
                  key={`${artboard.id}-${key}-${artboard[key]}`}
                  defaultValue={artboard[key]}
                  onBlur={(e) => {
                    if (e.target.valueAsNumber > 0 && e.target.valueAsNumber !== artboard[key])
                      run(
                        new EditArtboardCommand(project, {
                          kind: 'update',
                          id: artboard.id,
                          patch: { [key]: e.target.valueAsNumber },
                        }),
                      );
                  }}
                />
              </label>
            ))}
          {node && (
            <>
              {node.type === 'rig' && (
                <button
                  className={`${button} mb-3 w-full`}
                  onClick={() => {
                    engine.focusRig(artboard.id, node.id);
                    state.setMode('setup');
                    state.setPlaying(false);
                    state.setWorkspace('rig');
                    state.touch();
                  }}
                >
                  Edit character rig
                </button>
              )}
              <label className="mb-2 block text-xs">
                Parent
                <select
                  aria-label="Node parent"
                  className={input}
                  value={node.parentId ?? ''}
                  onChange={(e) =>
                    edit({
                      kind: 'reparent',
                      nodeId: node.id,
                      parentId: e.target.value || null,
                      preserveWorld: true,
                    })
                  }
                >
                  <option value="">Artboard</option>
                  {artboard.nodes
                    .filter((n) => n.type === 'group' && n.id !== node.id)
                    .map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="mb-2 block text-xs">
                <input
                  type="checkbox"
                  checked={node.visible}
                  onChange={(e) =>
                    edit({ kind: 'update', nodeId: node.id, patch: { visible: e.target.checked } })
                  }
                />{' '}
                Visible
              </label>
              <label className="mb-2 block text-xs">
                Opacity
                <input
                  aria-label="Node opacity"
                  className={input}
                  type="number"
                  min="0"
                  max="1"
                  step="0.1"
                  key={`${node.id}-opacity-${node.opacity}`}
                  defaultValue={node.opacity}
                  onBlur={(e) => {
                    if (Number.isFinite(e.target.valueAsNumber) && e.target.valueAsNumber !== node.opacity)
                      edit({ kind: 'update', nodeId: node.id, patch: { opacity: e.target.valueAsNumber } });
                  }}
                />
              </label>
              <label className="mb-2 block text-xs">
                Tint
                <input
                  aria-label="Node tint"
                  type="color"
                  className="ml-2"
                  key={`${node.id}-${node.tint}`}
                  defaultValue={`#${(node.tint ?? 0xffffff).toString(16).padStart(6, '0')}`}
                  onBlur={(e) =>
                    edit({
                      kind: 'update',
                      nodeId: node.id,
                      patch: { tint: parseInt(e.target.value.slice(1), 16) },
                    })
                  }
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(node.transform) as (keyof SceneTransform)[]).map((key) => (
                  <label key={key} className="text-xs">
                    {key}
                    <input
                      aria-label={`Node ${key}`}
                      className={input}
                      type="number"
                      step="0.1"
                      key={`${node.id}-${key}-${node.transform[key]}`}
                      defaultValue={node.transform[key]}
                      onBlur={(e) => {
                        if (e.target.valueAsNumber !== node.transform[key])
                          property(key, e.target.valueAsNumber);
                      }}
                    />
                  </label>
                ))}
              </div>
              <p className="my-2 text-xs text-neutral-400">
                Angles use radians. Parent changes preserve the world pose.
              </p>
              <button
                className={button}
                onClick={() => edit({ kind: 'reorder', nodeId: node.id, beforeId: null })}
              >
                Bring to front
              </button>
              <button className={`${button} mt-2`} onClick={() => setSelection([])}>
                Artboard properties
              </button>
            </>
          )}
        </aside>
      </div>
      {motionOpen && (
        <SceneTimeline
          project={project}
          artboard={artboard}
          revision={state.dataRevision}
          session={motion}
          selectedNodes={selected}
          run={run}
          onKey={keyProperty}
        />
      )}
    </section>
  );
}
