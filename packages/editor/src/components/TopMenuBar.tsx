import { useRef } from 'react';
import { deserializeDocument, serializeDocument } from '@limber/core';
import { textureRegistry } from '../engine/TextureRegistry';
import { useEngine } from '../hooks/useEngine';
import { useEditorStore } from '../store/editorStore';

export function TopMenuBar() {
  const engine = useEngine();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onNew = () => {
    engine.newDocument();
    textureRegistry.clear(); // Object URLs + GPU textures belong to the old doc (§8.2).
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

  const onSave = () => {
    const json = serializeDocument(engine.document);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'project.limber.json';
    a.click();
    URL.revokeObjectURL(url);
    useEditorStore.getState().setStatus('Project saved (JSON download)');
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
