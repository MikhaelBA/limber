# Portable atlas kernels

`@limber/atlas` contains no browser, renderer or editor dependencies. An asset worker
decodes artwork to straight RGBA8, calls `prepareAtlasImage`, `packAtlasRegions`, then
`compositeAtlasPages`, and encodes the resulting pages. These kernels do not decode
SVG, package fonts, write a native manifest or publish resources.

MaxRects best-short-side layout has deterministic UTF-16 identity tie-breaking,
multiple pages, optional clockwise rotation, padding and power-of-two dimensions.
Power-of-two caps round down before packing; resulting pages cannot exceed host caps.
Region, dimension, page, pixel and rectangle-search budgets report coded `AtlasError`
diagnostics with an object ID and remedy. No caller input is mutated.

Trim preserves original logical dimensions and records the source-pixel crop. Any
nonzero alpha is content. Completely transparent trimmed images use a transparent
placeholder crop. Consumers that rely on the full UV domain (rig regions/meshes and
nine-slice) must pass `trim: false` on that image; this overrides global trim. Scale
uses ceil dimensions. Bilinear resize interpolates premultiplied intermediates and
returns straight RGBA8, avoiding fringes from invisible RGB. No alpha threshold,
lossy encode or irreversible source-image edit is performed.
Optional `trimMargin` expands the content crop within original bounds. Native sprite
export retains at least one output texel's transparent filter footprint; an exact
alpha box would otherwise cut off visible bilinear fringes at the cropped quad edge.

Composition checks every page, placement and extruded gutter for bounds and overlap
before allocating page buffers. Clockwise rotation is exact, and edge/corner extrusion
covers the complete padding area. Unused pixels remain transparent. Output declares
`premultiplied: false`; upload adapters may premultiply once. Optional shared counters
measure fit/prune comparisons and actual scanned/resized/composited pixels.

The seeded occupancy/orientation gate exercises one hundred heterogeneous layouts.
Additional goldens verify alpha-aware resize, crop/source coordinates, rotation,
full gutter pixels, permutation independence, empty images and atomic invalid-layout
failure. Tests also receive semantic TypeScript checking in the root check command.
