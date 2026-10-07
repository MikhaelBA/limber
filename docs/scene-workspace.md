# Scene workspace

Choose **Scene** above the viewport to arrange images, groups and characters. Choose an artboard from the selector, or use **Add artboard**. Each artboard has its own dimensions and nodes. The origin is its center and coordinates increase right/down.

Use **Import image**, **Add group** or **Add rig**. Click a hierarchy row or visible object to select it; Shift-click extends the selection. Grouping requires selected siblings. Duplicate includes descendants. Delete removes selected subtrees. The inspector edits names, visibility, opacity and local transforms; numeric fields commit when focus leaves the field. Rotation and shear are radians and pivot coordinates are local pixels. Parent changes preserve the world pose; a zero-scale parent is rejected because its transform cannot be inverted.

Select a rig and choose **Edit character rig** to use the existing bone, mesh, skin, IK and animation tools in its local coordinate space. Return to Scene to see its setup pose composed with the other nodes. Character animation playback remains in the Character workspace at this milestone.

Undo/redo spans project edits and character edits. A character command restores its originating artboard and rig before replay; switching artboards does not clear history. New/Open replace history. Native Save downloads the complete `.bbbproj`, including all artboards and loaded image pixels. Restore autosave recovers the project snapshot.

The Scene viewport initially fits the artboard. Wheel zooms around the pointer; middle-button or Space-drag pans. **Frame selection** (F) fits the selection. Move uses the colored axis handles or a direct drag; Rotate uses the ring; Scale uniformly scales around the selection pivot. Pivot moves a single node’s pivot while keeping its artwork in place. **Snap** or Shift during a drag snaps translation to 10 pixels, rotation to 15 degrees and scale to 0.1. Escape cancels a drag. A completed multi-node gesture creates one Undo entry. Selected descendants follow a selected ancestor only once.

The timing overlay reports CPU scene update and render submission, including a rolling p95. It does not measure GPU completion. Per-frame gesture work is outside React; geometry is reused while dragging. Inspector edits and committed commands refresh the scene.
