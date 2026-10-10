import { useEffect, useRef, useState } from 'react';
import {
  FONT_MAX_BYTES,
  fontFamilyKey,
  inspectOpenType,
  uuid,
  type BoneByBoneProject,
  type EmbeddedFont,
} from '@limber/core';

const field = 'w-full rounded border border-neutral-600 bg-neutral-900 p-1 text-xs';
const button = 'rounded border border-neutral-600 px-2 py-1 text-xs hover:bg-neutral-700 disabled:opacity-40';
export function FontLibrary({
  project,
  onChange,
  onUse,
  onStatus,
}: {
  project: BoneByBoneProject;
  onChange: (fonts: EmbeddedFont[]) => boolean;
  onUse?: (family: string) => void;
  onStatus: (message: string) => void;
}) {
  const chooser = useRef<HTMLInputElement>(null),
    [family, setFamily] = useState('');
  const [busy, setBusy] = useState(false);
  const currentProject = useRef(project),
    disposed = useRef(false);
  currentProject.current = project;
  useEffect(() => {
    disposed.current = false;
    return () => {
      disposed.current = true;
    };
  }, []);
  const fonts = project.fonts ?? [];
  const replace = (font: EmbeddedFont) => onChange(fonts.map((old) => (old.id === font.id ? font : old)));
  return (
    <details className="my-3 border-t border-neutral-700 pt-2" aria-label="Project font library">
      <summary className="cursor-pointer text-xs">Project fonts ({fonts.length})</summary>
      <div className="mt-2 space-y-2">
        <label className="block text-xs">
          Family name (optional)
          <input
            className={field}
            aria-label="Imported font family"
            value={family}
            placeholder="Read from font file"
            onChange={(e) => setFamily(e.target.value)}
          />
        </label>
        <button className={button} disabled={busy} onClick={() => chooser.current?.click()}>
          {busy ? 'Loading font…' : 'Import TTF / OTF'}
        </button>
        <input
          ref={chooser}
          type="file"
          accept=".ttf,.otf,font/ttf,font/otf"
          className="hidden"
          aria-label="Import project font"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            const captured = project;
            setBusy(true);
            try {
              if (file.size > FONT_MAX_BYTES) throw new Error('Font exceeds the 4 MiB import limit.');
              const buffer = await file.arrayBuffer(),
                bytes = new Uint8Array(buffer),
                inspection = inspectOpenType(bytes);
              const name =
                family.trim() || inspection.familyNames[0] || file.name.replace(/\.(ttf|otf)$/i, '');
              await new FontFace('BoneByBoneImportProbe', buffer).load();
              if (disposed.current || currentProject.current !== captured) return;
              let binary = '';
              for (let p = 0; p < bytes.length; p += 8192)
                binary += String.fromCharCode(...bytes.subarray(p, p + 8192));
              const old = (captured.fonts ?? []).find(
                (font) => fontFamilyKey(font.family) === fontFamilyKey(name),
              );
              const font: EmbeddedFont = {
                id: old?.id ?? uuid(),
                family: name,
                format: inspection.format,
                base64: btoa(binary),
                license: { name: 'Unspecified license', text: '', redistribution: 'unknown' },
              };
              if (!onChange([...(captured.fonts ?? []).filter((font) => font.id !== old?.id), font])) return;
              onStatus(`Imported ${name}. Add the font's redistribution license before shipping.`);
            } catch (error) {
              if (!disposed.current && currentProject.current === captured)
                onStatus((error as Error).message);
            } finally {
              if (!disposed.current) setBusy(false);
            }
          }}
        />
        <p className="text-xs text-neutral-400">
          Fonts and licenses are saved with the project. The fallback list controls glyph selection.
        </p>
        {fonts.map((font) => (
          <div
            key={font.id}
            className="space-y-1 rounded border border-neutral-700 p-2"
            aria-label={`Font ${font.family}`}
          >
            <div className="text-xs">
              {font.family} · {font.format.toUpperCase()}
            </div>
            <button className={button} disabled={!onUse} onClick={() => onUse?.(font.family)}>
              Use for selected text
            </button>{' '}
            <button
              className={button}
              aria-label={`Remove font ${font.family}`}
              onClick={() => onChange(fonts.filter((item) => item.id !== font.id))}
            >
              Remove
            </button>
            <label className="block text-xs">
              License name
              <input
                className={field}
                aria-label={`License name ${font.family}`}
                key={`${font.id}-${font.license.name}`}
                defaultValue={font.license.name}
                onBlur={(e) => {
                  if (e.target.value !== font.license.name)
                    replace({ ...font, license: { ...font.license, name: e.target.value } });
                }}
              />
            </label>
            <label className="block text-xs">
              License text
              <textarea
                className={field}
                aria-label={`License text ${font.family}`}
                key={`${font.id}-${font.license.text}`}
                defaultValue={font.license.text}
                onBlur={(e) => {
                  if (e.target.value !== font.license.text)
                    replace({ ...font, license: { ...font.license, text: e.target.value } });
                }}
              />
            </label>
            <label className="block text-xs">
              License source URL (optional)
              <input
                className={field}
                aria-label={`License URL ${font.family}`}
                key={`${font.id}-${font.license.sourceUrl ?? ''}`}
                defaultValue={font.license.sourceUrl ?? ''}
                onBlur={(e) => {
                  const sourceUrl = e.target.value.trim();
                  if (sourceUrl !== (font.license.sourceUrl ?? '')) {
                    const license = { ...font.license };
                    if (sourceUrl) license.sourceUrl = sourceUrl;
                    else delete license.sourceUrl;
                    replace({ ...font, license });
                  }
                }}
              />
            </label>
            <label className="block text-xs">
              Redistribution
              <select
                className={field}
                aria-label={`Redistribution ${font.family}`}
                value={font.license.redistribution}
                onChange={(e) =>
                  replace({
                    ...font,
                    license: {
                      ...font.license,
                      redistribution: e.target.value as EmbeddedFont['license']['redistribution'],
                    },
                  })
                }
              >
                <option value="unknown">Unverified</option>
                <option value="allowed">License permits redistribution</option>
                <option value="restricted">Restricted</option>
              </select>
            </label>
            {font.license.redistribution !== 'allowed' && (
              <p className="text-xs text-amber-300">Redistribution license needs review before shipping.</p>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}
