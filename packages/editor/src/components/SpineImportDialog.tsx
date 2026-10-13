import { useEffect, useRef, useState } from 'react';
import { spineSkinNames, type BoneByBoneProject } from '@limber/core';
import { prepareSpineProject, type SpineFiles } from '../import/spineFiles';

export function SpineImportDialog({
  input,
  onClose,
  onImport,
}: {
  input: SpineFiles;
  onClose: () => void;
  onImport: (project: BoneByBoneProject) => Promise<void>;
}) {
  const names = spineSkinNames(input.json);
  const [skin, setSkin] = useState(names.includes('default') ? 'default' : (names[0] ?? 'default'));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState(input.files);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => previous?.focus();
  }, []);
  const run = async () => {
    setBusy(true);
    setError('');
    try {
      const project = await prepareSpineProject({ ...input, files }, skin);
      await onImport(project);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Import Spine"
        ref={panel}
        tabIndex={-1}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape' && !busy) {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
          if (e.key === 'Tab') {
            const controls = [
              ...(panel.current?.querySelectorAll<HTMLElement>(
                'button:not(:disabled), select:not(:disabled), input:not(:disabled)',
              ) ?? []),
            ];
            const first = controls[0],
              last = controls[controls.length - 1];
            if (
              e.shiftKey &&
              (document.activeElement === first || document.activeElement === panel.current)
            ) {
              e.preventDefault();
              last?.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first?.focus();
            }
          }
        }}
        className="w-[480px] rounded border border-neutral-600 bg-neutral-900 p-4 text-sm shadow-xl"
      >
        <h2 className="mb-3 text-lg font-semibold">Import Spine</h2>
        <p className="mb-3 text-neutral-300">
          {input.name}.json · {files.length} selected files
        </p>
        <label className="flex items-center gap-3">
          Skin
          <select
            aria-label="Spine skin"
            disabled={busy}
            value={skin}
            onChange={(e) => setSkin(e.target.value)}
            className="rounded bg-neutral-800 p-1"
          >
            {(names.length ? names : ['default']).map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        <label className="mt-3 block text-neutral-300">
          Add atlas / images
          <input
            type="file"
            multiple
            aria-label="Spine assets"
            accept=".atlas,.txt,.png,.jpg,.jpeg,.webp"
            disabled={busy}
            className="mt-1 block w-full text-xs"
            onChange={(e) => {
              const next = [...(e.target.files ?? [])];
              setFiles((previous) => [
                ...previous.filter((f) => !next.some((n) => n.name === f.name)),
                ...next,
              ]);
              setError('');
              e.target.value = '';
            }}
          />
        </label>
        <p className="my-3 text-neutral-400">
          Imports the selected skin with default attachments, its rig and animations. Choose JSON + atlas +
          all page images together, or JSON + individual images. Missing assets and unsupported features are
          reported before replacing the project.
        </p>
        <p className="my-3 text-xs text-neutral-400">
          Spine 4.2 JSON. Constraints, special bone inheritance, Spine shear, linked meshes, sequences and
          independent per-influence deformation are not supported yet.
        </p>
        {error && (
          <p role="alert" className="mb-3 text-amber-300">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button disabled={busy} onClick={onClose} className="rounded bg-neutral-700 px-3 py-1">
            Cancel
          </button>
          <button
            disabled={busy}
            onClick={() => void run()}
            className="rounded bg-sky-700 px-3 py-1 disabled:opacity-50"
          >
            {busy ? 'Importing…' : 'Import'}
          </button>
        </div>
      </section>
    </div>
  );
}
