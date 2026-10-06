import { useEffect } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import {
  DeleteDeformKeyframeCommand,
  DeleteDrawOrderKeyframeCommand,
  DeleteEventKeyframeCommand,
  DeleteKeyframeCommand,
  DeleteSlotColorKeyframeCommand,
} from './commands/animationCommands';
import { RemoveBoneCommand } from './commands/boneCommands';
import { RemoveSlotCommand } from './commands/slotCommands';
import { HierarchyPanel } from './components/HierarchyPanel';
import { MainToolbar } from './components/MainToolbar';
import { PropertiesPanel } from './components/PropertiesPanel';
import { StatusBar } from './components/StatusBar';
import { TimelinePanel } from './components/TimelinePanel';
import { TopMenuBar } from './components/TopMenuBar';
import { ViewportCanvas } from './components/ViewportCanvas';
import { textureRegistry } from './engine/TextureRegistry';
import { EngineProvider, useEngine } from './hooks/useEngine';
import { scheduleAutosave } from './persistence/autosave';
import { useEditorStore } from './store/editorStore';

function Shell() {
  const engine = useEngine();
  const dataRevision = useEditorStore((s) => s.dataRevision);
  const selectedBoneId = useEditorStore((s) => s.selectedBoneId);
  const selectedSlotId = useEditorStore((s) => s.selectedSlotId);
  const clearSelection = useEditorStore((s) => s.clearSelection);

  // Drop the selection if the bone/slot vanished (e.g. undoing Add, or Delete).
  useEffect(() => {
    if (selectedBoneId && !engine.skeleton.boneIndexMap.has(selectedBoneId)) clearSelection();
    else if (selectedSlotId && !engine.skeleton.slotIndexMap.has(selectedSlotId)) clearSelection();
  }, [dataRevision, selectedBoneId, selectedSlotId, engine, clearSelection]);

  // Crash-safe autosave (§7): debounce writes on document changes. Selection
  // churn bumps dataRevision too — harmless, the write is idempotent.
  useEffect(() => {
    return useEditorStore.subscribe((state, prev) => {
      if (state.dataRevision === prev.dataRevision) return;
      scheduleAutosave(() => ({ doc: engine.document, textures: () => textureRegistry.blobEntries() }));
    });
  }, [engine]);

  // Global shortcuts — skipped while typing in inputs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) {
        return;
      }
      const st = useEditorStore.getState();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        st.redo();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        // A selected keyframe takes priority (dopesheet workflow); slot
        // selection comes next; otherwise the selected bone is deleted.
        if (st.selectedKeyframe && engine.currentAnimation) {
          const kf = st.selectedKeyframe;
          if (kf.kind === 'bone') {
            st.execute(new DeleteKeyframeCommand(engine, kf.boneId, kf.property, kf.time));
          } else if (kf.kind === 'slotColor') {
            st.execute(new DeleteSlotColorKeyframeCommand(engine, kf.slotId, kf.time));
          } else if (kf.kind === 'deform') {
            st.execute(new DeleteDeformKeyframeCommand(engine, kf.attachmentId, kf.time));
          } else if (kf.kind === 'event') {
            st.execute(new DeleteEventKeyframeCommand(engine, kf.time, kf.eventName));
          } else {
            st.execute(new DeleteDrawOrderKeyframeCommand(engine, kf.time));
          }
          st.setKeyframeSelection(null);
        } else if (st.selectedSlotId) {
          st.execute(new RemoveSlotCommand(engine, st.selectedSlotId));
        } else if (st.selectedBoneId) {
          st.execute(new RemoveBoneCommand(engine, st.selectedBoneId));
        }
      } else if (e.key === ' ') {
        e.preventDefault();
        if (engine.currentAnimation) {
          if (engine.playing) {
            engine.pause();
            st.setPlaying(false);
          } else {
            engine.play();
            st.setPlaying(true);
          }
        }
      } else if (e.key === 'Escape') {
        st.setTool('select');
      } else if (e.key === 'v' || e.key === 'V') {
        st.setTool('select');
      } else if (e.key === 'b' || e.key === 'B') {
        st.setTool('create_bone');
      } else if (e.key === 'm' || e.key === 'M') {
        st.setTool('mesh');
      } else if (e.key === 'w' || e.key === 'W') {
        st.setTool('weights');
      } else if (e.key === 'g' || e.key === 'G') {
        st.toggleGhosting();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engine]);

  return (
    <div className="flex h-full flex-col bg-neutral-900 text-neutral-200">
      <TopMenuBar />
      <MainToolbar />
      <PanelGroup direction="vertical" className="min-h-0 flex-1">
        <Panel defaultSize={78} minSize={30}>
          <PanelGroup direction="horizontal" className="h-full">
            <Panel defaultSize={20} minSize={12} className="min-w-0">
              <HierarchyPanel />
            </Panel>
            <PanelResizeHandle className="w-1 bg-neutral-800 transition-colors hover:bg-sky-600" />
            <Panel minSize={30}>
              <ViewportCanvas />
            </Panel>
            <PanelResizeHandle className="w-1 bg-neutral-800 transition-colors hover:bg-sky-600" />
            <Panel defaultSize={24} minSize={14} className="min-w-0">
              <PropertiesPanel />
            </Panel>
          </PanelGroup>
        </Panel>
        <PanelResizeHandle className="h-1 bg-neutral-800 transition-colors hover:bg-sky-600" />
        <Panel defaultSize={26} minSize={8}>
          <TimelinePanel />
        </Panel>
      </PanelGroup>
      <StatusBar />
    </div>
  );
}

export function App() {
  return (
    <EngineProvider>
      <Shell />
    </EngineProvider>
  );
}
