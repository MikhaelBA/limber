import { useRef, useState } from 'react';
import { validateEventName, validateEventPayload, type TypedEventPayload } from '@limber/core';
const templates: { name: string; payload: TypedEventPayload }[] = [
  { name: 'Footstep', payload: { type: 'string', value: 'stone' } },
  { name: 'AttackHit', payload: { type: 'int', value: 10 } },
  { name: 'SpawnProjectile', payload: { type: 'string', value: 'arrow' } },
  { name: 'SFX', payload: { type: 'string', value: 'confirm' } },
  { name: 'Haptic', payload: { type: 'float', value: 0.5 } },
  { name: 'UIConfirm', payload: { type: 'bool', value: true } },
];
const field = 'rounded border border-neutral-600 bg-neutral-900 px-1 py-0.5 text-xs disabled:opacity-40';
/** Shared scene/rig event authoring, with explicit types and no expression/coercion paths. */
export function EventComposer({
  prefix,
  disabled,
  onKey,
}: {
  prefix: 'Scene' | 'Character';
  disabled: boolean;
  onKey: (name: string, payload: TypedEventPayload | undefined) => void;
}) {
  const [name, setName] = useState(prefix === 'Scene' ? 'event' : 'footstep');
  const [type, setType] = useState<TypedEventPayload['type'] | 'none'>('none');
  const [value, setValue] = useState('');
  const [template, setTemplate] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  let payload: TypedEventPayload | undefined,
    error = '';
  try {
    validateEventName(name);
    if (type === 'bool') payload = { type, value: value === 'true' };
    else if (type === 'string') payload = { type, value };
    else if (type === 'int' || type === 'float')
      payload = { type, value: value.trim() ? Number(value) : NaN };
    validateEventPayload(payload);
  } catch (e) {
    error = (e as Error).message;
  }
  return (
    <div
      className="flex flex-wrap items-center gap-1"
      onKeyDown={(e) => {
        if (
          dialog.current?.open ||
          ['INPUT', 'SELECT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)
        )
          e.stopPropagation();
      }}
    >
      <input
        aria-label={`${prefix} event name`}
        title="Event name"
        className={`${field} w-24`}
        disabled={disabled}
        value={name}
        maxLength={128}
        onChange={(e) => {
          setName(e.target.value);
          setTemplate('');
        }}
      />
      <button
        className={`${field} hover:bg-neutral-700`}
        disabled={disabled}
        aria-haspopup="dialog"
        onClick={() => dialog.current?.showModal()}
      >
        {prefix} event payload{type === 'none' ? '' : `: ${type}`}
      </button>
      <dialog
        ref={dialog}
        aria-label={`${prefix} event payload editor`}
        className="fixed m-auto w-80 rounded border border-neutral-600 bg-neutral-950 p-4 text-neutral-100 shadow-xl backdrop:bg-black/50"
      >
        <div className="space-y-3 text-sm">
          <h2 className="font-semibold">{prefix} event payload</h2>
          <label className="block">
            Template
            <select
              aria-label={`${prefix} event template`}
              className={`${field} ml-2`}
              disabled={disabled}
              value={template}
              onChange={(e) => {
                const selection = templates.find((t) => t.name === e.target.value);
                setTemplate(e.target.value);
                if (selection) {
                  setName(selection.name);
                  setType(selection.payload.type);
                  setValue(String(selection.payload.value));
                }
              }}
            >
              <option value="">Custom</option>
              {templates.map((t) => (
                <option key={t.name}>{t.name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            Type
            <select
              aria-label={`${prefix} event payload type`}
              className={`${field} ml-2`}
              disabled={disabled}
              value={type}
              onChange={(e) => {
                const next = e.target.value as typeof type;
                setType(next);
                setTemplate('');
                setValue(next === 'bool' ? 'false' : next === 'string' || next === 'none' ? '' : '0');
              }}
            >
              {['none', 'bool', 'float', 'int', 'string'].map((kind) => (
                <option key={kind}>{kind}</option>
              ))}
            </select>
          </label>
          {type === 'bool' ? (
            <label className="block">
              Value
              <select
                aria-label={`${prefix} event payload value`}
                className={`${field} ml-2`}
                disabled={disabled}
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  setTemplate('');
                }}
              >
                <option>false</option>
                <option>true</option>
              </select>
            </label>
          ) : (
            type !== 'none' && (
              <label className="block">
                Value
                <input
                  aria-label={`${prefix} event payload value`}
                  className={`${field} mt-1 w-full`}
                  disabled={disabled}
                  type={type === 'string' ? 'text' : 'number'}
                  step={type === 'int' ? '1' : 'any'}
                  value={value}
                  onChange={(e) => {
                    setValue(e.target.value);
                    setTemplate('');
                  }}
                />
              </label>
            )
          )}
          <p className="text-neutral-400">
            Templates are starting values. Customize the name and payload for your game.
          </p>
          {error && (
            <output aria-label={`${prefix} event error`} role="status" className="block text-amber-300">
              {error}
            </output>
          )}
          <button className={`${field} hover:bg-neutral-700`} onClick={() => dialog.current?.close()}>
            Done
          </button>
        </div>
      </dialog>
      <button
        className={`${field} hover:bg-neutral-700`}
        disabled={disabled || !!error}
        title={prefix === 'Character' ? 'Key this event at the playhead (fires during playback)' : undefined}
        onClick={() => onKey(name.trim(), payload)}
      >
        {prefix === 'Scene' ? 'Key event' : '⚡ Event'}
      </button>
    </div>
  );
}
