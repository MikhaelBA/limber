# Scene workspace

Choose **Scene** above the viewport to arrange images, groups and characters. Choose an artboard from the selector, or use **Add artboard**. Each artboard has its own dimensions and nodes. The origin is its center and coordinates increase right/down.

Use **Import image**, **Add group** or **Add rig**. Click a hierarchy row or visible object to select it; Shift-click extends the selection. Grouping requires selected siblings. Duplicate includes descendants. Delete removes selected subtrees. The inspector edits names, visibility, opacity and local transforms; numeric fields commit when focus leaves the field. Rotation and shear are radians and pivot coordinates are local pixels. Parent changes preserve the world pose; a zero-scale parent is rejected because its transform cannot be inverted.

Select a rig and choose **Edit character rig** to use the existing bone, mesh, skin, IK and animation tools in its local coordinate space. Return to Scene to see its setup pose composed with the other nodes. Skeletal animation playback remains in Character; scene-node transforms and opacity animate in the Scene Animation dock.

Undo/redo spans project edits and character edits. A character command restores its originating artboard and rig before replay; switching artboards does not clear history. New/Open replace history. Native Save downloads the complete `.bbbproj`, including all artboards and loaded image pixels. Restore autosave recovers the project snapshot.

The Scene viewport initially fits the artboard. Wheel zooms around the pointer; middle-button or Space-drag pans. **Frame selection** (F) fits the selection. Move uses the colored axis handles or a direct drag; Rotate uses the ring; Scale uniformly scales around the selection pivot. Pivot moves a single node’s pivot while keeping its artwork in place. **Snap** or Shift during a drag snaps translation to 10 pixels, rotation to 15 degrees and scale to 0.1. Escape cancels a drag. A completed multi-node gesture creates one Undo entry. Selected descendants follow a selected ancestor only once.

The timing overlay reports CPU scene update and render submission, including a rolling p95. It does not measure GPU completion. Per-frame gesture work is outside React; geometry is reused while dragging. Inspector edits and committed commands refresh the scene.

## Scene animation

Choose **Animation**, then **New clip** or an existing clip. **Setup** shows the authored base pose; **Animate scene** previews the clip. Select a node, choose a property and press **Key property** to store its current value at the playhead. With **Auto-key** enabled, inspector changes and viewport gestures write keys. With it disabled, changes are a temporary preview until manually keyed; scrub, Setup or playback clears that draft. The play clock and draft pose never alter saved setup values.

Scrub with the time field or ruler. Use Play/Pause/Stop and Loop to preview. The dock filters tracks and zooms horizontally; its overview includes selected nodes and descendants. Click keys, Shift-click to extend selection, or drag a box across empty track space. Drag selected keys to move them together, snapped to clip frames. Duplicate creates fresh selected keys one frame later; Delete and Time ×0.5/×2 act on the selection. Invalid collisions or keys outside the clip duration fail without partial edits. Escape cancels a key drag.

Select a numeric key to edit its outgoing curve. Linear, stepped and Bezier are supported. Numeric Bezier controls and draggable handles update the same key used by the value graph and preview; handle drags produce one undo step. Bezier time controls stay within [0,1]; value controls support overshoot. Key named events at the current time and watch them fire during playback. Scrubbing emits no events.

Save uses source schema 3 and includes clips, keys, curves, events and UI data. Schema-1/2 projects and legacy Limber files still load without changing their rig, node or asset content. Rig-internal animation and scene clips remain separate libraries; scene clips move the rig node but do not yet select or blend its skeletal clips.

## Game UI

Choose **Game UI** to add text, panels or rectangle masks, or insert the reward popup template as a new artboard. The template preserves the current project and can be undone. **Device preset** changes artboard size and safe-area insets in one undo step; custom insets are available in Artboard properties. The green rectangle is the safe area.

Select a node and enable **Responsive layout**. Equal anchors keep a fixed size; split anchors stretch between parent edges with pixel offsets. Choose an anchor preset or expand Layout X/Y for exact values, size limits and alignment pivot. Aspect ratio is optional. Root nodes can use the safe area; children use their parent's local box. Transform X/Y remain offsets over layout. Imported images can become **9-slice** images; borders use source texture pixels independently of destination width/height.

Text supports explicit line breaks, direction, alignment, font fallback, color and a binding name for future runtime data. Noto Sans Arabic is bundled locally with its license. Long/short/numeric localization previews leave saved text unchanged; overflow is reported and clipped. Automatic wrapping and rich text are not part of this initial text path. A mask clips its descendants; select it as the child's Parent. Up to eight nested masks are supported.

Open **Components** to turn a selected subtree into a shared definition, add instances and edit definition nodes. Text/tint/opacity/visibility can be explicitly exposed; instances edit only those overrides and can reset them to defaults. Definition edits propagate through nested instances while retaining overrides. Removing an exposed property in use is rejected; remove/reset its overrides first. Component extraction rejects descendant animation tracks that would otherwise be lost. Existing scene-root transforms remain animated on the instance.
