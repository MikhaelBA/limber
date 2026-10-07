# BoneByBone progress

## 7 October 2026 Foundation

Baseline: `e7c3f36`, 185 unit tests and working skeletal editor/browser smoke.

Implemented: product specification retained as reference, migration ADRs, architecture/runtime
contracts, immutable legacy fixture, deterministic test generator, lint/format/boundary checks,
and a managed-server browser test runner. ESLint 10 and Vitest 4 replace unsupported/vulnerable development-tool versions; npm audit reports zero findings.

Local verification passed: lint/boundaries, formatting, TypeScript, 185 unit tests, core/runtime and editor builds, complete browser smoke and frozen-frame regression. CI verification follows the push. Existing editor behavior is retained.

The full product is not complete. Next implementation is Phase 1 project/scene migration.

## 7 October 2026 Phase 0 complete

Commit `1e9859a`. CI run 37528484374 passed Test and Build, Docker, GitHub Pages and VPS deployment.

## 7 October 2026 Phase 1A project format and legacy migration

Implemented native schema v1 `.bbbproj`, stable project/artboard/group/image/rig IDs, hierarchy/reference validation, a reference-backed legacy rig adapter, unchanged v1/v2 Limber import, native Save/Open and full-project IndexedDB recovery. Product branding now reads BoneByBone. Spine export and all existing rig workflows remain available.

Verification: 200 unit tests passed, including immutable legacy/native fixtures, 10000 scene nodes and 1000 seeded edit/undo/redo transactions. Lint, boundaries, formatting, TypeScript, both builds and all three browser suites passed. Browser checks cover actual downloads/reopen, embedded textures, failed/future file isolation and recovery after reload.

Phase 1 remains partial: generic scene workspace/commands, multiple-artboard editing and OPFS recovery are outstanding. Unsupported complex active artboards fail explicitly rather than rendering incomplete content. Runtime `.bbb` export is not implemented by this source-format milestone.

## 7 October 2026 Phase 1A published

Commit `7727122`; CI run 37529378640 completed successfully, including browser tests, both deployments and Docker.

## 7 October 2026 Phase 1B recoverable local snapshots

Added OPFS snapshots with original texture blobs, atomic IndexedDB current/previous pointers, automatic fallback to IndexedDB, serialized writes and cross-tab locks. Recovery retains the last readable generation; stale debounce work is cancelled and failed writes surface a user message. Legacy recovery records still load.

Verification: all 200 unit tests, lint/boundaries/format, TypeScript, both builds and four browser suites passed locally. Fault tests assert texture bytes, failed commit rollback, missing OPFS, corrupt latest manifest, tab closure during a write, and clear/debounce ordering.

Remaining Phase 1 work: scene edit commands/workspace, generic node property editing and multi-artboard editing. Full browser-process/OS crash and storage-maintenance testing remain beta hardening, not claimed complete here.

## 7 October 2026 Phase 1B published

Commit `9751369`; CI run 37588102383 completed successfully.

## 7 October 2026 Phase 1C scene command layer

Added validated, reversible scene add/update/reparent/remove/group/duplicate/reorder commands, stable duplicate IDs and serializable edit intents. Transactions retain node-list references rather than cloning the entire project. Failed commands preserve redo; composite execution rolls back previously completed parts when a later part fails.

Coverage includes hierarchy cycles, subtree deletion, active-rig references, sibling ordering, intent replay, 10000 nodes and 1000 seeded edits with exact undo/redo round trips. Commands preserve local transforms when reparenting; preserving world position belongs to the upcoming scene interaction work.

Verification: 213 unit tests, lint, architecture boundaries, formatting, TypeScript, core/runtime and editor builds, and all four browser suites passed locally.

This milestone is the command layer only. The existing rig interface is retained; scene controls, engine/history integration across rigs and multiple artboards, and generic scene rendering remain outstanding. Complex active artboards still fail explicitly on load until that integration is ready.

## 7 October 2026 Phase 1C published

Commit `9cf317e`; CI run 37588953889 passed.

## 7 October 2026 Phase 1D scene workspace and artboards

Added Scene/Character navigation, a windowed scene hierarchy, multi-selection, editable node properties, image import, grouping/duplication/deletion/reparent/order controls, artboard creation/deletion/size/name controls, and entry into each character rig. Numeric inspector edits commit on blur as one undo step. Project commands refresh the rig adapter; legacy commands retain their originating project/artboard/rig so undo after navigation never edits the wrong character. Scene-only and complex projects now load and save without dropping content.

Added a minimal Pixi scene adapter and portable iterative transform evaluator (including pivots, reflection, shear, visibility and inherited opacity). This provides usable scene inspection for Phase 1; camera/gizmos, incremental rendering, runtime metrics and visual performance gates remain Phase 2 work. Scene preview currently shows setup poses; character animation remains in the Character workspace.

Verification includes 219 unit tests, new cross-artboard history tests and real-browser scene create/edit/save/reopen with imported image pixels. The browser suite also exercises 10000 hierarchy rows with bounded DOM size. Existing skeletal/browser behavior remains covered. Full local checks and all five browser suites passed. The 10000-node scroll/select/rename path took 940ms locally. CI must pass before the Phase 1 gate is closed.

## 7 October 2026 Phase 1 complete

Commit `23b5dc6`; CI run 37591752107 passed Test & Build, Docker and both deployments. The Phase 1 gate is complete.

## 7 October 2026 Phase 2 viewport implementation

Extracted Pixi scene rendering into a renderer adapter with cached geometry during gestures. Added pan/zoom/frame, move/rotate/uniform-scale handles, grid/angular/scale snapping, world-preserving pivot edits, multi-selection gestures, cancellation and one transaction per drag. Reparent now preserves the world pose through reflected/sheared parents. The source format accepts optional RGB tint (white when absent), preserving all existing v1 fixtures without rewriting them.

Added 1000 affine round trips, hierarchy selection/decomposition tests and a committed 100-image visual fixture. Browser checks compare the reviewed screenshot, assert geometry is not rebuilt during drag, exercise all gestures and verify camera/cancel leave source unchanged. The local 100-image drag CPU evaluation/render-submit p95 was 0.70ms; this is CPU timing, not GPU completion or a claim about future animated crowd performance.

Local lint/boundaries, format, TypeScript, 224 unit tests, both builds and six browser suites passed. The final visual comparison was 0.000% changed pixels and 100-image drag CPU p95 was 0.70ms. CI is pending before closing Phase 2. Scene remains a setup-pose workspace; generic scene animation is the next Motion Alpha milestone.

## 7 October 2026 Phase 2 CI follow-up

Commit `75e5732` passed unit/build checks and the first five browser suites, but CI run 37634449704 failed the new screenshot check. The test previously reported a dimension mismatch as 100% pixel difference without dimensions. It now fixes the renderer viewport at 976x749 independently of OS control/font metrics and reports mismatched dimensions explicitly. The reviewed PNG and pixel tolerance are unchanged; the local interaction suite still passes with 0.000% difference (CPU p95 0.60ms).

CI artifact upload now explicitly includes the `.smoke` directory's hidden path; the previous upload action skipped it. The Phase 2 gate remains pending until this CI follow-up passes. The Phase 3 motion ADR is a proposal, not completed implementation.
