import { create } from 'zustand';
import type { BonePropertyName } from '../commands/animationCommands';
import type { BrushMode } from '../commands/meshCommands';
import { history, type Command } from '../history/history';

export type Tool = 'select' | 'create_bone' | 'mesh' | 'weights';
export type { BonePropertyName };

/** A keyframe currently selected in the dopesheet (deleted via Del). */
export type KeyframeSelection =
  | { kind: 'bone'; boneId: string; property: BonePropertyName; time: number }
  | { kind: 'slotColor'; slotId: string; time: number }
  | { kind: 'drawOrder'; time: number }
  | { kind: 'deform'; attachmentId: string; time: number };

/**
 * UI STATE ONLY (DESIGN.md §5.2). Document/pose data lives in EditorEngine;
 * React re-reads it whenever dataRevision bumps. No 60fps values here — the
 * playhead position is NOT stored (it streams through engine transients).
 */
interface UIState {
  selectedBoneId: string | null;
  /** Slot selection is exclusive with bone selection (§5.7 picking order). */
  selectedSlotId: string | null;
  hoveredBoneId: string | null;
  selectedKeyframe: KeyframeSelection | null;
  activeTool: Tool;
  mode: 'setup' | 'animate';
  isPlaying: boolean;
  /** Weight brush (weights tool): world-space radius, 0..1 strength, behavior. */
  brushRadius: number;
  brushStrength: number;
  brushMode: BrushMode;
  dataRevision: number;
  canUndo: boolean;
  canRedo: boolean;
  statusMessage: string;

  execute: (cmd: Command) => void;
  undo: () => void;
  redo: () => void;
  select: (boneId: string | null) => void;
  selectSlot: (slotId: string | null) => void;
  clearSelection: () => void;
  setHover: (boneId: string | null) => void;
  setTool: (tool: Tool) => void;
  setMode: (mode: 'setup' | 'animate') => void;
  setPlaying: (playing: boolean) => void;
  setBrush: (patch: { radius?: number; strength?: number; mode?: BrushMode }) => void;
  setKeyframeSelection: (kf: KeyframeSelection | null) => void;
  setStatus: (msg: string) => void;
  /** Bump dataRevision so panels re-read engine data (e.g. after scrub/pause). */
  touch: () => void;
  /** Called after New/Open: fresh document ⇒ fresh history, no dangling selection. */
  documentReplaced: () => void;
}

let statusTimer: ReturnType<typeof setTimeout> | undefined;

export const useEditorStore = create<UIState>((set, get) => ({
  selectedBoneId: null,
  selectedSlotId: null,
  hoveredBoneId: null,
  selectedKeyframe: null,
  activeTool: 'select',
  mode: 'setup',
  isPlaying: false,
  brushRadius: 60,
  brushStrength: 0.4,
  brushMode: 'add',
  dataRevision: 0,
  canUndo: false,
  canRedo: false,
  statusMessage: '',

  execute: (cmd) => {
    history.execute(cmd);
    set((s) => ({
      dataRevision: s.dataRevision + 1,
      canUndo: history.canUndo,
      canRedo: history.canRedo,
    }));
  },

  undo: () => {
    if (history.undo()) {
      set((s) => ({
        dataRevision: s.dataRevision + 1,
        canUndo: history.canUndo,
        canRedo: history.canRedo,
      }));
    }
  },

  redo: () => {
    if (history.redo()) {
      set((s) => ({
        dataRevision: s.dataRevision + 1,
        canUndo: history.canUndo,
        canRedo: history.canRedo,
      }));
    }
  },

  select: (boneId) => set({ selectedBoneId: boneId, selectedSlotId: null, selectedKeyframe: null }),
  selectSlot: (slotId) => set({ selectedSlotId: slotId, selectedBoneId: null, selectedKeyframe: null }),
  clearSelection: () => set({ selectedBoneId: null, selectedSlotId: null }),
  setHover: (boneId) => set({ hoveredBoneId: boneId }),
  setTool: (tool) => set({ activeTool: tool }),
  setMode: (mode) => set({ mode }),
  setPlaying: (isPlaying) => set({ isPlaying }),
  setBrush: (patch) =>
    set((s) => ({
      brushRadius: patch.radius !== undefined ? Math.max(2, patch.radius) : s.brushRadius,
      brushStrength: patch.strength !== undefined ? Math.min(1, Math.max(0.02, patch.strength)) : s.brushStrength,
      brushMode: patch.mode ?? s.brushMode,
    })),
  setKeyframeSelection: (kf) => set({ selectedKeyframe: kf }),

  touch: () => set((s) => ({ dataRevision: s.dataRevision + 1 })),

  setStatus: (msg) => {
    set({ statusMessage: msg });
    if (statusTimer) clearTimeout(statusTimer);
    if (msg) {
      statusTimer = setTimeout(() => {
        if (get().statusMessage === msg) set({ statusMessage: '' });
      }, 4000);
    }
  },

  documentReplaced: () => {
    history.clear();
    set((s) => ({
      dataRevision: s.dataRevision + 1,
      canUndo: false,
      canRedo: false,
      selectedBoneId: null,
      selectedSlotId: null,
      hoveredBoneId: null,
      selectedKeyframe: null,
      mode: 'setup',
      isPlaying: false,
      statusMessage: '',
    }));
  },
}));
