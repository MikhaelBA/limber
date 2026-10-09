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

## 7 October 2026 Phase 2 complete

Follow-up commit `0019805`; CI run 37634966623 passed all tests, Docker and both deployments. The original golden PNG and comparison tolerance remain unchanged; the fixed-size viewport passes on Linux too.

## 7 October 2026 Phase 3A scene motion core and commands

Implemented stable-ID scene clips/tracks/keys/events, pure numeric sampling, deterministic forward playback/loop events and project schema 2. Schema 1 migrates in memory by changing only the schema identifier; absent clip libraries mean empty. Legacy rig/animation/asset content and immutable historical files stay unchanged. Added an immutable schema-2 motion fixture.

Added project-scoped key upsert, multi-key move/scale/duplicate/delete, curve/event and clip metadata commands. Node deletion removes dependent scene tracks; node duplication creates corresponding tracks with stable redo/replay IDs. Validation rejects dangling targets, colliding tracks/keys, invalid curves, out-of-range time and invalid event data. Fractional clock steps have explicit boundary tolerance and a bounded loop-event allocation guard.

The new core and commands are not yet exposed as a Scene animation UI. Timeline/graph, explicit/auto key, preview wiring and the two-image workflow remain Phase 3B work. Local lint/boundaries, formatting, TypeScript, 236 unit tests, both builds and all six browser suites passed. Existing visual fixture comparison remains 0.000% changed pixels.

## 7 October 2026 Phase 3A published

Commit `85b550b`; CI run 37636766390 passed all checks, Docker and both deployments.

## 7 October 2026 Phase 3B Scene Motion Alpha interface

Added the Scene Animation dock with clip creation/removal/rename, setup/animate preview, explicit and auto keying, transient unkeyed edits, loop/play/stop/scrub, track filtering and zoom/scroll. The dopesheet supports selection/descendant overview, Shift and box multi-selection, snapped multi-key drag, duplicate/delete/time-scale and Escape cancellation. Value graphs and draggable Bezier handles edit the same outgoing key curves. Named events are visible during playback.

A separate SceneMotionSession streams frame callbacks without React change notifications. Playback and draft edits never mutate setup data. New/Open now advance a document epoch so reopening the same project ID resets transient scene state. The two-image browser workflow covers import, transform/opacity keys, curves, events, save/reopen parity, multi-key drag/undo, duplicates/deletion/time-scale and curve-handle undo.

Full lint/boundaries, formatting, TypeScript, 238 unit tests, both builds and all seven browser suites passed locally. The new box-selection regression exposed native browser text dragging stealing key gestures; suppressing native text selection on the dopesheet fixes it. Golden comparison remains 0.000% changed pixels; 100-image CPU render-submit p95 was 0.70ms. Phase 3 awaits CI before its gate is closed.

## 7 October 2026 Phase 3 complete

Commit `7e87a9b`; CI run 37675345618 passed Test & Build, Docker and both deployments. The push initially used the unrelated active GitHub account and returned 403; retrying with the existing repository-owner credential succeeded without changing the active account.

## 7 October 2026 Phase 4A portable UI model

ADR 0007 defines centered box layout, explicit anchors/offsets/pivots, size bounds/aspect fitting, safe areas, browser text shaping and versioned component overrides before renderer implementation. Added source schema 3 with lossless schema-1/2 migration, text/shape/mask/nine-slice/instance data, exact nine-slice strip geometry, deterministic layout and component expansion. Expanded trees enforce dependency/nesting/node budgets and eight nested masks. Definition edits preserve valid overrides and reject destructive exposed-target changes atomically; undo/redo retain revisions and source data.

An immutable reward popup source fixture exercises the model. Numeric tests cover four device sizes, safe-area containment, pivots/aspect constraints, source corner preservation, nested inheritance, overrides, invalid references/types and mask limits. Full lint/boundaries, formatting, TypeScript, 249 unit tests, both builds and all seven browser suites passed. The existing golden remained 0.000% different; 100-image CPU p95 was 0.90ms. This milestone is the portable model and command layer; UI controls, text rasterization, clipping and visual gate evidence remain Phase 4B work.

## 7 October 2026 Phase 4A published

Commit `32b213c`; CI run 37676993384 passed all checks, Docker and both deployments.

## 7 October 2026 Phase 4B Game UI interface

Added Game UI tools for text/panels/masks, image-to-nine-slice conversion using source texture dimensions, device presets, safe-area fields, responsive anchors/bounds/aspect controls and localization preview. A reward template merges into the current project with fresh stable IDs and one undo step. Component extraction preserves the original pose; the library edits shared definition nodes and exposed properties, creates instances and resets overrides. Destructive exposed-target edits and extraction that would discard descendant animation are rejected.

The Pixi scene adapter renders exact slice grids, nested rectangle masks and expanded components. Picking respects every ancestor mask. Native browser Canvas shapes whole text lines with explicit direction and font fallback; bundled unmodified Noto Sans Arabic and its OFL license provide an offline, repeatable Persian/mixed-script fixture. Text textures are owned and disposed separately from shared imported images. Overflow diagnostics include glyph extents, and localization previews do not change saved text.

251 unit tests passed. The new eighth browser suite passed four device aspects, sampled corner/center pixels, text preview isolation, overrides/save/reopen, template insertion, component extraction, nested definition color propagation, nested clipping/picking and the reviewed RTL golden. Full lint/boundaries, formatting, TypeScript, 251 unit tests, both builds and all eight browser suites passed locally. The prior scene golden remains 0.000% different with 100-image CPU p95 0.80ms. Phase 4 CI remains pending. Text supports explicit newlines and clipping; automatic paragraph wrapping, rich text, custom font bundling and native-engine shaping parity remain outside this Web UI Alpha path. Shipping `.bbb` compilation remains Phase 9.

## 8 October 2026 Phase 4 CI follow-up

Commit `03498d1` is pushed. CI run 37678740974 passed the existing seven browser suites but failed the new RTL golden comparison with 6.778% differing alpha pixels on Linux. Deployment and Docker were skipped. The Phase 4 gate remains open; Phase 5 has not started. The test now preserves its exact RTL raster, loaded-font descriptors and measured advances in the existing browser-evidence artifact so the platform difference can be diagnosed. The golden and tolerance are unchanged.

Diagnostic follow-up `653dffa` needed an unused-binding lint correction (`c3d602b`). CI run 37768337788 then reproduced the raster mismatch and captured the exact Linux image and metrics. Both platforms loaded the bundled Noto Sans Arabic with Chromium 153.0.8010.12, but native text advances were 257px on Linux versus 258.71991px on Windows. Visual inspection confirmed correct shaping/direction in both. A separate reviewed Linux reference now preserves the platform behavior without widening the alpha threshold; loaded-font and advance assertions guard against fallback fonts. The Windows reference remains unchanged. CI confirmation is pending.

## 8 October 2026 Phase 4 RTL gate passed; Docker follow-up

Commit `1107b91`; CI run 37770105482 passed all 251 unit tests, eight browser suites and both builds. VPS and GitHub Pages deployments succeeded. Docker failed because its build stage did not copy the native reward source fixture imported by the template command. Add that exact JSON file to the Docker build stage; no fixture or application behavior changes. Docker Desktop is unavailable locally, so the container verification remains a remote CI check. The Phase 4 regression gate is green; container delivery confirmation remains pending before publishing the next rig milestone.

## 8 October 2026 Phase 4 complete

Docker follow-up `df458b7`; CI run 37770931582 passed Test & Build, Docker, VPS and Pages deployments. The complete Phase 4 gate is closed.

## 8 October 2026 Phase 5A slot and skin edit safety

Slot insertion extends every animated draw-order permutation. Deletion removes slot tracks and skin references, translates draw-order indices by surviving identity and retains exclusive clipping boundaries through the next surviving slot. Undo restores the original slot position, timelines and clipping endpoints; redo reproduces the same source. Slot insertion, deletion, reordering and property rebinding validate a copy before publishing. Skin add/remove/activation validates all skins before mutation, rejects unknown activation without corrupting data/pose/history and preserves animation tracks. Core validation now checks inactive skins, unique nonempty skin names and duplicate attachment IDs.

Five new regression tests cover indexed permutations, middle/last and empty slot cases, exact undo/redo state, clipping endpoints, rejected edits with intact redo/pose, animated attachment precedence during skin switching and inactive-skin references. Full local checks passed with 256 unit tests, both builds and all eight browser suites. The existing scene golden remains 0.000% different; 100-image CPU render-submit p95 was 0.90ms. Remote CI is pending. Bone structural safety, typed markers/sockets, human helper, mirroring and the character fixture remain unfinished; this is not the Phase 5 gate.

## 8 October 2026 Phase 5A published

Commit `e5ae0bd`; CI run 37771697728 passed all checks, Docker and both deployments.

## 8 October 2026 Phase 5B transactional bone edits

Bone add/delete/reparent now prepare and validate skeleton and animation references on a private copy. Snapshot restoration retains the document/pose/map wrappers and existing animation objects while using the snapshot's own weight-index space. Deletion removes affected bone tracks and IK references, cleans root-bound slots/skins/clipping/draw-order tracks, and preserves surviving bone/slot order on undo. Deleting a still-weighted bone is rejected before mutation with a rebind/remove instruction. Reparent rejects cycles, unknown parents and singular transforms.

The reflected/sheared-parent regression exposed swapped off-diagonal entries in the old editing-time matrix inverse. Corrected that inverse and canonicalized the affine decomposition. Numeric tests now compare all six world-matrix entries, exact source restoration across repeated undo/redo, surviving weight-index remapping, save/reopen, unchanged pose/maps/redo on failure and animation object identity across earlier metadata undo. Full local checks passed with 261 unit tests and both builds. All nine browser suites passed, including the new character structural workflow: keyboard/hierarchy weighted-deletion errors, singular-parent rejection, successful reparent and exact saved-source undo/redo. The parent selector has an explicit accessible label, and command failures appear in the status bar. Remote CI is pending. Marker/socket and helper/mirror work remain; Pin Hand/Foot follows the specification's Phase 7 constraint milestone.

## 8 October 2026 Phase 5B published

Commit `e9c0527`; CI run 37837495521 passed all checks, Docker and both deployments.

## 8 October 2026 Phase 5C markers and sockets

Native source schema 4 adds optional, stable-ID bone markers: point, socket, spawn point, hitbox, hurtbox and trigger. Area geometry supports positive rectangles and simple concave polygons; duplicate IDs, missing bones, nonfinite transforms, degenerate/self-crossing geometry and unsupported kinds fail validation before publication. Schemas 1�3 migrate without adding or rewriting authored fields. The portable evaluator composes the sampled/solved bone pose, local marker transform and optional owning rig transform. Bone deletion removes its markers and undo restores them exactly.

The character hierarchy exposes marker creation, binding, name/kind, all affine channels and rectangle/polygon fields. Setup edits use atomic commands; animation mode previews without changing source or keys. Viewport crosses, orientation axes and area outlines follow the current pose. Spine JSON and bundle exports report marker omission; the native file retains the semantics. Direct Spine callers must explicitly collect warnings when markers exist.

All local checks passed: 266 unit tests, TypeScript, lint/boundaries, both builds and nine browser suites. The new browser workflow covers create/edit/delete, rejected geometry, exact undo/redo, native save/reopen and a numeric half-time socket pose. It also exposed and fixed Animate mode displaying an existing clip without selecting it after Open. The scene golden remains 0.000% different (100-image CPU p95 0.80ms). An earlier browser run was interrupted by development-server reload during test-file edits; the complete rerun passed with the source held stable. Remote CI is pending. Human helper, mirrored subtrees and the complete Phase 5 gate remain unfinished. Area outlines are authored metadata/preview; collision handling and native engine parity belong to later runtime phases.

## 9 October 2026 Phase 5D human guide and mirror

Marker milestone `77036ec` passed CI run 37839576104: all checks, Docker and both deployments. The human guide appends a parameterized fifteen-bone y-down hierarchy with hand/foot sockets, unique names and stable IDs. The guide preserves existing artwork, slots and animation. Mirror duplicates a selected setup subtree and its markers about a configurable rig-space vertical axis. Affine decomposition preserves reflected/sheared parent transforms; fresh marker IDs rebind to copied bones. Artwork, weights, constraints and animation tracks are not duplicated by this setup helper.

Both helpers prepare and validate a snapshot before publication, reject authoring in Animate mode, and retain exact source/IDs through one-step undo/redo. Human dimensions/positions and mirror singularities are validated before history changes. All local static checks, 269 unit tests and both builds passed. The human/mirror browser workflow passed setup/key isolation, exact undo/redo and save/reopen. All nine browser suites passed; the scene golden is unchanged (0.000%, 100-image CPU p95 0.80ms). The initial smoke attempt exposed an unscoped numeric-field selector; it now selects named fields within the accessible Character properties region. Remote CI remains pending; the Phase 5 gate remains open.

## 9 October 2026 Phase 5 complete

Commit `c9abe49`; CI run 37842645552 passed all checks, Docker and both deployments. The Rig Alpha gate is closed. Phase 6 begins with indexed weight safety and a portable mesh package; worker jobs, topology validation, bind-pose skinning and linked meshes remain separate unfinished milestones.

## 9 October 2026 Phase 6A influence safety

Added the independent mesh package and dependency/build/Docker wiring. Runtime load validation rejects missing/trailing rows, invalid indices, duplicate influences, nonfinite/negative values and nonnormalized sums. Normalization/pruning use stable ties and overflow-safe accumulation. Paint now preserves other bones proportionally, including when painting the slot bone. Normalize and maximum-influence Prune are exposed for weighted meshes in Setup with exact snapshot undo/redo. Tests include 400 seeded weight cases, invalid source rows, three-bone paint distributions and preservation of deformation tracks. Full local checks passed: lint/boundaries, formatting, TypeScript, 275 unit tests, package/editor builds and all ten browser suites. The new weight workflow checks sampled vertex positions, pruning, exact history, native roundtrip, invalid-import isolation and disabled Animate authoring. The scene golden remains 0.000% different (100-image CPU p95 0.80ms). Remote CI is pending; the remaining Phase 6 scope is recorded in ROADMAP.md and ADR 0009.

## 9 October 2026 Phase 6A published

Commit `9785d10`; CI run 37908044045 passed all checks, Docker and both deployments.

## 9 October 2026 Phase 6B topology safety

Portable validation now checks finite distinct vertex pairs, matching UVs, complete nondegenerate triangle indices, manifold edges, one simple boundary and exact hull coverage. Concave constrained triangulation excludes exterior faces and emits canonical indices. Existing meshes without an authored hull infer their boundary from triangles without changing saved source; editing publishes an explicit boundary and undo restores omission.

Grid/hull creation and vertex insertion/removal prepare geometry, weights and affected deformation tracks on a private rig snapshot. Failed operations preserve source, pose and redo. Successful vertex-count changes retain the existing policy of removing incompatible Deform tracks, with exact restoration on undo. Setup vertex drags retain the last valid candidate and preserve same-count tracks. Viewport failures appear in the status bar. Surviving attachment/slot object identity is retained across rig snapshots for compatibility with earlier commands.

Validation is for setup topology: animated deformation may legitimately fold triangles. The supported topology is one simple disk; holes and disconnected components are rejected explicitly. The triangulator is a separate mesh entry point so runtime validation does not import cdt2d. Bind-pose skinning, full Deform input validation, worker responsiveness, linked meshes and measured Standard/Heavy costs remain unfinished.

Full local checks passed with 283 unit tests, TypeScript, lint/boundaries and both builds. All ten browser suites passed, including concave hull creation with exact area, rejected setup drag and malformed native geometry import isolation. The existing scene golden is unchanged (0.000%; 100-image CPU p95 0.90ms). Remote CI remains pending; this is a Phase 6 increment, not the complete Deform Alpha gate.
