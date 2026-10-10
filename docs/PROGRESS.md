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

## 9 October 2026 Phase 6B published

Commit `c751258`; CI run 37910782693 passed all checks, Docker and both deployments.

## 9 October 2026 Phase 6C Deform validation and curve sampling

Deform validation is shared by native/legacy import, direct RuntimePlayer construction, structural rig edits and Spine export. Tracks require existing vertex geometry, unique attachment targets, strictly increasing finite nonnegative key times, null setup offsets or complete finite coordinate arrays, and supported finite curves. Cubic time controls stay in [0,1]; Y overshoot remains supported. Conservative segment bounds reject values that would overflow the Float32 deformation cache. Invalid sources fail before replacing the current project.

Deform sampling now evaluates the authored Bezier easing instead of treating every non-stepped key as linear. Null setup interpolation, overshoot and crossfade are covered by numeric tests. Drag commands and curve edits validate candidates before publication, preserve the last valid preview and exact undo/redo, and report failures in the viewport. An old export-only test supplied a partial quad offset array; it now supplies all four coordinate pairs explicitly.

Full local checks passed with 289 unit tests, TypeScript, lint/boundaries and both builds. All ten browser suites passed, including a cubic halfway vertex measurement and malformed Deform import isolation. The scene golden remains 0.000% different (100-image CPU p95 0.80ms). Remote CI is pending. Bone binding, workers, linked/shared meshes and Standard/Heavy measurement remain unfinished Phase 6 deliverables.

## 9 October 2026 Phase 6C published

Commit `f6d65c4`; CI run 37912067915 passed all checks, Docker and both deployments.

## 9 October 2026 Phase 6D explicit mesh binding

Native schema 5 stores stable-ID affine bone bindings captured from setup FK. The properties panel selects bones and binds/rebinds in one atomic Setup command. Changing weights after binding preserves setup artwork. The portable evaluator caches world*bind matrices and uses the same path for preview and RuntimePlayer. Reflected/sheared transforms and exact source restoration are covered by seeded numerical tests and a new native quad fixture. Bound influences and matrix/coordinate precision are validated before publication; unused bindings are cleaned on bone deletion. Deform bounds also validate the transformed bind coordinates.

Weighted cursor editing now inverts the vertex's blended transform, so setup/deform drags follow the cursor rather than incorrectly using only the slot bone. Singular blends report an editing error without publishing invalid coordinates. Bind selection/import failures preserve source and redo. Spine export explicitly rejects native bindings until its adapter supports those semantics; native save and runtime evaluation retain them.

The user removed backward file compatibility as an acceptance requirement. This policy is recorded in architecture.md; new contracts take precedence without adding compatibility work. Full local checks passed with 297 unit tests, TypeScript, lint/boundaries and both builds. All eleven browser suites passed, including exact bind history/roundtrip, half-time pose and weighted deform/cursor alignment. The scene golden remains 0.000% different (100-image CPU p95 0.80ms). Remote CI is pending. Auto mesh/weights workers, linked/shared meshes and measured Standard/Heavy costs remain Phase 6 work.

## 9 October 2026 Phase 6D published

Commit `8a3cb3c`; CI run 37942941693 passed all checks, Docker and both deployments.

## 9 October 2026 Phase 6E automatic weights

Bound meshes now expose Auto weights with an influence limit, progress and cancellation. A portable
deterministic nearest-segment inverse-square heuristic computes normalized weights in a dedicated
module Worker. Cancellation terminates computation; changing mode/unmounting also aborts. Results
publish in one atomic history command only if their project, rig, mode and complete source fingerprint
remain current. Bindings and Deform tracks remain intact; stale/invalid/cancelled work preserves source
and redo. ADR 0012 records the heuristic and publication contract.

Seeded geometry, zero-length/coincident bones, stable ties, numeric overflow, worker cleanup and
source/history isolation have unit coverage. Browser evidence uses real workers on 60 bones/2500
vertices and 120 bones/10000 vertices; only final delivery is held for deterministic race tests. The first
local run measured 75ms Standard and 336ms Heavy computation, with rendering active and maximum
frame gaps of 33.4ms during computation. These are geometry-only worker measurements; full
Standard/Heavy playback and main-thread publication costs remain pending. A fixture initially had
no clip, so entering Animate legitimately created a default clip and invalidated the test's source
assertion; the fixture now has an idle clip. No product behavior was changed for that test.

Full local checks passed with 306 unit tests, TypeScript, lint/boundaries, formatting and both builds.
All twelve browser suites passed; the scene golden remains 0.000% different (100-image CPU p95
0.70ms). The full run measured 65ms Standard and 393ms Heavy computation. Remote CI is pending.
Auto mesh workers, smoothing, linked/shared meshes and the complete Phase 6 performance gate
remain unfinished.

## 9 October 2026 Phase 6E published

Commit `bf58a6c`; CI run 37947209542 passed all checks, Docker and both deployments.

## 9 October 2026 Phase 6F automatic grid mesh

Region properties now expose automatic grid generation with row/column counts, progress and hard
cancellation. The portable algorithm interpolates the actual region corners and UVs, including
reflected/sheared artwork and cropped UVs. It validates source/output topology in a dedicated Worker.
The shared worker lifecycle handles identity, cancellation and failure cleanup for both mesh and
weights. This is a regular lattice tool; transparent-pixel tracing is not implemented.

Successful publication creates a fresh mesh while keeping the source region and its keys, assigning
the mesh to the default slot or active skin in one exact undo/redo step. Setup mode and complete rig
fingerprint guards reject stale results. Browser coverage includes real 10000-vertex generation,
UV/corner preservation, save/reopen, failed subdivision redo retention, cancel/stale/mode isolation.
Shared worker tests cover abort during construction, startup/clone errors and a throwing progress
consumer. Full local checks passed with 314 unit tests, lint/boundaries, formatting, TypeScript and
both builds. All thirteen browser suites passed (scene golden 0.000%, CPU p95 0.80ms). Both worker
browser workflows also passed against the production build, including the generated worker assets.
Remote CI is pending. Smooth weights, linked/shared meshes and the final Phase 6 performance gate
remain unfinished.

## 9 October 2026 Phase 6F published

Commit `6ed9b92`; CI run 37949541821 passed all checks, Docker and both deployments.

## 9 October 2026 Phase 6G weight smoothing

Bound weighted meshes now expose strength and pass count for whole-mesh smoothing. The portable
algorithm averages unique sorted edge neighbors, reads the previous complete pass, treats empty
rows as slot-bone rigid weights, and normalizes/prunes each pass to the chosen influence limit.
Computation runs in an isolated cancellable Worker with bounded progress messages. Publication
retains geometry, bindings and Deform clips and rejects changed project/rig/mode/source.

Numeric golden tests cover one/two passes, rigid fallback, tie pruning and unchanged input. Seeded
multi-pass tests check normalized finite rows, maximum influence count and triangle-order parity.
The browser workflow passes numeric output, Bind/Deform preservation, exact undo/redo and native
roundtrip, invalid-input redo retention, hard cancellation and stale-result isolation. An initial exact
floating-point assertion differed by 5.6e-17; the numerical golden now uses the documented tolerance.
Full local checks passed with 319 unit tests, TypeScript, lint/boundaries, formatting and both builds.
All fourteen browser suites passed (scene golden 0.000%, CPU p95 0.80ms), and the smoothing workflow
also passed from the production build. Remote CI is pending. Linked/shared meshes and the complete
Phase 6 performance gate remain unfinished.

## 9 October 2026 Phase 6G published

Commit `d80dc0b`; CI run 37951259937 passed all checks, Docker and both deployments.

## 9 October 2026 Phase 6H weight publication cost

Final-result timing exposed 86.4ms Standard and 295.5ms Heavy publication pauses despite Worker
computation being responsive. Weight publication now validates only the new normalized/bound
influences and changes one copied array, preserving unchanged geometry and pose/deform/bind
caches. Complete source fingerprint guards remain, without a redundant source clone. Streaming
weight validation removes per-vertex row/Set/influence allocations. Tests verify exact history and
unchanged caches and reject known but unbound influences without source/redo changes.

The optimized production-build measurements were 21.5ms Standard and 41.4ms Heavy publication. The
timer covers delivery/authoring microtasks; subsequent renderer reconciliation is outside it. Optional
reusable core skinning counters now report actual vertex/influence transforms and bind products
without changing output. Full local checks passed with 321 unit tests, TypeScript, lint/boundaries,
formatting and both builds. All fourteen browser suites passed (scene golden 0.000%, CPU p95
0.80ms); the optimized weight workflow also passed from the production build. Remote CI is pending.
Linked/shared meshes, full Standard constraints/clips and Heavy clipping/deform playback/frame
measurements remain unfinished; this increment does not close the Phase 6 gate.

## 9 October 2026 Phase 6H browser gate repair

Remote run 37953501945 passed unit/build checks but timed out waiting for a download in
weight-tools.mjs during repeated malformed-geometry imports. The existing test also allowed a
previous identical error to satisfy the next asynchronous import assertion. The suite now clears
and awaits each import status and paces its rapid tiny snapshot downloads. Local reproduction
passed before and after; the timeout alone does not prove which timing condition caused the
remote failure. A fresh CI run must confirm this gate before Phase 6 is called complete.

## 9 October 2026 Phase 6H repaired gate published

Commit `5053247`; CI run 37976413952 passed all checks, Docker and both deployments.

## 9 October 2026 Phase 6I shared mesh variants

Native schema 6 now stores one geometry owner and same-rig mesh references. Each instance owns
its texture, weights, frozen Bind and Deform; creation copies animation once, then edits independently.
Setup vertex edits propagate to followers. Topology count edits update all weight rows and invalidate
all affected Deform tracks atomically. Detach makes geometry independent. Source deletion with
followers fails without source/history changes; instance deletion removes its own tracks and restores
exact order on undo. The UI supports creation, texture selection, detach and guarded deletion.
ADR 0016 documents the storage/evaluation contract and explicit Spine export limitation.

Full-coordinate runtime goldens, native serialization and malformed-reference tests cover the core.
Authoring tests cover aliases, independent paint/rebind/texture, both topology operations, skin
assignment, exact undo/redo and rejected-operation redo preservation. The browser workflow passes
shared creation, setup editing, independent animated Deform, detach, source-delete guard, native
roundtrip and malformed import isolation. Full local regression checks and remote CI follow. The
remaining Phase 6 deliverable is complete Standard/Heavy playback and workflow performance evidence.

Phase 6I validation: all 335 unit tests, TypeScript, lint/boundaries, formatting and both builds
passed. All fifteen browser suites passed, including scene/RTL goldens; the shared-mesh workflow
also passed against production assets. The schema-advancement regression initially found two
browser assertions still expecting schema 5; they now expect schema 6. Remote CI follows.

## 9 October 2026 Phase 6I published

Commit `5a59f4e`; CI run 37979002490 passed all checks, Docker and both deployments.

## 9 October 2026 Phase 6J complete mesh performance fixtures

Versioned profiles now generate Standard (60 bones/2500 weighted vertices/5 constraints/10 clips)
and Heavy (120 bones/10000 weighted vertices/10 constraints/10 clips/clipping/Deform). Runtime/
preview parity and actual vertex-transform counters are asserted. Bounded opt-in ticker capture
measures core, viewport and CPU rendering submission separately from actual frame cadence. The
full Heavy worker workflow verifies an inspector interaction during computation, preserved GPU/
ghost caches, clips/Bind and exact history/native roundtrip. ADR 0017 defines this evidence gate.

The complete fixture exposed repeated bind/Deform validation costs; conservative bounds now prove
ordinary segments safe in O(vertices + bindings), retaining exact checks near Float32 limits. Sparse
conflicting linked geometry and source coordinates/UVs outside finite Float32 range are rejected.
Renderer updates retain unchanged geometry/ghost caches for weight/property edits, rebuilding only
when the relevant source or structural allocation changes.

All local checks passed with 341 unit tests, TypeScript, lint/boundaries, formatting and both builds.
All sixteen browser suites passed with unchanged scene/RTL tolerances. The complete production
profile workflow also passed: Standard/Heavy CPU update/render-submit p95 1.70/3.20ms, with
10000/40004 vertex transforms per frame. Heavy worker computation/publication was 500.6/31.4ms
with rendering and inspector interaction active. SwiftShader actual frame-gap p95 was 27.6/61.0ms;
CPU budget passage is not a hardware-independent 60fps GPU claim. docs/performance/phase6-mesh.md
contains the full scope and limits. No Phase 6 feature task remains; the final remote CI gate follows.

## 9 October 2026 Phase 6J clean-checkout gate repair

Commit `9060ea2` was pushed, but run 37981384749 stopped at TypeScript: the new preview/runtime
parity test imported @limber/runtime before its dist existed on a clean checkout. It now imports
the runtime source, matching existing fixture tests. Typecheck passes with runtime/dist temporarily
absent, and both parity cases pass. The paced weight browser helper also now awaits real UI status
instead of importing a Vite-only store module; its complete workflow passes against production.
The feature implementation and numerical budget are unchanged. A fresh full CI run follows.

## 9 October 2026 Phase 6 complete

Commit `95bdfd1`; CI run 37982002648 passed all checks, 341 unit tests, all sixteen browser suites,
Docker and both deployments. The clean-checkout runtime test repair is confirmed. Standard/Heavy
Linux CI CPU update/render-submit p95 was 1.40/4.20ms; exact transform counts were 10000/40004.
Heavy worker computation/publication was 290.7/39.9ms with inspector interaction and rendering
active. CI also records software-graphics frame gaps separately; hardware GPU performance is not
claimed. All Phase 6 feature and acceptance checklist items are complete. Phase 7 starts with the
constraint contract, atomic authoring and Pin Hand/Foot; Sol 6.1 / High remains the recommendation
for the first increment. Its expanded task checklist is in ROADMAP.md.

## 10 October 2026 layered Fox Adventurer sample

Added `examples/fox-adventurer/Fox-Adventurer.bbbproj`: two unchanged transparent
Image Generation atlases embedded in native schema 6, 16 independent sprite layers,
19 bones, a 30-vertex weighted tunic, a 35-vertex weighted scarf, frozen bind matrices
and shared-geometry costume variants. Both skins have independent Deform tracks.
Idle, Wave (IK), March and Cloth demo include Bezier easing, hello/footstep events,
hand socket/spawn markers, a body hurtbox and a ground-contact point.

Verification uses real core/runtime sources: exact native JSON round trip, embedded
PNG identity/dimensions, bind-pose preservation and 2160 frames across all eight
skin/animation combinations. All outputs remain finite, cloth moves, events fire and
the right-hand IK endpoint stays within 0.002 pixels of its reachable target.
Real Chromium verifies Open with two restored textures, playback, skin switching,
mesh/weights inspector selection, Save and reopen without page errors. Original
atlases, prompts, preview images, validation results and rebuild/test scripts are
included; README links the downloadable project and its Persian usage guide.

No application source changed. March is a stylized in-place motion. This sample
uses the existing positive-scale IK solver and does not implement Phase 7 physics,
robust affine IK, Pin Hand/Foot or path/transform constraints.

## 10 October 2026 Phase 7A constraint publication and semantic pins

Added the shared renderer-independent constraint stage to character/scene preview,
onion skin and RuntimePlayer. ADR 0018 specifies serialized priority, subtree
target/parent dependencies, cycle rejection and sequential overlapping writers.
Constraint IDs/orders, strength/bend, setup fields and derived setup world matrices
are validated before publication. Unsupported pole/nonzero-softness fields now
fail explicitly rather than silently doing nothing.

IK add/edit/remove/reorder now use detached, validated snapshots. Failure preserves
source, pose, weight index space and redo; history stays attached to its original
rig after navigation. Setup-only Pin Hand/Foot controls the selected endpoint's
parent/grandparent limb and creates an independent rig-space target in one undo
step. Target bones still accept ordinary animation keys. The inspector separates
artist strength/bend controls from advanced target/order controls. Collinear limbs
prefer bending away from the body; target conflicts and unsupported setup limbs
produce status messages without mutation.

All 367 unit tests, lint/boundaries, formatting, TypeScript and package/editor builds
passed locally. New cases cover ordered moving targets, cycles, invalid parameters,
overflow, pin/body independence, bind weights, exact undo/redo and rig navigation.
Two older IK fixtures pointed at their own controlled bones; they now use independent
targets while retaining their ordering/export assertions. A real-browser workflow
uses the generated fox's embedded textures, skins, hand/foot markers, body motion,
strength/order editing, target keys and failed-import isolation. The complete
seventeen-suite browser regression passed. Standard/Heavy CPU update/render-submit
p95 was 2.30/4.10ms; exact weighted transform counts stayed 10000/40004. Heavy worker
publication was 45.2ms. Software-graphics frame gaps are reported separately, not
advertised as hardware-independent 60fps. Code commit `b84134d` passed the complete
remote CI run 37996700991: Test & Build (including browser regression), Docker,
VPS deployment and GitHub Pages deployment all succeeded.

Remaining Phase 7 work: robust reflected/scaled/sheared IK and degeneracy semantics,
pole and softness, transform/path constraints, fixed-step secondary motion and the
combined final gate. This increment's Pin actions explicitly require unit-scale,
unsheared/unreflected aligned limbs and pin position only. No source-format field
was added; schema 6 remains current. Sol 6.1 / High remains suitable for the next increment.

Previous sample CI 37992186939 passed Test & Build and both deployments. Docker failed
on Docker Hub's 429 download limit; rerunning that failed job hit the same registry
limit on the Node image. This is recorded separately from code/test verification;
the Phase 7A run subsequently built and published Docker successfully.

## 10 October 2026 Phase 7B affine IK, poles and soft reach

Replaced angle-only/world-length IK with a solver derived from the exact FK
convention. It inverts the chain parent and solves the radius/direction of an
offset ellipse; conformal chains retain an analytic circle path. Bounded
half-angle quartics isolate all branches and extrema without per-frame allocation.
Signed/nonuniform scales, shear and arbitrary child offsets are supported. The
world-space bend side remains consistent under reflection; a live independent
pole chooses the side, with a collinear pole falling back to serialized bend.

ADR 0019 defines radial projection of unreachable targets in parent coordinates,
exponential soft reach in parent units, shortest-arc local mix, zero/collapsed
geometry reductions and singular-parent hold behavior. Softness never stretches
authored lengths/scales. Pole and softness editing is atomic and Setup-only,
with native roundtrip/history coverage. Own-subtree poles fail publication;
pole dependencies participate in serialized priority and cycle validation.
Position-only dependencies now correctly exclude another writer's own root
origin, while chain-parent reads still include its changing basis.

Pins accept invertible reflected/scaled/sheared limbs and parents, preserve the
setup endpoint and hold it through reachable body motion. Collapsed pins still
fail before mutation. Endpoint alignment remains required. No persistent field
was added; existing schema-6 pole/softness fields now have specified behavior.
One-bone pole/nonzero-softness authoring rejects explicitly; stretch is not a
supported feature.

All 388 unit tests, lint/boundaries, formatting, TypeScript and package/editor
builds passed locally. Numerical coverage includes 400 deterministic FK-generated
affine targets (endpoint error below 0.0003 units), mirrored world bend/poles,
unreachable extrema, finite degeneracies, soft-reach goldens, quartic tangencies
and native/runtime parity. The complete eighteen-suite browser regression passed,
including affine pins, body motion, pole/softness controls, atomic invalid edits,
exact undo/redo and Save/Open. Standard/Heavy CPU update/render-submit p95 was
1.30/2.50ms; exact weighted transform counts remained 10000/40004. Heavy worker
publication was 39.7ms. SwiftShader frame gaps remain separate software-graphics
evidence, not a hardware-independent 60fps claim. Code commit `857cb3c` passed
remote CI 37999493731: Test & Build, Docker, VPS and GitHub Pages all succeeded.

Phase 7 still needs transform/path constraints, specified fixed-step secondary
motion and the combined acceptance gate. Sol 6.1 / High remains suitable for
transform constraint implementation; no model change is required.

## 10 October 2026 Phase 7C transform follow and mixed constraint order

Source schema 7 adds native transform follow with independent translation,
rotation, signed-scale and shear mixes, world/local modes and composed target
space offsets. Creation preserves the evaluated setup pose by default; artists
can choose to copy immediately. Canonical QR decomposition, shortest-arc rotation
and tangent shear interpolation are defined in ADR 0020. Singular required
inverses/decompositions hold the sampled pose deterministically.

IK and follow now share one baked serialized order, globally unique IDs/orders,
dependency analysis and cycle rejection. Position reads account for moving follow
roots; local reads only depend on actual local writers. Atomic authoring uses a
shared rig-scoped snapshot command. Bone deletion removes referencing follows;
undo/redo retains the original rig and clip identities. The inspector exposes
follow target/keep-pose and four strengths, with space/offset/order in Advanced.
Hierarchy entries expose the resulting follows. Character, scene, onion-skin and
runtime consumers use the shared stage.

Final numeric review reproduced Float32 overflow for large finite IK/follow
inputs. The shared stage now restores the controlled locals and preceding world
matrices if a solve overflows; per-skeleton matrix backup is allocated only on
creation/structural publication. Numerical regressions cover both solver types.
The optional Spine adapter rejects native follow and pole/soft-reach semantics
rather than silently dropping or translating different behavior. Native source
retains these fields; the independent shipping compiler remains Phase 9.

Added a real-editor saved schema-7 follow/IK fixture with a reflected parent,
markers and target offset. Runtime tests key its target and assert half-strength
world movement. Historical fixture bytes remain unchanged; header expectations
and generated projects now use the authoritative current schema constant, fixing
three old browser assumptions that compared migrated source against header 6.

All 405 unit tests, lint/boundaries, formatting, TypeScript and package/editor
builds passed. The complete nineteen-suite browser regression passed on the
final source, including affine follow, independent mixes, offsets/local space,
mixed reordering, exact history, Setup isolation, compatibility-export failure
and native Save/Open. Scene/RTL raster tolerances are unchanged. Standard/Heavy
CPU update/render-submit p95 was 1.40/2.50ms; weighted transform counts remained
10000/40004. Heavy worker publication was 40.5ms. SwiftShader frame gaps remain
separate from CPU cost and do not certify hardware GPU 60fps. Commit `6d664f5`
passed remote CI 38003638170: Test & Build, Docker, VPS and GitHub Pages succeeded.

Phase 7 still needs path constraints, fixed-step secondary motion and the combined
acceptance gate. Sol 6.1 / High remains suitable for the path constraint increment.
No unresolved product decision currently prevents continuing the roadmap.

## 10 October 2026 Phase 7D native spline follow and progression keys

Source schema 8 adds continuous cubic paths, independent owner bones and direct
chain constraints. The solver measures spacing in world arc units and compensates
reflected/sheared parents and each bone's signed/sheared +X basis when following
the tangent. Translation/rotation strengths are separate; authored length, scale
and shear remain unchanged. Open distances clamp and closed distances wrap. Zero
mixes, collapsed paths and singular required parents have defined holding behavior.
IK, transform and path share identity/order/dependency validation; finite-output
rollback now preserves every controlled chain local, using per-instance buffers.

ADR 0021 specifies bounded caches, 128 intervals per segment and the approximate
chord metric. Position/tangent evaluate the actual cubic. The saved straight-path
fixture exposed a 0.00034-unit interpolation error; six bounded Newton refinements
now remove that parameterization error without weakening the numeric fixture test.
The curved length golden is compared with 20000 independent integration intervals
(less than 0.006-unit length difference on its 200-unit curve). Arc parameterization
remains explicitly approximate, not an exact integral claim.

The Setup inspector creates/reuses curves and chooses a chain end, edits cubic
coordinates, maintains shared endpoints atomically, extends/removes segments and
closes/opens paths. The viewport draws the evaluated curve. Progress has an ordinary
bone controller whose X represents percentage points; an explicit Animate button
keys it through the existing animation command. Advanced exposes rotation offset
and shared constraint order. Native Save/Open retains controls, curves and tracks;
the optional compatibility exporter rejects paths. Numeric curve controls are
implemented; direct viewport Bezier handle dragging is a later UX improvement.

The real-editor schema-8 fixture contains a two-bone path, keyed progress, markers
and independent IK. Tests cover 100 seeded affine hierarchies, joined/closed paths,
world metric changes, runtime parity, exact history, Setup isolation and atomic
invalid edits/imports. All 424 unit tests in 58 files, lint/boundaries, formatting,
TypeScript and package/editor builds passed on the final code. The fresh complete
twenty-suite browser run passed after the sampling precision fix. Standard/Heavy
CPU update/render-submit p95 was 1.40/2.60ms; weighted transform counts remained
10000/40004. Heavy worker publication was 40.7ms. SwiftShader frame gaps (21.2/55.5ms
p95) remain software-graphics evidence, not hardware GPU 60fps certification. Remote
CI 38005823707 passed for commit `7e1782b`: Test & Build, Docker, VPS and GitHub Pages.
The overall Phase 7 gate remains open until secondary motion and combined acceptance.

Phase 7 still needs specified fixed-step secondary motion and the combined gate.
The next increment first proves the portable spring/clock contract before adding
source fields or changing playback. Sol 6.1 / High remains suitable; no unresolved
user decision blocks this work. Phases 8–12 remain outstanding and Phase 13 remains
conditional on validation.

## 10 October 2026 Phase 7E1 portable secondary-motion foundations

Specified the fixed-step angular spring/inertia contract in ADR 0022 before changing
playback. The implemented portable kernel uses the exact constant-target damped
oscillator solution for under/critical/overdamping, with a stable critical limit and
small-argument sinc expansion. It validates inputs/result before mutating reusable
state; equilibrium and zero steps preserve exact values. The 120Hz accumulator
retains fractional time, caps accepted delta at 100ms/12 steps and exposes dropped
stall seconds. Nonfinite/negative deltas contribute no time. Neither utility allocates
per step, owns renderer APIs or changes saved source schema 8.

Eleven new tests use independent analytical/exponential-root goldens, fine RK4
integration, constant-target subdivision around critical damping and frequency
extremes, undamped energy conservation, settling and atomic rejection. Clock coverage
compares 10/60/120/144/240/1000 display subdivisions, fractional/stall/reset semantics
and ten thousand nonintegral frames. All 435 tests in 59 files, lint/boundaries,
formatting, TypeScript and package/editor builds passed. The unchanged authoring
workflow already passed all twenty browser suites in the preceding path increment.
Remote CI 38006511542 passed for commit `ccdc5ee`: Test & Build, Docker, VPS and GitHub
Pages. This kernel milestone is not a completed secondary motion feature or Phase 7 gate.

Next: source secondary constraints, sampled fixed-step playback in editor/runtime,
semantic presets/Advanced controls, reset/scrub/events, native/history/browser parity
and a combined profiled constraint fixture. Sol 6.1 / High remains suitable. The
overall roadmap remains active through Phase 12; commercial Phase 13 is conditional.

## 10 October 2026 Phase 7E2 secondary-motion playback and combined acceptance

Source schema 9 adds explicit Soft/Bouncy/Firm angular springs with strength, maximum
sway and Advanced coefficients/order. Atomic Setup commands create/edit/remove springs,
insert primary constraints before the secondary stage and enforce ancestor-first order.
Native history/Save/Open retains exact source; deleting a bone cleans its spring. The
optional compatibility export reports unsupported native secondary motion.

Editor/runtime evaluate authored targets at each 120Hz step before applying springs.
All headings snapshot before writes and affine inversion accounts for reflected/sheared
bases. Pivot/scale/shear/length stay authored. Singular/collapsed bases hold; Float32
overflow restores the whole secondary output and rebases. Pause/scrub/stop, clip/queue
change, publication and explicit runtime reset rebase without lag. Events accumulate
over accepted steps only. Compensated animation time fixes exact loop-boundary events;
frozen outgoing clips no longer repeat their last event during a fade.

Numerical tests cover independent critical-angle goldens, 80 seeded affine cases,
parent/child targets, bounds/degeneracies/overflow, 10/60/120/144/240/1000 display-frame
subdivision, queue/fade/event semantics and atomic source/order validation. The real
editor-saved schema-9 fixture is committed. Browser authoring/playback/history/import
checks passed, as did the profiled combined IK/follow/closed-path/spring fixtures.
Standard/Heavy CPU p95 was 1.90/5.50ms with 12/22 springs and 10000/40004 weighted
transforms; exact runtime matrix/vertex parity and source preservation passed. Actual
frame gaps remain separate from CPU and do not establish hardware GPU 60fps.

All 453 unit tests in 62 files, lint/boundaries, formatting, TypeScript and both
package/editor builds passed. The fresh complete twenty-two-suite browser regression
passed on the final code, with unchanged scene/RTL raster tolerances. Remote CI follows
commit/push; Phase 7 is not marked complete before its remote gate passes.
Next phase is typed Logic/state-machine semantics, then runtime/compiler/platform
work through Phase 12. Sol 6.1 / High remains suitable; no unresolved user decision
currently blocks the roadmap.

## 10 October 2026 Phase 7 complete

Commit `17b4557` passed [CI 38008404463](https://github.com/MikhaelBA/limber/actions/runs/38008404463):
Test & Build, Docker image, VPS and GitHub Pages all succeeded. The clean Linux gate
passed all 453 unit tests and all twenty-two browser workflows. Combined Standard/Heavy
core p95 was 1.10/5.40ms and total CPU update/render-submit p95 was 2.60/7.20ms, below
the 16.7ms budget. Actual software-graphics frame-gap p95 was 35.40/102.80ms and remains
explicitly separate from hardware GPU performance claims. Scene/RTL golden tolerances
were unchanged. IK/follow/path/spring ordering, saved source and weighted output passed.

This closes Character Alpha's implemented acceptance gate. Direct Bezier handle dragging
is a later UX improvement; numeric curve authoring is delivered. Hardware/GPU profiling
remains a platform/release task. Next is Phase 8A: specify/test the portable typed parameter
and state-machine kernel before source/UI integration. Sol 6.1 / High remains suitable.
Phases 8–12 remain outstanding; Phase 13 commercial services remain conditional.

## 10 October 2026 Phase 8A deterministic Logic foundations

ADR 0023 specifies graph ownership, transition priority, trigger consumption,
exit/blend/interruption, input/event ordering, one-way binding, interaction and
disabled-logic semantics before source/UI integration. The implemented portable
kernel validates typed parameters and bounded graphs without mutating source,
clones/bakes runtime data, queues validated input for accepted 120Hz ticks and
canonicalizes float conditions/values to Float32 for native/Web parity. Triggers
latch; only winning fired guards consume them. One transition can execute per tick;
Any State competes globally, self targets are skipped and unconditional immediate
cycles produce actionable diagnostics. Active blends defer transitions or permit
strictly higher-priority interruption. Snapshots/debug metadata are isolated copies.

Eleven targeted tests passed, including independent state-trace goldens, exact recorded
input replay under 10/60/120/144/240/1000Hz grouping, trigger AND/priority/failed guards,
exit/loop boundaries, interruption, wrong-type/range rejection, reset/disablement,
bounded pending inputs/debug history, all typed comparisons, malformed graphs and source
preservation. All 464 unit tests in 63 files, lint/boundaries, formatting, TypeScript
and package/editor builds passed; the final kernel/test changes passed lint, all unit
tests and package rebuild again. Editor output remains identical because this kernel
has no preview adapter yet. The unchanged workflows passed all twenty-two browser
suites in the preceding source milestone and docs CI 38008956634 also passed all jobs.
Commit `d685867` passed CI 38009569773: Test & Build (including all twenty-two browser
suites), Docker, VPS and GitHub Pages succeeded.

This is a partial Phase 8 increment: source remains schema 9 and existing player/editor
behavior is unchanged. Native ownership/commands, actual scene/rig pose blending,
typed events, bindings, graph editing and interaction/debug preview remain required.
The project goal remains active through Phase 12. Sol 6.1 / High remains suitable
for the next source/authoring increment; no unresolved user decision blocks progress.

## 10 October 2026 Phase 8B native graphs and atomic authoring

Source schema 10 adds optional artboard/rig Logic graphs with independent clip
catalogs and owner-scoped identities/references. Graph-only copy-on-write commands
create/remove graphs and edit typed parameters, states, transitions and settings.
They validate before publishing and preserve existing rig/clip payload identities.
Parameter deletion removes dependent edges completely; state deletion removes
incident edges and repairs entry to the first remaining state. Stable identities
cannot be replaced by patch fields, and the last state cannot be removed.

Rig animation rename rewrites state clip references in the same atomic edit;
duplicate clip names/nonfinite durations fail before mutation. Deleting a referenced
scene/rig clip is rejected until unlinked. Unsupported node/component owners and
malformed graphs fail load before replacement. Spine project export explicitly
rejects active-owner graphs instead of discarding behavior through its rig adapter.

The actual editor-saved schema-10 fixture contains scene Reveal and character graphs,
typed trigger/bool/string parameters and Any State. Browser Save/Open, typed/clip/entry
rejection and both compatibility-export paths passed. Eight new native/command tests
cover exact history, invalid-edit redo retention, graph removal/raw asset preservation,
owner-scoped duplicate rigs, clip rename/delete safeguards and failed import isolation.
All 472 unit tests in 65 files, lint/boundaries, formatting, TypeScript and package/editor
builds passed. The fresh complete twenty-three-suite browser regression passed with
unchanged scene/RTL raster tolerances. Standard/Heavy combined CPU p95 was 1.80/5.30ms,
with 10000/40004 weighted transforms and exact source preservation. Mesh worker Heavy
publication was 36.5ms. Software-graphics cadence remains separate from hardware GPU
60fps claims. Commit `f3e17b0` passed CI 38010700346: Test & Build (including all
twenty-three browser suites), Docker, VPS and GitHub Pages all succeeded.

Phase 8 remains partial: Logic pose playback, blend/typed events, bindings, graph UI,
pointer/focus/test interaction and debug preview are outstanding. Native graph storage
does not execute behavior in the legacy player/editor pipeline. Next is the portable
scene/rig pose adapter increment; Sol 6.1 / High remains suitable. No user decision
currently blocks progress toward Phases 8–12.

## 10 October 2026 Phase 8C1 portable Logic posing

SceneLogicPlayer and RigLogicPlayer share fixed-step/input/event lifecycle without
renderer dependencies and are exposed through core and @limber/runtime. Fully
setup-resolved animation/view channels blend once from a held pre-constraint pose;
interruption snapshots the current blend. Rotation follows the shortest arc;
attachment/draw order choose destination immediately. FK/primary constraints and
secondary motion run per accepted tick, with skinning once per displayed update.
Skin selection is transient and preserves source, including injected editor Skeletons.
In-place structural publication rejects stale pose buffers before further posing.

Pause drops fractional time/rebases inertia. Disable shows setup and freezes inputs,
state and the outgoing blend; enabling restores the same held blend. Reset clears
parameters/state/input/events/debug while retaining pause status. Event samplers bake
chronological keys with authored ties and old-loop-end before new-loop-zero ordering.
Entry-zero emits only on the first accepted tick, held/stall time emits none, and
callback inputs commit next tick. Reset/pause/disable callbacks stop stale delivery;
recursive update rejects. Relative seam handling preserves tiny positive keys and
the .3/.1 binary boundary. Limits are 512 keys/clip and 1000 cycles/fixed step.

Twenty new tests cover independent scene/rig blend/interruption/deform/vertex goldens,
critical spring response, discrete output, transient skins, in-place publication,
reset/disable/pause, event callback mutation and bounded/invalid input. Standard/Heavy
combined IK/follow/path/spring fixtures require exact full world matrices, weighted
vertices and Deform across 10/60/120/144/240/1000Hz grouping with accepted-tick input.
The actual saved native fixture also replays exactly in core and Chromium without
source mutation. The combined numerical replay test has a 15-second wall-clock limit
to accommodate parallel test load; this does not change CPU performance budgets.
All 492 unit tests in 68 files, lint/boundaries, formatting, TypeScript and package/
editor builds passed. The new targeted browser playback suite and fresh complete
twenty-four-suite browser regression passed with unchanged scene/RTL golden
tolerances. Standard/Heavy combined CPU p95 was 2.20/5.80ms, with 10000/40004
weighted transforms and exact source preservation. Software-graphics frame-gap
p95 was 24.40/58.30ms, separate from hardware GPU 60fps claims. Commit `06190d6`
passed CI 38012611665: Test & Build (all twenty-four browser suites), Docker, VPS
and GitHub Pages all succeeded.

Phase 8 remains partial. The editor does not yet execute graphs through these adapters;
typed payload strengthening/event UI, one-way bindings, graph editing, interaction and
debug preview remain. Source stays schema 10 and legacy queue/mixer behavior stays as
before. Next is the event payload/authoring increment, with Sol 6.1 / High suitable.

## 10 October 2026 Phase 8C2 typed event data and authoring

Source schema 11 adds explicit bool/float/int/string event payload records alongside
valid scalar payloads. Unknown fields, nested objects, type coercion, nonfinite/
Float32-range invalid floats, non-int32 integers and oversized strings reject before
publication. All scene/rig clips validate event data, including dormant clips. Graph
eventful loops also validate bounded cycle work before native load/authoring. Source
keeps authored float precision; Logic, SceneClock and raw RuntimePlayer copy emitted
records and canonicalize typed floats to binary32. Compatibility export explicitly
rejects typed payloads instead of losing their meaning.

Both timelines have an event payload dialog with explicit type/value controls and
editable Footstep/AttackHit/SpawnProjectile/SFX/Haptic/UIConfirm starting templates.
Invalid drafts disable keying and commands validate again. Rig key commands capture
time and payload, deep-copy event history, and undo restores the preceding clip length.
The native dialog prevents clipping inside resizable timeline panels. Global shortcuts
remain available on event buttons; editable fields/open dialogs isolate keyboard input.
No audio, haptic or game action executes automatically; games consume generic events.

Ten new tests cover payload types/ranges, authored/runtime Float32 distinction, emission
isolation, scene/rig/raw payload parity, dormant-source validation, cycle/count limits,
compatibility rejection and exact scene/rig history. The actual editor-saved schema-11
fixture contains AttackHit int, UIConfirm bool and a custom Persian/emoji string cue;
core replay verifies entry payloads and source preservation. The targeted browser suite
passed templates/custom values, invalid drafts/import, exact Undo/Redo/Save/Open and
both compatibility exports. Character/scene dialog screenshots were visually verified.
All 502 unit tests in 70 files, lint/boundaries, formatting, TypeScript and package/
editor builds passed. The complete fresh twenty-five-suite browser regression passed
after correcting a real event-button keyboard propagation regression found by smoke.
Scene/RTL golden tolerances were unchanged. Standard/Heavy combined CPU p95 was
1.90/5.50ms, with 10000/40004 weighted transforms; software frame-gap p95 was
21.50/56.90ms, separate from hardware GPU claims. Commit `773caf8` passed CI
38014120401: Test & Build, Docker, VPS and GitHub Pages all succeeded.

Phase 8 remains partial: one-way exposed-property/direct-text bindings, graph editing,
pointer/focus/test inputs, debug preview and the final integrated gate remain. The
portable graph adapters are not yet connected to editor Logic preview. The next
binding increment is suitable for Sol 6.1 / High; no user decision currently blocks it.

## 10 October 2026 Phase 8D one-way scene bindings

Schema 12 stores optional explicit graph bindings to instance exposures: text/string,
visible/bool, opacity/float and tint/int. SceneLogicPlayer bakes/clones definitions and
applies bindings after animation, before expansion/layout. Direct artboard text names
resolve same-graph string parameters. Projection never writes source, definitions,
stored overrides or history. Opacity [0,1] and tint [0,0xffffff] validate before enqueue;
unknown targets/types, duplicate writers, extra fields and incompatible initial values
reject even for disabled graphs. Disable restores authored setup while retaining state
and pending input. Rig graphs cannot own scene exposure bindings; artboard graphs can
bind exposed properties of rig component instances.

Commands add/edit/remove bindings. Parameter rename/delete migrates or removes direct
text references and dependent bindings; scene duplicate/delete preserves binding
references with stable new IDs. Destructive exposure retargeting and extraction of
bound content require explicit migration. Metadata publication preflights all text
targets before any write. Failed edits preserve redo and existing payload identities.
Eleven new unit tests cover all projection types, domain boundaries, source isolation,
disabled/pending/reset behavior, definitions, reference failures and exact history.
All 513 unit tests in 72 files, lint/boundaries, formatting, TypeScript and package/editor
builds passed. Targeted Chromium tests passed native Save/Open, RTL bound views across
10/60/120/144/240/1000Hz and failed-import isolation. The actual editor-saved schema-12
fixture is retained and its authored RTL screenshot was visually checked. The complete
fresh twenty-six-suite browser regression passed, keeping Scene/RTL golden tolerances
unchanged. Standard/Heavy combined CPU p95 was 1.80/5.20ms with 10000/40004 weighted
transforms and exact source preservation. Software frame-gap p95 was 21.70/57.10ms,
separate from hardware GPU claims. Commit `0251d1b` passed CI 38015600435:
Test & Build, Docker, VPS and GitHub Pages all succeeded.

Phase 8 remains partial. Next: portable pointer/focus/test routing, graph authoring UI,
scene/character preview/debug integration and the final interactive gate. Sol 6.1 / High
remains appropriate; no user decision currently blocks progress.

## 10 October 2026 Phase 8E1 portable interaction routing

Schema 13 adds optional graph routes for pointerDown/Up/Enter/Leave, click, focus,
blur and test. Routes reference stable parameter IDs and owner-scoped scene targets
or the viewport (null); rig graphs accept only viewport targets. Typed writes match
their parameter and every bound property domain; trigger routes omit value and fire.
Matching routes dispatch in authored order as a single batch. All values and combined
1024-input queue capacity validate before any enqueue. Disabled/native graphs also
validate targets. Source, raw clips and stored overrides stay unchanged.

Players expose the same DOM-free dispatch API through core/runtime. Paused/disabled
inputs are retained, callbacks enqueue at the next tick, and reset clears pending
input plus trace. Receipt copies record accepted tick/sequence, event, target, route
IDs and authored input values; history is bounded to 256 receipts and 1024 total
writes. Commands add/edit/remove routes and preserve parameter rename/delete and
scene duplicate/delete references with exact history. Routed-content extraction
requires explicit migration instead of changing interaction meaning silently.

Eleven new tests cover typed order, triggers, queue-prefix isolation, invalid batches,
trace isolation/bounds, paused/disabled/reset behavior, exact native/reference/history
transactions and callback-driven replay across six frame groupings. All 524 tests in
74 files, lint/boundaries, formatting, TypeScript and builds passed. Targeted Chromium
passed all signals, scene/rig pose and receipt parity, exact Save/Open and malformed
target/domain/trigger import isolation. Its actual saved schema-13 fixture is retained.
The complete fresh twenty-seven-suite browser regression passed, retaining Scene/RTL
golden tolerances. Standard/Heavy combined CPU p95 was 1.80/5.30ms with 10000/40004
weighted transforms and exact source preservation. Software frame-gap p95 was
21.80/58.60ms, separate from hardware GPU claims. Commit `2a0f9dd` passed CI
38016440963: Test & Build, Docker, VPS and GitHub Pages all succeeded.

Phase 8 remains partial. Visual graph authoring, pointer/focus preview delivery,
debug overlay and the final integrated gate remain. The next UI/session/renderer
increment is suitable for Sol 6.1 / High, with no material user question outstanding.

## 10 October 2026 Phase 8E2 editor Logic authoring and preview

The resizable Logic workspace edits parameters, states/clips, transitions/guards,
bindings and interaction routes through atomic native commands. State drags publish
once with Escape/pointer-cancel isolation. Owner changes and source history create
fresh paused preview sessions; test inputs, enablement, traces and events are transient.
Scene graphs run alongside independent rig graphs. Pointer/focus and keyboard inputs
share portable dispatch; debug state/blends, receipts and typed events remain visible.

The Pixi adapter consumes cloned bound views and posed skeletons, caching hidden
displays, text rasters and slot geometry. Read-only evidence verifies actual rendered
text and mesh/world buffers without frame-copy overhead. Raw animation shortcuts are
isolated from Logic. Review found that the old Step path rebased secondary motion after
every tick; the new paused core Step preserves inertia and matches the independently
predicted critical spring response plus uninterrupted accepted-tick poses. Lifecycle
tests cover disabled pending input, events, callback reset and reentrancy.

All 528 tests in 75 files, lint/boundaries, formatting, TypeScript and package/editor
builds passed. Targeted Chromium previously passed the complete authoring/interaction
workflow, actual cached rendering, exact history/native Save/Open and raw-source
preservation. The actual saved schema-13 interactive fixture is retained. The complete
fresh twenty-eight-suite browser regression passed after the Step correction, retaining
Scene/RTL golden tolerances. Standard/Heavy combined CPU p95 was 1.80/5.20ms, with
10000/40004 weighted transforms and exact source preservation. Software frame-gap p95
was 22.00/56.60ms, separate from hardware GPU claims. Commit `a33f58e` passed
CI 38018547572: Test & Build, Docker, VPS and GitHub Pages all succeeded.

Phase 8 remains partial until its final Standard/Heavy Logic-renderer parity and
performance gate plus remote CI pass. Sol 6.1 / High remains suitable; no material
user question currently blocks that verification.

## 10 October 2026 Phase 8F integrated renderer gate

The Standard/Heavy Logic workflow compares actual displayed world matrices and mesh
buffers against twelve paused Steps and continuous accepted ticks. It retains all
IK/follow/path/spring stages, weights, Deform and clipping, verifies stable geometry/
scene caches, disabled authored setup and exact source Save. Bounded on-demand profiling
records CPU update/render-submit time and accepted ticks; graphics cadence is reported
separately. The heavy fixture now cuts the mesh halfway to test actual visible pixels.

Pixel tests found and fixed a Logic stencil bug that hid the whole clipped mesh:
stencil graphics remain renderable and are excluded only from ordinary color passes.
Stable mask assignments avoid removing/reinstalling effects every frame. Separate
pixel goldens cover independent clip regions, exclusive end slots and unused clips.
Review also found native RGBA misinterpretation in both display adapters and the
Character color picker. RGB/alpha now follow 0xRRGGBBAA, and authoring preserves unsigned
values and exact history. The raw Character path uses independent cached clip masks
and posed draw order, fixing overwritten clip shapes and animated scope errors.

Targeted Chromium passed actual pixel/color/alpha, independent masks, animated draw
order, color-picker Undo/Redo/native history and Logic/source isolation. Screenshots
were visually checked. The complete fresh thirty-suite browser regression passed,
retaining Scene/RTL golden tolerances. Logic Standard/Heavy CPU p95 was 1.20/4.10ms;
software frame-gap p95 was 16.70/33.40ms. Raw combined CPU p95 was 1.80/5.10ms,
with 10000/40004 weighted transforms and 21.30/55.60ms software frame-gap p95.
These measurements do not certify hardware GPU 60fps.

The first concurrent local unit/browser run hit the existing five-second wall timeout
in the Heavy combined numeric fixture. Standalone replay passed both fixtures in
1.70s. That integration test now uses the same fifteen-second wall allowance as the
combined Logic replay, preserving every numeric/source assertion; the separate 16.7ms
CPU performance gate is unchanged. The final full local check passed all 528 tests
in 75 files, lint/boundaries, formatting, TypeScript and package/editor builds.
Commit `8070c52` passed CI 38034780726: Test & Build, Docker, VPS and GitHub Pages all
succeeded. Linux Logic CPU p95 was 2.60/8.30ms and software frame-gap p95 was
50.00/66.80ms; raw combined CPU p95 was 2.80/8.30ms, with 42.50/124.50ms software
frame-gap p95. Both CPU gates passed without changing numeric/Scene/RTL tolerances.

Phase 8 Interactive Alpha is complete. The next phase defines the independent .bbb
schema/compiler before Web runtime, atlas workers, Ship Doctor/profiler and engine
integrations. The user's pre-release policy removes new backward-reader obligations.
Sol 6.1 / High remains suitable and no material user question blocks the next increment.

## 10 October 2026 Phase 9A native runtime schema/compiler

ADR 0024 separates the shipping `bonebybone-runtime` v1 schema from editable source.
The portable pure compiler whitelists nested fields, removes editor selection, scene
selection identities/FPS, graph positions and component revisions, preserves playback/
UI/Logic semantics and ships referenced raster assets in independent image records.
Linked meshes retain one geometry owner. Runtime entry selection is explicit or follows
authored artboard order. Public names/IDs remain stable; output is deterministic.

Debug JSON and compact UTF-8 `.bbb` use the same header/schema. Strict ingestion rejects
unknown fields/versions/types, malformed UTF-8/JSON/scalars, false feature manifests,
missing pixels, broken references, invalid draw order/RGBA and weight index ordering.
Canonical base64 and MIME signatures are checked without recursive regex exhaustion;
full image decoding still belongs to the asset worker/renderer. Failures have coded,
object-linked explanations and remedies before any program is returned. The private
sampling adapter creates collision-free ephemeral metadata without serializing it.

Thirty new tests verify the independent stored `.bbb` fixture, compact/debug loading,
determinism, metadata removal, mutable isolation, exact source preservation, scene/rig
matrix and vertex parity, 240-tick Logic/binding/route/event parity, asset requirements
and malformed-input rejection. Thirteen raster/native corpus projects compile, including
the layered Fox sample. Two SVG source fixtures correctly receive conversion diagnostics
until real worker rasterization exists; no replacement artwork was used as evidence.
Text reports explicit external-font warnings until the asset stage packages those fonts.

All 558 tests in 76 files passed locally with lint/architecture boundaries, formatting,
TypeScript and package/editor builds. Phase 9 remains in progress: the native artboard
player, shared Web renderer, atlas/image/font workers, Ship Doctor/profiler and actual
export/load/play acceptance gate are outstanding. Commit `1237325` passed CI 38037236932:
Test & Build (including all thirty browser suites), Docker, VPS and GitHub Pages succeeded.
The next portable playback task is suitable for Sol 6.1 / High; no model change or material
user decision is required.

## 10 October 2026 Phase 9B1 native character playback

`NativeRigPlayer` validates the compiled program before creating detached character
state, starts paused and supports authored Logic or explicit raw clips. Its raw path
uses 120 Hz integer accepted ticks, held pre-constraint crossfades, shortest-arc rotation,
continuous RGBA/Deform and immediate destination attachment/draw order. Interrupted
fades hold the actual blended pose. Independent scalar and half-follow goldens prove
that outgoing setup attenuation and a second constraint application do not occur.

The bounded FIFO preserves terminal/entry events and full post-completion delay. A
queued loop holds its endpoint without emitting a discarded next-cycle zero; ordinary
loops preserve end-before-zero ordering. Zero-duration static clips emit entry once.
Play/queue options validate before mutation, repeated resume preserves fractions and
paused Step preserves spring inertia. Native loop event work and safe duration/Bezier
limits are checked before starting or publishing potentially unsafe data.

Skin/attachment overrides, raw/Logic switching, Stop/reset, typed setters/triggers and
viewport routing remain transient. Marker/socket matrices compose an optional rig world
transform. Callback copies are isolated, stale/reentrant delivery is blocked, and a
throwing host callback leaves its accepted pose skinned and the session usable. Review
also caught and fixed stale Stop state after starting a previously empty queue.

Twenty-two new tests cover numeric fade/interruption/constraint/color/Deform goldens,
FIFO and loop timing, typed event canonicalization, lifecycle/fraction/source isolation,
all parameter types, callback failures and exact native/source Logic parity. Standard/
Heavy compiled characters retain every solver stage and match continuous/paused-Step
matrices and vertices plus the unblended source player. The complete local check passed
all 580 tests in 77 files, lint/boundaries, formatting, TypeScript and package/editor
builds. Remote CI remains pending for this increment.

The next task is native artboard orchestration and expanded UI with a shared raw track
clock; Web rendering/asset workers and Ship Doctor remain separate gates. Phase 9 is
still in progress. Sol 6.1 / High remains suitable; no model switch or user decision is
required for the next task.
