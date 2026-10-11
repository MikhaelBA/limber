import { useEffect, useRef, useState } from 'react';
import { normalizeInfluences, mergeLockedInfluences, encodeWeights } from '@limber/mesh';
import { BindMeshCommand } from '../commands/bindMeshCommand';
import {
  DirectWeightsCommand,
  WeightMetadataCommand,
  UpdateBindingsCommand,
  weightContext,
  weightRowsCommand,
  prunePreview,
  swapWeights,
  pasteWeights,
  weldWeights,
  WeightEdgesCommand,
} from '../commands/weightEditingCommands';
import { AutoWeightsControls } from './AutoWeightsControls';
import { SmoothWeightsControls } from './SmoothWeightsControls';
import { useEngine } from '../hooks/useEngine';
import { useEditorStore } from '../store/editorStore';
import { useWeightEditingStore, weightColor } from '../store/weightEditingStore';
import { CompositeCommand, type Command } from '../history/history';
import { weightAttachment } from '@limber/core';

export function MeshWeightsPanel({ attachmentId }: { attachmentId: string }) {
  const engine = useEngine(),
    ui = useWeightEditingStore();
  const mode = useEditorStore((s) => s.mode),
    slotId = useEditorStore((s) => s.selectedSlotId);
  const epoch = useEditorStore((s) => s.documentEpoch),
    primary = useEditorStore((s) => s.weightBoneId);
  useEditorStore((s) => s.dataRevision);
  const execute = useEditorStore((s) => s.execute),
    status = useEditorStore((s) => s.setStatus);
  const [limit, setLimit] = useState('4'),
    [threshold, setThreshold] = useState('0.01');
  const [exact, setExact] = useState('50'),
    [source, setSource] = useState(''),
    [overlapping, setOverlapping] = useState(true);
  const [pruneMeshes, setPruneMeshes] = useState<string[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const slider = useRef<DirectWeightsCommand | null>(null);
  const mesh = weightAttachment(engine.skeleton.data, attachmentId);
  const [bindBones, setBindBones] = useState(
    () => mesh?.boneBindings?.map((b) => b.boneId) ?? engine.skeleton.data.bones.map((b) => b.id),
  );
  const vertexCount = (mesh?.meshVertices?.length ?? 0) / 2;
  useEffect(() => {
    ui.setScope(`${epoch}:${engine.project.editor?.activeRigId}:${attachmentId}:${vertexCount}`);
    if (!engine.skeleton.data.paths?.some((p) => p.id === attachmentId)) ui.patch({ pathId: null });
  }, [epoch, engine, attachmentId, vertexCount, ui.setScope, ui.patch]);
  const bones = ui.bones.includes(primary ?? '') ? ui.bones : primary ? [primary] : [];
  const button = 'rounded bg-neutral-700 px-2 py-1 disabled:opacity-40';
  const run = (action: () => Command, message = 'Weights updated.') => {
    try {
      execute(action());
      status(message);
    } catch (error) {
      status((error as Error).message);
    }
  };
  const bind = () => {
    run(() => {
      if (!slotId && !ui.pathId) throw new Error('Select weighted geometry before binding.');
      return new BindMeshCommand(
        engine,
        attachmentId,
        slotId ?? ui.pathId!,
        ui.binding && ui.bones.length ? ui.bones : bindBones,
        true,
      );
    }, 'Bones bound. First binding computes topology-aware weights.');
    ui.patch({ binding: false });
  };
  const chooseBone = (id: string, additive: boolean) => {
    const next = additive ? (bones.includes(id) ? bones.filter((b) => b !== id) : [...bones, id]) : [id];
    ui.setBones(next);
    useEditorStore.getState().setWeightBone(next.at(-1) ?? null);
  };
  let rows: ReturnType<typeof weightContext>['rows'] = [];
  try {
    rows = weightContext(engine, attachmentId).rows;
  } catch {
    /* Attachment may have just switched. */
  }
  const vertices = ui.vertices.filter((v) => v < rows.length);
  const selectedRows = (vertices.length ? vertices : rows.map((_, i) => i)).map((v) => rows[v]!);
  const values = (id: string) =>
    selectedRows.map(
      (row) => row.find((item) => item.boneIndex === engine.skeleton.boneIndexMap.get(id))?.weight ?? 0,
    );
  const weightText = (id: string) => {
    const weights = values(id),
      first = weights[0] ?? 0;
    return weights.some((w) => Math.abs(w - first) > 1e-6) ? '*' : `${(first * 100).toFixed(1)}%`;
  };
  const selectionKey = vertices.join(','),
    bonesKey = bones.join(',');
  const currentPercent =
    selectedRows[0]?.reduce(
      (sum, item) =>
        sum +
        (bones.some((id) => engine.skeleton.boneIndexMap.get(id) === item.boneIndex) ? item.weight * 100 : 0),
      0,
    ) ?? 0;
  useEffect(() => {
    if (!slider.current && selectionKey) setExact(currentPercent.toFixed(3));
  }, [currentPercent, selectionKey, bonesKey, attachmentId]);
  const options = { maxInfluences: Number(limit), threshold: Number(threshold) };
  const ids = pruneMeshes.length ? pruneMeshes : [attachmentId];
  let preview = '';
  let previewWeights: Record<string, number[]> | null = null;
  try {
    const previews = ids.map((id) => prunePreview(engine, id, id === attachmentId ? vertices : [], options));
    if (previewOpen)
      previewWeights = Object.fromEntries(previews.map((p, i) => [ids[i]!, encodeWeights(p.rows)]));
    preview = `${previews.reduce((sum, p) => sum + p.removed, 0)} influences on ${previews.reduce((sum, p) => sum + p.affected, 0)} vertices would be removed.`;
  } catch (error) {
    preview = (error as Error).message;
  }
  const previewJSON = JSON.stringify(previewWeights);
  useEffect(() => {
    if (JSON.stringify(useWeightEditingStore.getState().preview) !== previewJSON)
      ui.patch({ preview: JSON.parse(previewJSON) as Record<string, number[]> | null });
  }, [previewJSON, ui.patch]);
  useEffect(() => () => useWeightEditingStore.getState().patch({ preview: null }), []);
  const reorder = (from: string, to: string) => {
    const order = mesh?.boneBindings?.map((b) => b.boneId) ?? [],
      index = order.indexOf(to);
    if (!order.includes(from) || index < 0) return;
    order.splice(order.indexOf(from), 1);
    order.splice(index, 0, from);
    run(
      () => new WeightMetadataCommand(engine, attachmentId, 'order', order),
      'Bound bone order and triangle overlap updated.',
    );
  };
  const copy = () => {
    if (!vertices.length) {
      status('Select vertices to copy weights.');
      return;
    }
    ui.patch({
      clipboard: {
        rows: vertices.map((v) =>
          rows[v]!.map((item) => ({
            boneId: engine.skeleton.data.bones[item.boneIndex]!.id,
            weight: item.weight,
          })),
        ),
      },
    });
    status(`Copied weights of ${vertices.length} vertices.`);
  };
  return (
    <fieldset className="space-y-2 rounded border border-neutral-700 p-2 text-xs">
      <legend>Weights</legend>
      <p>
        {vertices.length ? `${vertices.length} vertices selected` : 'All vertices'} · Ctrl/Cmd adds selection
        · Escape clears
      </p>
      <div className="flex flex-wrap gap-1">
        <button className={button} onClick={() => ui.setVertices(rows.map((_, i) => i))}>
          Select all vertices
        </button>
        <button className={button} onClick={() => ui.setVertices([])}>
          Clear vertices
        </button>
        <button className={button} onClick={copy}>
          Copy weights
        </button>
        <button
          className={button}
          disabled={!ui.clipboard}
          onClick={() => run(() => pasteWeights(engine, attachmentId, vertices, ui.clipboard!.rows))}
        >
          Paste weights
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {(['pies', 'overlay', 'selectedOnly'] as const).map((key) => (
          <label key={key}>
            <input
              type="checkbox"
              aria-label={`Weight ${key}`}
              checked={ui[key]}
              onChange={(e) => ui.patch({ [key]: e.target.checked })}
            />{' '}
            {key === 'selectedOnly' ? 'Selected' : key === 'pies' ? 'Pies' : 'Overlay'}
          </label>
        ))}
      </div>
      <div role="list" aria-label="Bound weight bones" className="space-y-1">
        {mesh?.boneBindings?.map((binding, index) => {
          const bone = engine.skeleton.data.bones.find((b) => b.id === binding.boneId)!;
          const locked = mesh.weightLocks?.includes(bone.id) ?? false;
          const influences = vertices.length && values(bone.id).some((w) => w > 0);
          return (
            <div
              role="listitem"
              key={bone.id}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                reorder(e.dataTransfer.getData('text/weight-bone'), bone.id);
              }}
              className={`flex items-center gap-1 rounded p-1 ${bones.includes(bone.id) ? 'bg-sky-900/70' : influences ? 'bg-neutral-700' : 'bg-neutral-800'}`}
            >
              <span
                draggable
                onDragStart={(e) => e.dataTransfer.setData('text/weight-bone', bone.id)}
                aria-label={`Reorder ${bone.name}`}
                title="Drag to change triangle overlap order"
                className="cursor-grab"
              >
                ⋮⋮
              </span>
              <span style={{ color: `#${weightColor(index).toString(16).padStart(6, '0')}` }}>●</span>
              <button
                aria-label={`Weight bone ${bone.name}`}
                aria-pressed={bones.includes(bone.id)}
                className="min-w-0 flex-1 text-left"
                onClick={(e) => chooseBone(bone.id, e.ctrlKey || e.metaKey || e.shiftKey)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  useEditorStore.getState().setTool('translate');
                  useEditorStore.getState().select(bone.id);
                }}
              >
                {bone.name}
              </button>
              <span aria-label={`${bone.name} vertex weight`}>{weightText(bone.id)}</span>
              <input
                type="checkbox"
                aria-label={`Lock ${bone.name} weights`}
                checked={locked}
                onChange={() =>
                  run(
                    () =>
                      new WeightMetadataCommand(
                        engine,
                        attachmentId,
                        'lock',
                        locked
                          ? (mesh.weightLocks ?? []).filter((id) => id !== bone.id)
                          : [...(mesh.weightLocks ?? []), bone.id],
                      ),
                  )
                }
              />
            </div>
          );
        })}
      </div>
      <label className="flex gap-2 items-center">
        Weight %
        <input
          aria-label="Direct weight percent"
          type="number"
          min="0"
          max="100"
          step="0.1"
          value={exact}
          onChange={(e) => setExact(e.target.value)}
          className="w-16 rounded bg-neutral-800 px-1"
        />
      </label>
      <input
        aria-label="Direct weight slider"
        type="range"
        min="0"
        max="100"
        step="0.1"
        value={exact}
        disabled={!vertices.length || !bones.length}
        onPointerDown={() => {
          const cmd = new DirectWeightsCommand(engine, attachmentId, vertices, bones);
          cmd.open();
          slider.current = cmd;
        }}
        onChange={(e) => {
          setExact(e.target.value);
          try {
            if (!slider.current) {
              const cmd = new DirectWeightsCommand(engine, attachmentId, vertices, bones);
              cmd.open();
              slider.current = cmd;
            }
            slider.current.update(Number(e.target.value) / 100);
            useEditorStore.getState().touch();
          } catch (error) {
            status((error as Error).message);
          }
        }}
        onPointerUp={() => {
          if (slider.current) {
            slider.current.commit();
            if (slider.current.changed) execute(slider.current);
            slider.current = null;
          }
        }}
        onBlur={() => {
          if (slider.current) {
            slider.current.commit();
            if (slider.current.changed) execute(slider.current);
            slider.current = null;
          }
        }}
        className="w-full"
      />
      <button
        className={button}
        disabled={!vertices.length || !bones.length}
        onClick={() =>
          run(() => {
            const cmd = new DirectWeightsCommand(engine, attachmentId, vertices, bones);
            cmd.open();
            cmd.update(Number(exact) / 100);
            cmd.commit();
            return cmd;
          })
        }
      >
        Set selected weights
      </button>
      <div className="flex flex-wrap gap-1">
        <button
          className={button}
          disabled={bones.length !== 2}
          onClick={() => run(() => swapWeights(engine, attachmentId, vertices, bones))}
        >
          Swap weights
        </button>
        <button
          className={button}
          disabled={!bones.length}
          onClick={() => run(() => new WeightMetadataCommand(engine, attachmentId, 'remove', bones))}
        >
          Remove bound bones
        </button>
        <button
          className={button}
          disabled={mode !== 'setup' || !mesh?.boneBindings}
          onClick={() => run(() => new UpdateBindingsCommand(engine, attachmentId))}
        >
          Update bindings
        </button>
      </div>
      <details open>
        <summary>Bind bones</summary>
        <label className="block">
          Bind bones
          <select
            multiple
            aria-label="Mesh binding bones"
            size={Math.min(5, engine.skeleton.data.bones.length)}
            className="mt-1 block w-full rounded bg-neutral-800 px-1"
            value={bindBones}
            onChange={(e) => setBindBones(Array.from(e.target.selectedOptions, (option) => option.value))}
          >
            {engine.skeleton.data.bones.map((bone) => (
              <option key={bone.id} value={bone.id}>
                {bone.name}
              </option>
            ))}
          </select>
        </label>
      </details>
      <button disabled={mode !== 'setup'} className={button} onClick={bind}>
        Bind setup pose
      </button>
      <button
        disabled={mode !== 'setup'}
        className={`${button} ml-1`}
        onClick={() => {
          if (ui.binding) bind();
          else {
            ui.setBones(mesh?.boneBindings?.map((b) => b.boneId) ?? []);
            ui.patch({ binding: true });
          }
        }}
      >
        {ui.binding ? 'Finish Bind' : 'Bind'}
      </button>
      {ui.binding && <p>Click viewport bones to add them, then Finish Bind, Space or Escape.</p>}
      <label className="flex items-center gap-2">
        Max influences
        <input
          aria-label="Maximum mesh influences"
          type="number"
          min="1"
          step="1"
          className="w-14 rounded bg-neutral-800 px-1"
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
        />
      </label>
      <fieldset disabled={mode !== 'setup'}>
        <AutoWeightsControls
          attachmentId={attachmentId}
          slotId={slotId ?? ui.pathId}
          maxInfluences={Number(limit)}
        />
      </fieldset>
      <details onToggle={(e) => setPreviewOpen(e.currentTarget.open)}>
        <summary>Prune preview</summary>
        <label className="block">
          Bones
          <input
            aria-label="Prune maximum bones slider"
            type="range"
            min="1"
            max={Math.max(1, mesh?.boneBindings?.length ?? engine.skeleton.data.bones.length)}
            step="1"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
          />
        </label>
        <input
          aria-label="Prune threshold slider"
          type="range"
          min="0"
          max="1"
          step="0.005"
          value={threshold}
          onChange={(e) => setThreshold(e.target.value)}
          className="w-full"
        />
        <label>
          Threshold
          <input
            aria-label="Prune weight threshold"
            type="number"
            min="0"
            max="1"
            step="0.01"
            className="w-16 rounded bg-neutral-800 px-1"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
          />
        </label>
        <select
          multiple
          aria-label="Prune meshes"
          className="block w-full bg-neutral-800"
          value={pruneMeshes}
          onChange={(e) => setPruneMeshes(Array.from(e.target.selectedOptions, (o) => o.value))}
        >
          {engine.skeleton.data.attachments
            .filter((a) => a.meshVertices && a.weights && a.boneBindings)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </select>
        <output aria-label="Prune preview">{preview}</output>
      </details>
      <div className="flex gap-1">
        <button
          disabled={mode !== 'setup' || !mesh?.weights}
          className={button}
          onClick={() =>
            run(() => {
              const c = weightContext(engine, attachmentId);
              return weightRowsCommand(
                engine,
                attachmentId,
                c.rows.map((row, v) =>
                  vertices.length && !vertices.includes(v)
                    ? row
                    : mergeLockedInfluences(row, normalizeInfluences(row), c.locked, c.fallback),
                ),
                'Normalize weights',
              );
            })
          }
        >
          Normalize weights
        </button>
        <button
          disabled={!mesh?.weights}
          className={button}
          onClick={() =>
            run(() => {
              const ready = ids.map((id) =>
                prunePreview(engine, id, id === attachmentId ? vertices : [], options),
              );
              return new CompositeCommand(
                'Prune weights',
                ready.map((p, i) => weightRowsCommand(engine, ids[i]!, p.rows, 'Prune weights')),
              );
            }, preview)
          }
        >
          Prune weights
        </button>
      </div>
      <fieldset disabled={mode !== 'setup'}>
        <SmoothWeightsControls
          attachmentId={attachmentId}
          slotId={slotId ?? ui.pathId}
          maxInfluences={Number(limit)}
        />
      </fieldset>
      <button
        disabled={vertices.length !== 2 || !!ui.pathId}
        className={button}
        onClick={() => run(() => new WeightEdgesCommand(engine, attachmentId, vertices))}
      >
        Toggle smoothing edge
      </button>
      <details>
        <summary>Weld weights</summary>
        <select
          aria-label="Weld source mesh"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          className="w-full bg-neutral-800"
        >
          <option value="">Choose source mesh</option>
          {engine.skeleton.data.attachments
            .filter((a) => a.id !== attachmentId && a.meshVertices && a.boneBindings)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </select>
        <label>
          <input
            type="checkbox"
            aria-label="Weld overlapping vertices"
            checked={overlapping}
            onChange={(e) => setOverlapping(e.target.checked)}
          />{' '}
          Overlapping only (otherwise All)
        </label>
        <button
          className={button}
          disabled={!source}
          onClick={() => run(() => weldWeights(engine, attachmentId, source, overlapping))}
        >
          Weld weights
        </button>
      </details>
    </fieldset>
  );
}
