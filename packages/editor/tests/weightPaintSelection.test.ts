import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '../src/store/editorStore';

beforeEach(() => {
  useEditorStore.getState().documentReplaced();
  useEditorStore.setState({ activeTool: 'translate', previousTool: null, workspace: 'rig' });
});

describe('weight paint target ownership', () => {
  it('retains a mesh slot while choosing a hierarchy or toolbar paint bone', () => {
    const ui = useEditorStore.getState();
    ui.selectSlot('face-slot');
    ui.setTool('weights');
    ui.select('jaw');
    expect(useEditorStore.getState()).toMatchObject({
      selectedSlotId: 'face-slot',
      selectedBoneId: null,
      weightBoneId: 'jaw',
    });
    ui.setWeightBone('cheek');
    expect(useEditorStore.getState()).toMatchObject({ selectedSlotId: 'face-slot', weightBoneId: 'cheek' });
    ui.selectSlot('second-slot');
    expect(useEditorStore.getState()).toMatchObject({ selectedSlotId: 'second-slot', weightBoneId: 'cheek' });
    ui.setTool('translate');
    ui.select('jaw');
    expect(useEditorStore.getState()).toMatchObject({ selectedSlotId: null, selectedBoneId: 'jaw' });
  });

  it('accepts bone-first workflows through both tool activation and right-click switching', () => {
    const ui = useEditorStore.getState();
    ui.select('jaw');
    ui.setTool('weights');
    ui.selectSlot('face-slot');
    expect(useEditorStore.getState()).toMatchObject({ selectedSlotId: 'face-slot', weightBoneId: 'jaw' });
    ui.setTool('translate');
    ui.select('brow');
    ui.toggleLastTool();
    ui.selectSlot('face-slot');
    expect(useEditorStore.getState()).toMatchObject({
      activeTool: 'weights',
      selectedSlotId: 'face-slot',
      weightBoneId: 'brow',
    });
  });

  it('clears a paint target on document replacement and workspace navigation', () => {
    const ui = useEditorStore.getState();
    ui.setWeightBone('jaw');
    ui.documentReplaced();
    expect(useEditorStore.getState().weightBoneId).toBeNull();
    ui.setWeightBone('jaw');
    ui.setWorkspace('scene');
    expect(useEditorStore.getState().weightBoneId).toBeNull();
    ui.setWeightBone('jaw');
    ui.clearSelection();
    expect(useEditorStore.getState().weightBoneId).toBeNull();
  });
});
