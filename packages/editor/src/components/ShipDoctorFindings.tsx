import { useState } from 'react';
import type { RuntimeDiagnostic, inspectRuntimeCompatibility } from '@limber/runtime';

export function ShipDoctorFindings({
  diagnostics,
  canFocus,
  onFocus,
  compatibility,
  atlasObjects,
  onAtlas,
}: {
  diagnostics: RuntimeDiagnostic[];
  canFocus: boolean;
  onFocus: (finding: RuntimeDiagnostic) => void;
  compatibility: ReturnType<typeof inspectRuntimeCompatibility> | null;
  atlasObjects: ReadonlySet<string>;
  onAtlas: (objectId: string) => void;
}) {
  const [query, setQuery] = useState(''),
    [severity, setSeverity] = useState('all');
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const filtered = diagnostics.filter(
    (finding) =>
      (severity === 'all' || finding.severity === severity) &&
      terms.every((term) =>
        [finding.code, finding.objectId, finding.explanation, finding.remedy]
          .join(' ')
          .toLocaleLowerCase()
          .includes(term),
      ),
  );
  return (
    <>
      <label className="mt-2 block">
        Findings search
        <input
          aria-label="Ship findings search"
          className="w-full rounded border border-neutral-600 bg-neutral-900 p-1"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <select
        aria-label="Ship findings severity"
        className="mt-1 rounded bg-neutral-800"
        value={severity}
        onChange={(event) => setSeverity(event.target.value)}
      >
        <option value="all">All severities</option>
        <option value="error">Errors</option>
        <option value="warning">Warnings</option>
      </select>
      <p className="mt-1">
        Showing {Math.min(200, filtered.length)} of {filtered.length} matching findings ({diagnostics.length}{' '}
        total).
      </p>
      {filtered.slice(0, 200).map((entry, index) => (
        <div
          key={index}
          data-testid="ship-finding"
          className={`mt-2 rounded border p-2 ${entry.severity === 'error' ? 'border-red-700' : 'border-amber-700'}`}
        >
          <strong>{entry.code}</strong> · {entry.severity} · {entry.objectId ?? 'Asset'}
          <p>{entry.explanation}</p>
          <p className="mt-1 text-neutral-300">{entry.remedy}</p>
          {canFocus && entry.objectId && (
            <button
              className="mt-1 rounded border border-neutral-600 px-2 py-1"
              onClick={() => onFocus(entry)}
            >
              Inspect source
            </button>
          )}
          {entry.objectId && atlasObjects.has(entry.objectId) && (
            <button
              className="mt-1 rounded border border-neutral-600 px-2 py-1"
              onClick={() => onAtlas(entry.objectId!)}
            >
              Inspect atlas
            </button>
          )}
        </div>
      ))}
      {!canFocus && (
        <p className="mt-2 text-neutral-400">
          Opened native assets have no verified link to this source document.
        </p>
      )}
      {compatibility && (
        <details className="mt-3" aria-label="Runtime compatibility">
          <summary>Runtime compatibility</summary>
          <p>
            Native v{compatibility.version} requirements: {compatibility.requiredFeatures.join(', ')}
          </p>
          <table className="mt-2 w-full text-left">
            <thead>
              <tr>
                <th>Host</th>
                <th>Status</th>
                <th>Native version</th>
              </tr>
            </thead>
            <tbody>
              {compatibility.hosts.map((host) => (
                <tr key={host.id}>
                  <td>{host.id}</td>
                  <td>{host.status}</td>
                  <td>{host.version ?? 'Pending'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {compatibility.hosts.map((host) => (
            <p key={host.id} className="mt-1">
              {host.id}: {host.note}
            </p>
          ))}
        </details>
      )}
    </>
  );
}
