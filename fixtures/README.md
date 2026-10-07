# Compatibility and performance fixtures

Committed legacy documents are immutable compatibility inputs. Copy a new fixture for a new schema;
never regenerate an old one to hide a migration failure. Runtime numeric comparisons use an absolute
tolerance of 1e-4 unless a test documents a stricter requirement.

Randomized tests must use the seeded generator in `packages/core/tests/fixtures.ts` and print the seed
when failing. Seed 0xbbb001 is the default. Planned benchmark sizes follow PRODUCT_SPEC section 10.8:
25/60/120 bones, 500/2500/10000 weighted vertices, plus UI and crowd fixtures once their model exists.

`scene-standard-v1.json` and `scene-standard-v1.png` are the Phase 2 100-image scene and reviewed viewport crop. The browser test compares RGB pixels with a 12-level channel tolerance and less than 1.5% changed pixels to allow platform edge rasterization. Dynamic controls/timing text are outside the crop. Update the PNG only for an intentional visual change with `UPDATE_SCENE_GOLDEN=1 node packages/editor/tests/scene-interaction.mjs`, then inspect the image and review the diff. CI never regenerates this fixture. The same test enforces a 16.7ms CPU update/render-submit p95 across 120 drag updates; this does not measure GPU completion or animated rig evaluation.
