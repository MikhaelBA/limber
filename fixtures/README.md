# Compatibility and performance fixtures

Committed legacy documents are immutable compatibility inputs. Copy a new fixture for a new schema;
never regenerate an old one to hide a migration failure. Runtime numeric comparisons use an absolute
tolerance of 1e-4 unless a test documents a stricter requirement.

Randomized tests must use the seeded generator in `packages/core/tests/fixtures.ts` and print the seed
when failing. Seed 0xbbb001 is the default. Planned benchmark sizes follow PRODUCT_SPEC section 10.8:
25/60/120 bones, 500/2500/10000 weighted vertices, plus UI and crowd fixtures once their model exists.
