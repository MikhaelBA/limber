import { useState, useEffect } from 'react';
import type { LogicParameter, LogicValue } from '@limber/core';
export function parseLogicValue(type: LogicParameter['type'], value: string): LogicValue {
  if (type === 'string') return value;
  if (type === 'bool' || type === 'trigger') {
    if (value !== 'true' && value !== 'false') throw new Error('Choose true or false.');
    return value === 'true';
  }
  if (!value.trim()) throw new Error('Enter a number.');
  return Number(value);
}
export function LogicValueInput({
  type,
  value,
  label,
  onChange,
}: {
  type: LogicParameter['type'];
  value: LogicValue;
  label: string;
  onChange: (value: LogicValue) => void | boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value, type]);
  return type === 'bool' || type === 'trigger' ? (
    <select
      aria-label={label}
      value={String(value)}
      onChange={(event) => onChange(event.target.value === 'true')}
      className="w-full rounded border border-neutral-600 bg-neutral-900 px-2 py-1"
    >
      <option value="false">false</option>
      <option value="true">true</option>
    </select>
  ) : (
    <input
      aria-label={label}
      type={type === 'string' ? 'text' : 'number'}
      step={type === 'int' ? 1 : 'any'}
      value={draft}
      className="w-full rounded border border-neutral-600 bg-neutral-900 px-2 py-1"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        try {
          if (onChange(parseLogicValue(type, draft)) === false) setDraft(String(value));
        } catch {
          setDraft(String(value));
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
    />
  );
}
