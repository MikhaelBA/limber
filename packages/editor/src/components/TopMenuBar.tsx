import { useEffect, useRef, useState } from 'react';
import { deserializeDocument, exportSpineJson, serializeDocument } from '@limber/core';
import { buildSpineBundle } from '../export/spineBundle';
import { clearAutosave, readAutosave } from '../persistence/autosave';
import { textureRegistry } from '../engine/TextureRegistry';
import { useEngine } from '../hooks/useEngine';
import { useEditorStore } from '../store/editorStore';

export function TopMenuBar() {
  const engine = useEngine();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [hasAutosave, setHasAutosave] = useState(false);

  // Startup hint: a previous session may have left a crash-safe autosave.
  useEffect(() => {
    readAutosave()
      .then((rec) => {
        if (rec) {
          setHasAutosave(true);
          useEditorStore
            .getState()
            .setStatus(`Autosave from ${new Date(rec.savedAt).toLocaleTimeString()} found — File → Restore autosave`);
        }
      })
      .catch(() => {});
  }, []);

  const onNew = () => {
    engine.newDocument();
    textureRegistry.clear(); // Object URLs + GPU textures belong to the old doc (§8.2).
    clearAutosave().catch(() => {});
    setHasAutosave(false);
    useEditorStore.getState().documentReplaced();
    useEditorStore.getState().setStatus('New project created');
  };

  const onOpen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // Allow re-opening the same file.
    if (!file) return;
    const st = useEditorStore.getState();
    try {
      const doc = deserializeDocument(await file.text());
      engine.loadDocument(doc);
      textureRegistry.clear(); // Embedded pixels aren't serialized — re-drop images.
      st.documentReplaced();
      st.setStatus(`Opened ${file.name} — drop images again to restore textures`);
    } catch (err) {
      st.setStatus(`Open failed: ${(err as Error).message}`);
    }
  };

  const download = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onSave = () => {
    download(new Blob([serializeDocument(engine.document)], { type: 'application/json' }), 'project.limber.json');
    useEditorStore.getState().setStatus('Project saved (JSON download)');
  };

  const onExportSpine = () => {
    const st = useEditorStore.getState();
    try {
      const json = exportSpineJson(engine.document);
      download(new Blob([json], { type: 'application/json' }), 'skeleton.json');
      st.setStatus('Spine skeleton JSON exported (4.1 format — pair with your texture atlas)');
    } catch (err) {
      st.setStatus(`Spine export failed: ${(err as Error).message}`);
    }
  };

  /** JSON + atlas.png + atlas.txt with shared region names (one mapping). */
  const onExportBundle = async () => {
    const st = useEditorStore.getState();
    try {
      const bundle = await buildSpineBundle(engine.document);
      download(new Blob([bundle.json], { type: 'application/json' }), 'skeleton.json');
      if (bundle.png) {
        download(bundle.png, 'atlas.png');
        download(new Blob([bundle.atlas], { type: 'text/plain' }), 'atlas.txt');
        st.setStatus('Spine bundle exported: skeleton.json + atlas.png + atlas.txt');
      } else {
        st.setStatus('Spine JSON exported — no packed textures (drop images first to build an atlas)');
      }
    } catch (err) {
      st.setStatus(`Bundle export failed: ${(err as Error).message}`);
    }
  };

  const onRestoreAutosave = async () => {
    const st = useEditorStore.getState();
    const rec = await readAutosave().catch(() => null);
    if (!rec) {
      st.setStatus('No autosave found');
      setHasAutosave(false);
      return;
    }
    try {
      const doc = deserializeDocument(rec.json);
      textureRegistry.clear();
      engine.loadDocument(doc);
      // Re-register every texture under its ORIGINAL id so attachments resolve.
      await Promise.all(
        rec.textures.map((t) => textureRegistry.loadBlob(t.textureId, t.name, t.blob).catch(() => null)),
      );
      st.documentReplaced();
      st.setStatus(`Autosave restored — ${rec.textures.length} texture(s) included`);
    } catch (err) {
      st.setStatus(`Autosave restore failed: ${(err as Error).message}`);
    }
  };

  return (
    <header className="flex items-center gap-1 border-b border-neutral-800 bg-neutral-900 px-2 py-1">
      <span className="mr-2 text-sm font-bold tracking-wide text-sky-400">Limber</span>
      <button className="rounded px-2 py-0.5 text-sm hover:bg-neutral-800" onClick={onNew}>
        New
      </button>
      <button className="rounded px-2 py-0.5 text-sm hover:bg-neutral-800" onClick={() => fileInputRef.current?.click()}>
        Open…
      </button>
      <button className="rounded px-2 py-0.5 text-sm hover:bg-neutral-800" onClick={onSave}>
        Save
      </button>
      <button
        className="rounded px-2 py-0.5 text-sm text-emerald-200 hover:bg-neutral-800"
        title="Export the skeleton as Spine-runtime JSON (4.1)"
        onClick={onExportSpine}
      >
        Export Spine JSON
      </button>
      <button
        className="rounded px-2 py-0.5 text-sm text-emerald-200 hover:bg-neutral-800"
        title="Export skeleton.json + atlas.png + atlas.txt (textures packed with shared region names)"
        onClick={onExportBundle}
      >
        Export Spine Bundle
      </button>
      <button
        className="rounded px-2 py-0.5 text-sm text-amber-200 hover:bg-neutral-800 disabled:opacity-35"
        disabled={!hasAutosave}
        title="Restore the crash-safe autosave (document + textures)"
        onClick={onRestoreAutosave}
      >
        Restore autosave
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={onOpen}
      />
    </header>
  );
}
