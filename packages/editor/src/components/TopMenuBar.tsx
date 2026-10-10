import { useEffect, useRef, useState } from 'react';
import {
  deserializeProject,
  exportSpineJson,
  serializeProject,
  assertSpineProjectSupported,
  type BoneByBoneProject,
  type TextureMeta,
} from '@limber/core';
import { buildSpineBundle } from '../export/spineBundle';
import { cancelScheduledAutosave, clearAutosave, readAutosave } from '../persistence/autosave';
import { textureRegistry } from '../engine/TextureRegistry';
import { useEngine } from '../hooks/useEngine';
import { useEditorStore } from '../store/editorStore';

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('dataURL encode failed'));
    reader.readAsDataURL(blob);
  });

/** Project file with every still-loaded texture embedded as a data URL. */
async function serializeSelfContained(doc: BoneByBoneProject): Promise<{ json: string; embedded: number }> {
  const blobs = new Map(textureRegistry.blobEntries().map((e) => [e.textureId, e]));
  const manifest: Record<string, TextureMeta> = {};
  let embedded = 0;
  for (const [textureId, meta] of Object.entries(doc.assetManifest)) {
    const blob = blobs.get(textureId);
    if (blob) {
      manifest[textureId] = { ...meta, dataUrl: await blobToDataUrl(blob.blob) };
      embedded++;
    } else {
      manifest[textureId] = { ...meta };
    }
  }
  return { json: serializeProject({ ...doc, assetManifest: manifest }), embedded };
}

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
            .setStatus(
              `Autosave from ${new Date(rec.savedAt).toLocaleTimeString()} found — File → Restore autosave`,
            );
        }
      })
      .catch((error: Error) => useEditorStore.getState().setStatus(error.message));
  }, []);

  const onNew = () => {
    engine.newDocument();
    useEditorStore.getState().setWorkspace('rig');
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
      const doc = deserializeProject(
        await file.text(),
        file.name.replace(/\.(limber\.json|json|bbbproj)$/i, ''),
      );
      engine.loadProject(doc);
      st.setWorkspace(
        doc.artboards.find((a) => a.id === doc.editor.activeArtboardId)?.nodes.length === 1 &&
          doc.editor.activeRigId
          ? 'rig'
          : 'scene',
      );
      cancelScheduledAutosave();
      textureRegistry.clear();
      // Self-contained files carry their pixels: re-register every embedded
      // texture under its ORIGINAL id so attachments resolve instantly.
      let restored = 0;
      for (const [textureId, meta] of Object.entries(doc.assetManifest)) {
        if (!meta.dataUrl) continue;
        try {
          const blob = await (await fetch(meta.dataUrl)).blob();
          await textureRegistry.loadBlob(textureId, meta.name, blob);
          restored++;
        } catch {
          /* A broken embed must not abort the open — placeholder shows. */
        }
      }
      st.documentReplaced();
      st.setStatus(
        restored > 0
          ? `Opened ${file.name} — ${restored} embedded texture(s) restored`
          : `Opened ${file.name} — drop images again to restore textures`,
      );
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

  const onSave = async () => {
    const st = useEditorStore.getState();
    try {
      const { json, embedded } = await serializeSelfContained(engine.project);
      download(new Blob([json], { type: 'application/json' }), 'project.bbbproj');
      st.setStatus(`Project saved — ${embedded} texture(s) embedded (self-contained file)`);
    } catch (err) {
      st.setStatus(`Save failed: ${(err as Error).message}`);
    }
  };

  const onExportSpine = () => {
    const st = useEditorStore.getState();
    try {
      assertSpineProjectSupported(engine.project);
      const warnings: string[] = [];
      const json = exportSpineJson(engine.document, undefined, warnings);
      download(new Blob([json], { type: 'application/json' }), 'skeleton.json');
      st.setStatus(
        warnings.join(' ') || 'Spine skeleton JSON exported (4.2 format — pair with your texture atlas)',
      );
    } catch (err) {
      st.setStatus(`Spine export failed: ${(err as Error).message}`);
    }
  };

  /** JSON + atlas.png + atlas.txt with shared region names (one mapping). */
  const onExportBundle = async () => {
    const st = useEditorStore.getState();
    try {
      assertSpineProjectSupported(engine.project);
      const bundle = await buildSpineBundle(engine.document);
      download(new Blob([bundle.json], { type: 'application/json' }), 'skeleton.json');
      if (bundle.png) {
        download(bundle.png, 'atlas.png');
        download(new Blob([bundle.atlas], { type: 'text/plain' }), 'atlas.txt');
        st.setStatus('Spine bundle exported: skeleton.json + atlas.png + atlas.txt');
      } else {
        st.setStatus('Spine JSON exported — no packed textures (drop images first to build an atlas)');
      }
      if (bundle.warnings.length) st.setStatus(bundle.warnings.join(' '));
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
      const doc = deserializeProject(rec.json);
      engine.loadProject(doc);
      st.setWorkspace(
        doc.artboards.find((a) => a.id === doc.editor.activeArtboardId)?.nodes.length === 1 &&
          doc.editor.activeRigId
          ? 'rig'
          : 'scene',
      );
      cancelScheduledAutosave();
      textureRegistry.clear();
      // Re-register every texture under its ORIGINAL id so attachments resolve.
      await Promise.all(
        rec.textures.map((t) => textureRegistry.loadBlob(t.textureId, t.name, t.blob).catch(() => null)),
      );
      // Textures missing from the record may still live in the manifest as
      // data URLs (self-contained files injected into the autosave slot).
      let fromEmbed = 0;
      const blobIds = new Set(rec.textures.map((t) => t.textureId));
      for (const [textureId, meta] of Object.entries(doc.assetManifest)) {
        if (!meta.dataUrl || blobIds.has(textureId)) continue;
        try {
          const blob = await (await fetch(meta.dataUrl)).blob();
          await textureRegistry.loadBlob(textureId, meta.name, blob);
          fromEmbed++;
        } catch {
          /* placeholder shows for broken embeds */
        }
      }
      st.documentReplaced();
      st.setStatus(
        `Autosave restored${rec.recoveredFromPrevious ? ' from previous complete snapshot' : ''} — ${rec.textures.length + fromEmbed} texture(s) included`,
      );
    } catch (err) {
      st.setStatus(`Autosave restore failed: ${(err as Error).message}`);
    }
  };

  return (
    <header className="flex items-center gap-1 border-b border-neutral-800 bg-neutral-900 px-2 py-1">
      <span className="mr-2 text-sm font-bold tracking-wide text-sky-400">BoneByBone</span>
      <button className="rounded px-2 py-0.5 text-sm hover:bg-neutral-800" onClick={onNew}>
        New
      </button>
      <button
        className="rounded px-2 py-0.5 text-sm hover:bg-neutral-800"
        onClick={() => fileInputRef.current?.click()}
      >
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
        accept=".bbbproj,.json,application/json"
        className="hidden"
        onChange={onOpen}
      />
    </header>
  );
}
