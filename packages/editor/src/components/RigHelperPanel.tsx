import { useState } from 'react';
import { AddHumanGuideCommand, MirrorBonesCommand } from '../commands/rigHelperCommands';
import { useEngine } from '../hooks/useEngine';
import { useEditorStore } from '../store/editorStore';

export function RigHelperPanel() {
  const engine = useEngine();
  const mode = useEditorStore((s) => s.mode);
  const selected = useEditorStore((s) => s.selectedBoneId);
  const execute = useEditorStore((s) => s.execute);
  const select = useEditorStore((s) => s.select);
  const setStatus = useEditorStore((s) => s.setStatus);
  const [name, setName] = useState('Human');
  const [height, setHeight] = useState('400');
  const [x, setX] = useState('0'),
    [y, setY] = useState('0');
  const [axis, setAxis] = useState('0');
  const field = 'min-w-0 w-full rounded bg-neutral-800 px-1 py-0.5';
  const run = (command: AddHumanGuideCommand | MirrorBonesCommand, message: string) => {
    try {
      execute(command);
      select(command.rootBoneId);
      setStatus(message);
    } catch (error) {
      setStatus((error as Error).message);
    }
  };
  const number = (value: string) => (value.trim() ? Number(value) : NaN);
  return (
    <details className="mt-2 border-t border-neutral-700 p-2 text-xs text-neutral-400">
      <summary className="cursor-pointer font-semibold">Rig helpers</summary>
      <fieldset disabled={mode !== 'setup'} className="mt-2 space-y-2 disabled:opacity-50">
        <p>Add a human guide with 15 bones and hand/foot sockets. Adjust its joints with the bone tools.</p>
        <label className="flex gap-2">
          Name
          <input
            aria-label="Human guide name"
            className={field}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="flex gap-2">
          Height
          <input
            aria-label="Human guide height"
            type="number"
            min="1"
            max="10000"
            className={field}
            value={height}
            onChange={(event) => setHeight(event.target.value)}
          />
        </label>
        <div className="flex gap-2">
          <label className="flex min-w-0 gap-1">
            X
            <input
              aria-label="Human guide X"
              type="number"
              className={field}
              value={x}
              onChange={(event) => setX(event.target.value)}
            />
          </label>
          <label className="flex min-w-0 gap-1">
            Y
            <input
              aria-label="Human guide Y"
              type="number"
              className={field}
              value={y}
              onChange={(event) => setY(event.target.value)}
            />
          </label>
        </div>
        <button
          className="rounded bg-neutral-700 px-2 py-1"
          onClick={() =>
            run(
              new AddHumanGuideCommand(engine, { name, height: number(height), x: number(x), y: number(y) }),
              'Human guide added. Move its joints in Setup; one Undo removes the guide.',
            )
          }
        >
          Add human guide
        </button>
        <div className="border-t border-neutral-700 pt-2">
          <p className="mb-2">
            Mirror the selected bone and its children with their markers. Artwork, weights, constraints and
            animation tracks stay on the original bones.
          </p>
          <label className="flex gap-2">
            Axis X
            <input
              aria-label="Mirror axis X"
              type="number"
              step="any"
              className={field}
              value={axis}
              onChange={(event) => setAxis(event.target.value)}
            />
          </label>
          <button
            disabled={!selected}
            className="mt-2 rounded bg-neutral-700 px-2 py-1 disabled:opacity-40"
            onClick={() => {
              if (selected)
                run(
                  new MirrorBonesCommand(engine, selected, number(axis)),
                  'Mirrored setup bones and markers added; one Undo removes the copies.',
                );
            }}
          >
            Mirror bones
          </button>
        </div>
      </fieldset>
    </details>
  );
}
