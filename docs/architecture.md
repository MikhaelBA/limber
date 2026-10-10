# BoneByBone architecture

BoneByBone evolves the working Limber editor. Preserve existing rigs, mesh/deform edits, animation
curves, IK, skins, events, texture imports, autosave and optional Spine export during migration.

Pre-release policy (9 October 2026): the user removed backward file compatibility from acceptance requirements. Prioritize correct new authoring/runtime contracts; historical readers/adapters may remain when inexpensive, but preserving old file behavior must not complicate new features or delay a phase gate. Earlier migration ADRs describe delivered behavior, not a continuing compatibility obligation.

## Boundaries

- `packages/mesh`: renderer-independent mesh/influence algorithms; no core, editor or runtime dependency.
- `packages/core`: portable model, transforms, animation, constraints, skinning and serialization.
  May use mesh algorithms; no React, Pixi, editor or external runtime dependency. Enforced by `npm run check:boundaries`.
- `packages/editor`: React shell, command history, UI state, browser persistence and rendering adapter.
  Persistent changes use commands; pointer drags commit once. Frame evaluation stays outside React state.
- `packages/runtime`: evaluator consuming core data; no editor dependency. The legacy wireframe helper
  uses a caller-provided canvas context; loading/evaluation remains usable in Node.
- `packages/runtime-web`: browser pixel/font publication and shared Pixi scene/rig rendering.
  May use core/runtime and Pixi; no editor or React dependency. The editor injects its registry
  and guides, while native playback injects strict staged resources and a transparent production view.
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
owns the character editing path. SceneViewport consumes portable evaluated scene transforms and setup skeletal poses. Legacy history commands bind to their originating rig; project commands resynchronize the active reference adapter. Heavy import/export/mesh work
will move into workers as those features are implemented.

Recovery writes complete OPFS generations and atomically switches IndexedDB pointers; the previous
readable snapshot remains available. IndexedDB document-plus-texture records are the fallback for
unsupported OPFS or write failures. Never delete the only recoverable snapshot during a failed import.

## Verification

`npm run check` runs lint, boundary/format checks, TypeScript, unit tests and both package/editor builds.
`npm run test:e2e` starts its own server and tests the real editor, including frozen-frame input feedback.
CI must pass before a phase gate is marked complete. Existing local-only smoke evidence is not CI evidence.
