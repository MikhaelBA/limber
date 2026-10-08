import { useState } from 'react';
import { MARKER_KINDS, isAreaMarker, type MarkerData, type MarkerKind } from '@limber/core';
import { createMarker, EditMarkerCommand } from '../commands/markerCommands';
import { useEngine } from '../hooks/useEngine';
import { useEditorStore } from '../store/editorStore';

const fieldClass = 'w-full min-w-0 rounded bg-neutral-800 px-1 py-0.5 text-neutral-200';
/** Fields commit on blur: one source change and undo entry per edit. */
function Field({
  label,
  value,
  commit,
  numeric = false,
}: {
  label: string;
  value: string | number;
  commit: (value: string) => void;
  numeric?: boolean;
}) {
  return (
    <label className="grid grid-cols-[5rem_1fr] items-center gap-1">
      {label}
      <input
        key={String(value)}
        aria-label={`Marker ${label}`}
        className={fieldClass}
        type={numeric ? 'number' : 'text'}
        step="any"
        defaultValue={value}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
        onBlur={(event) => {
          if (event.target.value !== String(value)) commit(event.target.value);
          event.target.value = String(value);
        }}
      />
    </label>
  );
}

export function MarkerPanel() {
  const engine = useEngine();
  useEditorStore((s) => s.dataRevision);
  const mode = useEditorStore((s) => s.mode);
  const selectedBone = useEditorStore((s) => s.selectedBoneId);
  const execute = useEditorStore((s) => s.execute);
  const setStatus = useEditorStore((s) => s.setStatus);
  const [selected, setSelected] = useState('');
  const [kind, setKind] = useState<MarkerKind>('socket');
  const data = engine.skeleton.data;
  const markers = data.markers ?? [];
  const marker = markers.find((item) => item.id === selected) ?? markers[0];
  const run = (edit: ConstructorParameters<typeof EditMarkerCommand>[1]) => {
    try {
      execute(new EditMarkerCommand(engine, edit));
      return true;
    } catch (error) {
      setStatus((error as Error).message);
      return false;
    }
  };
  const put = (next: MarkerData) => run({ kind: 'put', marker: next });
  const changeKind = (next: MarkerKind) => {
    if (!marker) return;
    const { id, name, boneId, transform } = marker;
    const base = { id, name, boneId, transform, kind: next };
    put(
      (isAreaMarker(next)
        ? { ...base, shape: 'shape' in marker ? marker.shape : { type: 'rectangle', width: 40, height: 40 } }
        : base) as MarkerData,
    );
  };
  return (
    <details className="mt-2 border-t border-neutral-700 p-2 text-xs text-neutral-400">
      <summary className="cursor-pointer font-semibold">Markers & sockets ({markers.length})</summary>
      <p className="my-2">
        Markers follow their bone during playback. Edit in Setup; angles are radians. Areas are preview
        outlines.
      </p>
      <fieldset disabled={mode !== 'setup'} className="space-y-2 disabled:opacity-50">
        <div className="flex gap-1">
          <select
            aria-label="New marker kind"
            className={fieldClass}
            value={kind}
            onChange={(event) => setKind(event.target.value as MarkerKind)}
          >
            {MARKER_KINDS.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
          <button
            className="rounded bg-neutral-700 px-2 disabled:opacity-40"
            disabled={!selectedBone}
            onClick={() => {
              if (!selectedBone) return;
              const next = createMarker(selectedBone, kind);
              if (put(next)) setSelected(next.id);
            }}
          >
            Add marker
          </button>
        </div>
        {!selectedBone && <p>Select a bone to add a marker.</p>}
      </fieldset>
      {marker && (
        <>
          <select
            aria-label="Selected marker"
            className={`${fieldClass} my-2`}
            value={marker.id}
            onChange={(event) => setSelected(event.target.value)}
          >
            {markers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({item.kind})
              </option>
            ))}
          </select>
          <fieldset disabled={mode !== 'setup'} className="space-y-1 disabled:opacity-50">
            <Field label="name" value={marker.name} commit={(name) => put({ ...marker, name })} />
            <label className="flex gap-2">
              Bone
              <select
                aria-label="Marker bone"
                className={fieldClass}
                value={marker.boneId}
                onChange={(event) => put({ ...marker, boneId: event.target.value })}
              >
                {data.bones.map((bone) => (
                  <option key={bone.id} value={bone.id}>
                    {bone.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex gap-2">
              Kind
              <select
                aria-label="Marker kind"
                className={fieldClass}
                value={marker.kind}
                onChange={(event) => changeKind(event.target.value as MarkerKind)}
              >
                {MARKER_KINDS.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            {(['x', 'y', 'rotation', 'scaleX', 'scaleY', 'shearX', 'shearY'] as const).map((key) => (
              <Field
                key={key}
                label={key}
                numeric
                value={marker.transform[key]}
                commit={(value) => {
                  if (!value.trim()) {
                    setStatus('Marker transform needs a number.');
                    return;
                  }
                  put({ ...marker, transform: { ...marker.transform, [key]: Number(value) } });
                }}
              />
            ))}
            {'shape' in marker && (
              <>
                <label className="flex gap-2">
                  Shape
                  <select
                    aria-label="Marker shape"
                    className={fieldClass}
                    value={marker.shape.type}
                    onChange={(event) =>
                      put({
                        ...marker,
                        shape:
                          event.target.value === 'rectangle'
                            ? { type: 'rectangle', width: 40, height: 40 }
                            : { type: 'polygon', vertices: [-20, -20, 20, -20, 20, 20, -20, 20] },
                      })
                    }
                  >
                    <option>rectangle</option>
                    <option>polygon</option>
                  </select>
                </label>
                {marker.shape.type === 'rectangle' ? (
                  (['width', 'height'] as const).map((key) => (
                    <Field
                      key={key}
                      label={key}
                      numeric
                      value={marker.shape.type === 'rectangle' ? marker.shape[key] : 0}
                      commit={(value) => {
                        if (marker.shape.type === 'rectangle')
                          put({ ...marker, shape: { ...marker.shape, [key]: Number(value) } });
                      }}
                    />
                  ))
                ) : (
                  <Field
                    label="vertices"
                    value={marker.shape.vertices.join(', ')}
                    commit={(value) =>
                      put({
                        ...marker,
                        shape: {
                          type: 'polygon',
                          vertices: value
                            .trim()
                            .split(/[\s,]+/)
                            .map(Number),
                        },
                      })
                    }
                  />
                )}
              </>
            )}
            <button
              className="mt-2 rounded bg-neutral-700 px-2 py-1"
              onClick={() => run({ kind: 'remove', markerId: marker.id })}
            >
              Delete marker
            </button>
          </fieldset>
        </>
      )}
    </details>
  );
}
