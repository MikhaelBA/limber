# ADR 0003 Project envelope before the scene workspace

Status: accepted for Phase 1A, 7 October 2026.

The first native `.bbbproj` is structured JSON with `format: bonebybone-project` and integer
`schemaVersion: 1`. The extension identifies authoring data; it is not a runtime format. The semantic
version shown in the specification is illustrative; integer migration steps match the existing tested
migration machinery. Future unsupported schemas fail before changing the current editor state.

Projects own a global image manifest, ordered artboards, and stable-ID group/image/rig nodes. A rig node
contains the existing SkeletonData and animation arrays without conversion. Its legacy EditorDocument
adapter shares those references, so existing commands and exporters continue to work. The rig's internal
IDs are scoped to that rig; project/artboard/scene IDs are unique at the project level. Scene pivots use
local pixels; any future normalized UI anchors are distinct properties.

This milestone implements the format and character editor bridge, not generic scene rendering. A
complex active artboard is rejected with an explanatory error rather than silently hiding its content.
Additional inactive artboards are preserved on save. The next scene workspace milestone will remove
this restriction once selection, renderer, history and commands work together.

Legacy `.limber.json` v1/v2 inputs remain unchanged on disk. Import creates a new project in memory,
and Save downloads `.bbbproj`. Existing IndexedDB recovery records remain readable; new records contain
the full project and textures. OPFS journaling is still a separate Phase 1 acceptance requirement.

Fixtures for legacy v2 and native project v1 are immutable. Tests cover data retention, malformed/future
files, reference-backed edits, a 10000-node hierarchy and 1000 seeded edit/undo/redo transactions.
