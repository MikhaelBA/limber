# Compatibility and performance fixtures

Backward file compatibility is not a release gate for this pre-release project, per the user's 9 October 2026 instruction. Existing historical fixtures may remain as regression inputs; prioritize new numeric and behavioral contracts.

Committed legacy documents are immutable compatibility inputs. Copy a new fixture for a new schema;
never regenerate an old one to hide a migration failure. Runtime numeric comparisons use an absolute
tolerance of 1e-4 unless a test documents a stricter requirement.

Randomized tests must use the seeded generator in `packages/core/tests/fixtures.ts` and print the seed
when failing. Seed 0xbbb001 is the default. Planned benchmark sizes follow PRODUCT_SPEC section 10.8:
25/60/120 bones, 500/2500/10000 weighted vertices, plus UI and crowd fixtures once their model exists.

`bbbproj-v1-demo.json`, `bbbproj-v2-motion.json` and `bbbproj-v3-reward.json` are immutable native source fixtures. The schema-3 reward popup includes responsive layout, exact nine-slice metadata, Persian text and a component instance. Layout tests evaluate the same popup against phone portrait/landscape, tablet and desktop presets. Source-format coverage alone does not establish renderer or native-engine text parity.

`ui-rtl-v1.png` (Windows) and `ui-rtl-linux-v1.png` (Linux) are reviewed mixed Persian/numeric/Latin rasters with the same bundled Noto Sans Arabic file and Chromium version. The native font backends produce different advances: 258.71991px on Windows and 257px on Linux. Both show the same correct bidi ordering/shaping; platform rasters avoid treating native hinting/advance rounding as an authoring regression. The suite verifies the loaded family, measured advance and alpha differences above 16/255 on fewer than 1.5% of pixels. The original tolerance is unchanged. Other browser-test platforms require a reviewed reference before enabling them. Regenerate only for an intentional text-rendering change with `UPDATE_UI_GOLDEN=1 node packages/editor/tests/scene-ui.mjs`, then inspect it. CI never regenerates the golden. The same suite samples nine-slice corners at four aspect ratios and verifies nested masks and component propagation.

`scene-standard-v1.json` and `scene-standard-v1.png` are the Phase 2 100-image scene and reviewed viewport crop. The browser test compares RGB pixels with a 12-level channel tolerance and less than 1.5% changed pixels to allow platform edge rasterization. Dynamic controls/timing text are outside the crop. Update the PNG only for an intentional visual change with `UPDATE_SCENE_GOLDEN=1 node packages/editor/tests/scene-interaction.mjs`, then inspect the image and review the diff. CI never regenerates this fixture. The same test enforces a 16.7ms CPU update/render-submit p95 across 120 drag updates; this does not measure GPU completion or animated rig evaluation.

`bbbproj-v4-markers.json` is an immutable native source fixture with a two-bone wave animation, a hand socket and a rectangular body hurtbox. The rig browser suite verifies marker authoring, failed-edit isolation, exact history/save/reopen and deterministic sampled socket positions without mutating the fixture or setup pose.

`bbbproj-v5-bind-mesh.json` is the native bind-pose reference: a quad at [-50,80] through [50,240] has full influence on a bone whose setup X is 120, with frozen bind translation -120. The initial world quad equals the authored quad; at t=0.5 the bone's X=150 moves every vertex +30. Runtime numeric tests compare the full eight-coordinate arrays. The browser suite verifies binding selection, exact history/save/reopen, half-time sampling and cursor/deform alignment.

`bbbproj-v6-shared-mesh.json` contains one owned quad and an instance sharing its geometry. The
owner follows the moving tip through its frozen Bind; the instance follows root with its own weights
and a vertical Deform. At t=0.5 their complete world-coordinate arrays differ by the expected +30 X
and +10 Y. Tests verify one serialized geometry, independent pose caches and full numeric output.

`mesh-standard-v1.json` and `mesh-heavy-v1.json` are immutable fixture profiles generated into
native projects by `playbackFixture` in `tools/mesh-fixtures.mjs`. Standard has 60 bones, 2500
four-influence vertices, 5 active IK constraints and 10 clips. Heavy has 120 bones, 10000 four-
influence vertices, 10 constraints/clips, clipping and complete Deform arrays. They are distinct from
the geometry-only worker race fixtures. `mesh-performance.mjs` records 180 steady-state frames,
actual influence-transform counts, CPU render submission, real frame gaps and the graphics driver;
see docs/performance/phase6-mesh.md for scope and limits. Native project generation uses no artwork
or randomness.

`bbbproj-v7-transform-follow.json` is the real editor's schema-7 Save/Open result with a reflected
parent, four independent follow mixes, a composed target offset, markers and independent IK in
one order namespace. Runtime tests add a target X track and assert the half-strength world motion;
the browser suite verifies creation without a setup jump, offsets/local space, mixed reordering,
exact history and failed-import isolation. Historical schema fixtures remain unchanged.
