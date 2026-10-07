# Scene workspace

Choose **Scene** above the viewport to arrange images, groups and characters. Choose an artboard from the selector, or use **Add artboard**. Each artboard has its own dimensions and nodes. The origin is its center and coordinates increase right/down.

Use **Import image**, **Add group** or **Add rig**. Click a hierarchy row or visible object to select it; Shift-click extends the selection. Grouping requires selected siblings. Duplicate includes descendants. Delete removes selected subtrees. The inspector edits names, visibility, opacity and local transforms; numeric fields commit when focus leaves the field. Rotation and shear are radians and pivot coordinates are local pixels. Parent changes currently keep the local transform, so the object may move on screen.

Select a rig and choose **Edit character rig** to use the existing bone, mesh, skin, IK and animation tools in its local coordinate space. Return to Scene to see its setup pose composed with the other nodes. Character animation playback remains in the Character workspace at this milestone.

Undo/redo spans project edits and character edits. A character command restores its originating artboard and rig before replay; switching artboards does not clear history. New/Open replace history. Native Save downloads the complete `.bbbproj`, including all artboards and loaded image pixels. Restore autosave recovers the project snapshot.

The initial Scene viewport fits the artboard automatically. Camera navigation, drag gizmos, snapping, world-preserving reparent and incremental rendering are the next viewport milestone; they are not implied by this initial scene inspector.
