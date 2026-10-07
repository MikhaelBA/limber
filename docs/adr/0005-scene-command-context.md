# ADR 0005: Project history with bound character context

Status: accepted.

Legacy commands hold EditorEngine and read its current skeleton or animation on execution. Reusing them after changing the active rig would otherwise mutate an unrelated character, particularly when duplicated rigs share internal bone IDs.

Bind each legacy command to the current project identity, artboard ID, rig ID and animation at execution. Undo/redo restores that context before invoking the command. Project commands declare `scope: project` and refresh the reference-backed rig adapter after mutation. New/Open still clear history. Reject replay against a different project rather than guessing a target. Scene-only artboards use an empty, non-persisted skeleton adapter and cannot execute bone commands.

Keep one chronological history: undoing deletion restores a rig before earlier rig edits can be undone. This avoids separate histories retaining references to deleted content. The UI mirrors the restored mode/play state and drops stale rig selection.

The portable scene evaluator owns affine math and inherited opacity/visibility. The initial Pixi adapter renders evaluated setup poses. Camera and pointer interaction can evolve without changing source truth or command routing.
