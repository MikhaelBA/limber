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
| 8     | Logic, typed parameters, state machine and bindings                  | Complete; CI 38034780726 passed |
| 9     | Native runtime compiler, Ship Doctor, profiler and atlas workers     | Complete; CI 38068183728 passed |
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

- [x] Typed parameters and deterministic graph/transition contract with recorded-input goldens (ADR 0023).
- [x] Native source/validation and atomic graph/parameter/state/transition commands.
- [x] Portable scene/character playback with blend/interruption and fixed-step event sampling.
- [x] Strengthened typed event payloads and native/editor event authoring.
- [x] One-way bindings to exposed properties with source preservation.
- [x] Portable typed pointer/focus/test routes with atomic input batches and receipt tracing.
- [x] Logic graph editing, pointer/focus/test preview and debug overlay.
- [x] Actual Standard/Heavy rendered-matrix/vertex parity and bounded CPU profiling.
- [x] Pixel goldens for independent clipping, exclusive ends, draw order and RGBA/alpha.
- [x] Disabled-logic/raw-animation parity, native/history/browser fixtures and full Phase 8 CI gate.

## Current Runtime Alpha checklist

- [x] Independent runtime v1 schema/compiler and strict ingestion contract (ADR 0024).
- [x] Debug JSON and compact UTF-8 `.bbb`, detached source and actionable diagnostics.
- [x] Corpus source/pose/vertex parity and explicit unsupported asset findings.
- [x] Native character API with correct raw mixing/FIFO queue, typed Logic and skin/socket lifecycle.
- [x] Native scene raw playback, responsive expanded UI, bindings and rendered-node routing.
- [x] Native artboard orchestration with scene and independent/instanced character parity.
- [x] Independent Web render adapter sharing tested clipping/RGBA behavior with the editor.
- [x] Portable deterministic multipage atlas layout, trim/scale, RGBA rotation and gutter composition.
- [x] Real PNG/JPEG/WebP/SVG worker decode, staged PNG atlas pages and hard cancellation.
- [x] Packed native atlas manifest, shared-page loading and export/load/render source pixel acceptance.
- [x] Packaged font staging, fallback and license metadata.
  - [x] Portable source/runtime OpenType bytes, strict bounds/cmap, license metadata and fallback diagnostics.
  - [x] Worker/browser font decode, isolated font publication, bundled font export and actual RTL pixel acceptance.
  - [x] Authoring font import, project preview/history and SVG text-font matching acceptance.
- [x] Rig/Ship Doctor, platform budgets, work counts and measured profiler.
  - [x] Portable native inventory, physical resource metrics and strict preset/custom warning policies.
  - [x] Live posed work counts, actual core WebGL2 draw submissions and bounded measured CPU profiler.
  - [x] Ship findings and saved custom policies.
  - [x] Actionable source focus, Rig findings and compatibility report.
- [x] Ship workspace, atlas inspection and complete export/load/play browser workflow.
  - [x] Worker preparation/cancellation, atlas inspection, packaged native preview and .bbb Save/Open.
  - [x] Typed Logic inputs, scene/character pointer/keyboard interaction and responsive preview.
  - [x] Complete actionable inspection and compatibility workflow.
- [x] Full native corpus, renderer/performance and Phase 9 CI acceptance gate.
  - [x] All 40 development browser suites, including fifteen native source projects and CPU gates.
  - [x] Main production build Ship workflow, typed inputs and actionable Doctor acceptance.
  - [x] Production workflow enforced and green in remote CI before Unity integration.

Native raster/SVG conversion and packed export/load/render now pass all fifteen source
projects. Font import, isolated preview, native packaging and explicit SVG text-font
matching pass actual browser acceptance. Ship preview, atlas inspection and saved warning
policies, typed native inputs and actionable Doctor findings pass development and production
builds. Commit `0ec8d38` passed the final complete acceptance gate in CI 38068183728:
680 unit tests in 91 files, all 40 development browser suites and all three main production
Ship suites, plus Docker, VPS and GitHub Pages. Phase 9 is complete. The existing legacy
player is not the native artboard player gate.

Phase 10 has not started. On 10 October 2026 the user explicitly requested that Unity work
wait; Phase 10 implementation must remain pending until the user resumes it.

## Weight painting regression and face example (10 October 2026)

- [x] Fix mutually exclusive mesh/bone selections preventing real weight-brush strokes.
- [x] Keep a separate paint bone, expose a labeled selector and retain mesh selection through hierarchy clicks.
- [x] Preserve Setup-only editing, single-stroke history and document/rig selection ownership.
- [x] Generate a transparent face with Image Generation and deliver a self-contained `.bbbproj`.
- [x] Verify 625 vertices, normalized weights, frozen bindings and 960-frame editor/native equality.
- [x] Exercise actual pointer painting, Undo/Redo, Save/Open and textured animation in development and production.

The new face example animates facial bones while its root remains stationary; removing
weights removes all facial movement. The browser gate now includes a real painting suite,
rather than relying on weight pruning or merely opening the Weights inspector. Phase 10
remains pending at the user's request.

## Practical weights and facial performance (11 October 2026)

- [x] Direct, proportional Add/Remove/Replace, feather and selected vertex/bone groups.
- [x] Per-attachment locks, copy/paste, Swap, Remove and retained tool selection.
- [x] Colored bone list, vertex pies, interpolated overlay and Selected filtering.
- [x] Binding workflows, initial topology-aware Auto, current-pose Update and triangle overlap order.
- [x] Hull/manual-edge Smooth, live source-preserving Prune preview, batch Prune and Weld.
- [x] Weighted path, bounding-box and clipping publication; copied subtree influence remapping.
- [x] Generated facial layers and practical Talking/Crying/Head Tilt/Laughing clips.
- [x] Source/PNG round trip and 2,040 native/editor frames with zero visible vertex error.
- [x] Full source checks and five actual production browser suites.
- [x] Complete all 42 development browser suites, including Heavy worker responsiveness.
- [x] Prepare the tested increment for publication; remote CI is reported with delivery.

This expands existing mesh/animation features using ADR 0026. Phases 0–9 remain complete;
Phase 10 Unity remains on hold. Spine's undocumented Auto formula is not available;
BoneByBone uses its own deterministic topology-aware algorithm.

## Layered character sample (10 October 2026)

- [x] Generate transparent fox parts and a costume variant with Image Generation.
- [x] Deliver a self-contained native project with 16 layers, weights, shared meshes and skins.
- [x] Author four clips, cloth Deform, existing hand IK, markers and events.
- [x] Verify native round trip, bind pose, 2160 runtime frames and actual editor Save/Open.
- [x] Provide original atlases, generation prompts, reproducible scripts and previews.

This sample exercises completed features and existing IK. It does not close any Phase 7 task.

## Character interaction and sample refinement (13 October 2026)

- [x] Distinct Setup rig/mesh authoring and Animate timeline/deformation presentation.
- [x] Independent mode display preferences, clean animation viewport and optional Setup timeline.
- [x] Tapered outlined bones, ring joints, selected orange controls and zero-length diamonds.
- [x] Visible move axes, rotation ring, scale boxes and dedicated Setup length handle.
- [x] Offset-preserving grabs, affine parent rotation/length/creation and stable scale sensitivity.
- [x] Escape/pointer cancellation, click-jitter rollback and one-gesture animated scale Undo.
- [x] Facial artwork transitions, weighted lip/jaw timing, asymmetric acting and invisible tear resets.
- [x] Regenerated self-contained project, editor previews and native animation/review frames.
- [x] Exact geometry, slot attachment and alpha agreement across 2,040 editor/native frames.
- [x] Complete source and browser acceptance; prepare the verified increment for publication.

The reported animation weakness was primarily sample acting and abrupt artwork switches;
separate mouse transform defects were reproduced and fixed. Pixel blending uses ordinary
editable slot color tracks and preserves the original generated PNG bytes. Numeric parity
checks do not establish photorealistic acting. The sample remains a silent stylized example.
Phase 10 Unity is still on hold.

## Publication regression correction (13 October 2026)

- [x] Diagnose the CI failure before deployment: stale shared-mesh Animate control assertion.
- [x] Require Setup-only Detach controls to be absent in Animate; retain functional mesh checks.
- [x] Repeat all 43 development browser suites, including shared meshes and performance gates.
- [x] Verify corrected-commit CI and all deployment jobs (2157bd3, run 38321728578).
- [x] Diagnose published Pages assets returning 404 outside the repository subdirectory.
- [x] Use relative build URLs and enforce actual subdirectory production acceptance.
- [x] Verify all six production suites at `/limber/` and actual root-webroot bootstrap/fonts.
- [x] Explicitly root-mount the standalone Atlas test artifact; verify SVG/WASM and bundled font pixels.
- [x] Verify corrected deployment and published Pages resource responses (0443142, run 38323653935).
- [x] Verify actual published-site Ship export/reload pixels, playback and resource cleanup.

## Tip-only child creation (13 October 2026)

- [x] Start new children at the parent's tip in both Bone-tool and Hierarchy addition.
- [x] Anchor previews and drag endpoints at the actual affine tip; retain default click length.
- [x] Verify chains, reflected/sheared parents, point bones, cancellation and exact Undo/Redo.
- [x] Pass the source gate and three affected development browser workflows; update the Persian guide.
- [x] Pass all six production workflows under `/limber/`, including tip-only creation.
- [x] Publish the tested increment and verify remote CI/deployment (42edd1a, run 38325935326).
- [x] Pass the complete rig-pointer workflow on the actual published Pages site.

Phase 10 Unity remains on hold.

## Visible selection feedback (13 October 2026)

- [x] Outline selected Character regions and posed meshes with a gold stroke and dark underlay.
- [x] Retain selection feedback in Setup/Animate and when Bone/Grid guides are hidden.
- [x] Follow changed vertices, attachment switches and zoom with constant screen-width strokes.
- [x] Cache mesh boundary topology; exclude interior triangle edges and use it for accurate picking.
- [x] Strengthen Scene selection bounds and include expanded component-instance artwork.
- [x] Pass source, affected browser and seven subdirectory production workflows.
- [ ] Publish and verify remote CI, deployment and actual published-site selection pixels.

Phase 10 Unity remains on hold.
