# BoneByBone delivery roadmap

The product specification is the target. Limber functionality is retained and its milestone numbering
is historical. A partial implementation never implies the corresponding product gate is complete.

| Phase | Scope                                                                | Status                          |
| ----- | -------------------------------------------------------------------- | ------------------------------- |
| 0     | Foundation, architecture contracts, lint and browser CI              | Complete; CI 37528484374 passed |
| 1     | Project/scene model, commands, portable save and local recovery      | Complete; CI 37591752107 passed |
| 2     | Scene renderer, pivot, gizmos, multi-selection, performance fixtures | Complete; CI 37634966623 passed |
| 3     | Timeline/graph, explicit auto-key, multi-key operations              | Complete; CI 37675345618 passed |
| 4     | Game UI, 9-slice, text/RTL, layout, components                       | Complete; CI 37770931582 passed |
| 5     | Rig UX, mirror, guides, sockets and markers                          | Complete; CI 37842645552 passed |
| 6     | Auto mesh/weights, pruning, linked meshes and workers                | Complete; CI 37982002648 passed |
| 7     | Robust IK, transform/path constraints and secondary motion           | Complete; CI 38008404463 passed |
| 8     | Logic, typed parameters, state machine and bindings                  | Pending                         |
| 9     | Native runtime compiler, Ship Doctor, profiler and atlas workers     | Partial legacy player/atlas     |
| 10    | Unity importer, world and UGUI runtime                               | Pending                         |
| 11    | Cocos Creator integration and parity                                 | Pending                         |
| 12    | PSD import, recovery hardening, accessibility, public beta           | Pending                         |
| 13    | Commercial services only when validated                              | Pending                         |

## Reporting protocol

Each milestone records exact scope, tests, remaining gate requirements and commit in PROGRESS.md.
Run relevant checks before committing; push after success. Report failed/unavailable remote checks
honestly. Do not execute later phases merely because reference prompts are embedded in PRODUCT_SPEC.
Before each implementation task, recommend a model and reasoning effort suited to its complexity.

## Current viewport checklist

- [x] Portable world/local transform evaluation and affine golden tests.
- [x] Pixi adapter, cached geometry during drags, inherited opacity/tint and draw order.
- [x] Camera pan/zoom/frame, move/rotate/scale, snapping and pivot interaction.
- [x] Multi-selection, one undo per gesture, Escape cancellation and world-preserving reparent.
- [x] Stored 100-image screenshot fixture and render-submit timing instrumentation.
- [x] Full local checks and six browser regression suites for Phase 2.
- [x] Phase 2 CI gate before Motion Alpha.

## Current Motion Alpha checklist

- [x] Scene clip/track/key model and project schema-1 migration to schema 2.
- [x] Portable sampling, clock, loop/event ordering and numeric golden coverage.
- [x] Atomic multi-key move/duplicate/delete/time-scale/curve commands.
- [x] Delete/duplicate scene nodes keep animation references valid.
- [x] Scene timeline, explicit/auto key, graph editing and playback UI.
- [x] Two-image motion workflow E2E and all seven local browser suites.
- [x] Phase 3 CI gate.

## Upcoming UI Alpha checklist

- [x] Agree executable contracts for layout, text and component overrides (ADR 0007).
- [x] Schema migration, responsive layout solver, safe areas and validation.
- [x] Nine-slice, text, masks and component definitions/instances with reversible edits.
- [x] Device presets, reward popup template and localization stress preview.
- [x] Four-aspect browser fixture, corner preservation, RTL and component propagation evidence.
- [x] Full regression checks and Phase 4 CI gate.

## Upcoming Rig Alpha checklist

- [x] Preserve and verify setup/animation separation and skin/attachment switching.
- [x] Slot add/delete/reorder keeps animated draw order and clipping boundaries; exact undo/redo.
- [x] Slot/skin edits validate before mutation; inactive skins and duplicate identities are checked.
- [x] Make structural bone/slot/skin edits atomic and preserve draw order through undo.
- [x] Typed markers and deterministic socket world transforms with source migration.
- [x] Human rig helper and world-space bone mirroring with reflected-parent tests.
- [x] Marker editing/preview. Pin Hand/Foot remains in Phase 7 per the specification.
- [x] Character browser fixture, full regression checks and Phase 5 CI gate.

## Current Deform Alpha checklist

- [x] Portable mesh algorithms, strict influence validation, deterministic normalize/prune.
- [x] Mesh topology validation and transactional edits; concave triangulation.
- [x] Deform input validation and deterministic curve sampling.
- [x] Explicit bone binding and bind-pose-preserving skinning.
- [x] Auto weights worker with progress, hard cancellation and stale-result isolation.
- [x] Auto grid mesh worker with progress, cancellation and stale-result isolation.
- [x] Weight smoothing worker with normalized influences and atomic history.
- [x] Weight-only publication cost reduction and optional skinning work counters.
- [x] Linked/shared meshes with independent instance bindings/deform semantics.
- [x] Standard/Heavy fixture costs, responsive worker workflow and full Phase 6 CI gate.

## Upcoming Character Alpha checklist

- [x] Constraint evaluation/order contract and input/setup numeric validation (ADR 0018).
- [x] Atomic IK authoring and beginner Pin Hand/Foot action for ordinary setup limbs.
- [x] IK reflected/sheared/degenerate cases, pole and softness semantics/tests (ADR 0019).
- [x] Transform constraint model, solver, history, mixed order and controls (ADR 0020).
- [x] Path constraint model, deterministic path sampling, controls and progression keys (ADR 0021).
- [x] Portable damped-spring kernel and bounded 120Hz clock with numerical goldens (ADR 0022).
- [x] Fixed-step secondary motion after its solver contract is stable.
- [x] Serialized IK ordering UI and representative hand/foot Pin browser fixture.
- [x] Combined ordering, remaining solver fixtures and full Phase 7 CI gate.

## Upcoming Interactive Alpha checklist

- [ ] Typed parameters and deterministic graph/transition contract with recorded-input goldens (ADR 0023).
- [ ] Native source/validation and atomic graph/parameter/state/transition commands.
- [ ] Scene and character playback, blends/interruption and typed events.
- [ ] One-way bindings to exposed properties with source preservation.
- [ ] Logic graph editing, pointer/focus/test preview and debug overlay.
- [ ] Disabled-logic/raw-animation parity, native/history/browser fixtures and full Phase 8 CI gate.

## Layered character sample (10 October 2026)

- [x] Generate transparent fox parts and a costume variant with Image Generation.
- [x] Deliver a self-contained native project with 16 layers, weights, shared meshes and skins.
- [x] Author four clips, cloth Deform, existing hand IK, markers and events.
- [x] Verify native round trip, bind pose, 2160 runtime frames and actual editor Save/Open.
- [x] Provide original atlases, generation prompts, reproducible scripts and previews.

This sample exercises completed features and existing IK. It does not close any Phase 7 task.
