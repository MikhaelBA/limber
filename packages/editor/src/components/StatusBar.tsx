import { useEngine } from '../hooks/useEngine';
import { useEditorStore } from '../store/editorStore';

export function StatusBar() {
  const engine = useEngine();
  useEditorStore((s) => s.dataRevision);
  const selected = useEditorStore((s) => s.selectedBoneId);
  const tool = useEditorStore((s) => s.activeTool);
  const status = useEditorStore((s) => s.statusMessage);

  const bones = engine.skeleton.data.bones;
  const selectedName = selected ? bones.find((b) => b.id === selected)?.name : null;

  return (
    <footer className="flex items-center gap-3 border-t border-neutral-800 bg-neutral-900 px-2 py-0.5 text-xs text-neutral-400">
      <span>{bones.length} bones</span>
      {selectedName && <span className="text-sky-300">◉ {selectedName}</span>}
      <span className="ml-auto rounded bg-neutral-800 px-1.5 uppercase">{tool === 'select' ? 'select' : 'bone'}</span>
      {status && <span className="max-w-[50%] truncate text-neutral-300">{status}</span>}
    </footer>
  );
}
