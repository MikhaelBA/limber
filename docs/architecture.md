# BoneByBone architecture

BoneByBone evolves the working Limber editor. Preserve existing rigs, mesh/deform edits, animation
curves, IK, skins, events, texture imports, autosave and optional Spine export during migration.

## Boundaries

- `packages/core`: portable model, transforms, animation, constraints, skinning and serialization.
  No React, Pixi, editor or external runtime dependency. Enforced by `npm run check:boundaries`.
- `packages/editor`: React shell, command history, UI state, browser persistence and rendering adapter.
  Persistent changes use commands; pointer drags commit once. Frame evaluation stays outside React state.
- `packages/runtime`: evaluator consuming core data; no editor dependency. The legacy wireframe helper
  uses a caller-provided canvas context; loading/evaluation remains usable in Node.
- New scene/project modules initially live in core. Extract packages when ownership becomes useful,
  rather than introducing empty packages or breaking existing imports.

## Migration invariants

Legacy v1/v2 files remain readable. A rig is preserved as a first-class skeleton node in an artboard;
its bone/slot/attachment IDs, weights, clips and texture IDs must survive migration unchanged.
The existing command surface may access the active rig through an adapter, never a duplicated rig.
New source files identify format and schema version. Future versions fail explicitly before state is replaced.
Project and runtime compilation are separate contracts. Spine export remains an optional compatibility adapter.

## Rendering and persistence

Retain Pixi/WebGL initially. Extract a renderer adapter incrementally; the existing ViewportCanvas
still owns the legacy drawing path until the scene viewport milestone. Heavy import/export/mesh work
will move into workers as those features are implemented.

The existing IndexedDB document-plus-texture recovery stays available throughout migration. OPFS
snapshots require atomic commit/recovery and failure tests before replacing it. Never delete the only
recoverable snapshot during a failed open or migration.

## Verification

`npm run check` runs lint, boundary/format checks, TypeScript, unit tests and both package/editor builds.
`npm run test:e2e` starts its own server and tests the real editor, including frozen-frame input feedback.
CI must pass before a phase gate is marked complete. Existing local-only smoke evidence is not CI evidence.
