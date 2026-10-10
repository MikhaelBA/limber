# ADR 0024: Independent native runtime v1

Status: Phase 9A defines the portable compiler and strict loader after the Phase 8
acceptance gate. Phase 9B1 adds native character playback with raw fade/FIFO and authored
Logic. Phase 9B2a shares the raw clock with native scene animation and expanded responsive
UI/bindings/routing. Phase 9B2b adds validated shared assets and owned artboard orchestration;
Phase 9C1 adds staged Web pixels/host fonts and shared production/editor rendering. Image/
font workers, SVG/atlas packing, Ship Doctor and the integrated exported-playback gate
remain required. Sol 6.1 / High is suitable.

## File and ownership contract

`.bbbproj` is editable source. `.bbb` has the independent `bonebybone-runtime` header
and `version: 1`. Its public envelope contains `id`, `name`, `defaultArtboardId`, sorted
`features`, `textures`, `artboards` and `components`. It contains no editor selection,
component revision, graph-canvas position, scene track/key/event selection ID or scene
FPS. Clip/node/graph identities and public names survive because host APIs reference
them. Scene times remain seconds; playback uses the existing 120 Hz contracts.

Runtime records retain UI layout, exposure/override, masking, text/font requirements,
typed bindings/routes/events and rig/mesh/constraint semantics. Linked mesh geometry
exists once; linked attachments omit derived geometry arrays and retain independent
weights, bindings, textures and Deform. Rig-local references retain their existing
scope. Runtime bones must already be parent-before-child to preserve weight indices.

Compilation whitelists every nested field and copies all retained data. Unknown source
metadata never ships. Dictionary keys and asset IDs sort deterministically; array
order remains authored because it controls draw order, event ties and route ordering.
The default runtime artboard is the first authored artboard unless explicitly selected
in compile options; editor selection cannot silently change the entry point.

Both pretty debug JSON and compact UTF-8 JSON carry this same runtime schema. Compact
JSON is the initial `.bbb` encoding. An opaque binary encoding needs measured benefits
and is deferred. No new reader/migration compatibility obligation is introduced, per
the user's pre-release policy. Existing inexpensive legacy APIs remain available.

## Validation and publication

The loader rejects authoring files, unsupported versions, unknown fields at every
object boundary, unknown discriminants, malformed scalars, invalid UTF-8/JSON and
unknown/inaccurate feature manifests. Required capabilities are independently derived,
including authored disabled graphs. Validation precedes any player construction.
Files are capped at 128 MiB; structural ingestion is capped at four million visited
values and depth 64. Semantic checks reuse portable source validators through a private
detached adapter. It creates collision-free deterministic sampling identities, revision
1 and FPS 60 only in memory; those fields are never written to runtime files. Diagnostics
map internal sampling identities back to the authored node/clip wherever available.

Additional runtime checks cover raw rig timeline references, unique clip/track targets,
time ordering/duration, draw-order permutations, unsigned RGBA, clipping end references
and finite pose precision. A failure has `code`, `severity`, `objectId`, `explanation`
and `remedy`; no partially validated program is returned. The input remains unchanged.

Phase 9B1 additionally bounds durations to safe fixed-step tick counts, checks raw
event-loop safety and conservative bone Bezier overshoot against finite pose precision.
Declared raw loops and graph state loops support at most 4096 emitted keys per accepted
tick, including loop seams/entry zero. An explicit host loop override receives the same
preflight before changing playback. The character lifecycle/mixing contract is documented
in packages/runtime/README.md and verified by independent scalar/constraint goldens.

Phase 9B2 introduces a reusable validated asset publication and owned artboard sessions.
Each accepted global tick commits scene/UI and all expanded character poses before any
host event callback. Root callbacks precede the emitting child's callbacks; queued inputs
apply on the next global tick. Scene-first/expanded-character event ordering is independent
of display frame grouping. Private ownership hooks prevent child clock advancement; host
controls remain public. Vertex buffers are skinned once at outer frame finalization,
including callback exceptions. World/slot/socket poses are available within callbacks;
vertices are read after update/Step returns. Source component-local graph limitations
remain explicit rather than silently introducing unsupported source semantics.

## Asset staging and limitations

Only referenced image IDs ship. Images use independent `{ id, mime, base64 }` records,
without source filenames, registry state or original paths. Initial compilation accepts
embedded PNG, JPEG and WebP, validates canonical base64/padding and MIME signatures,
and rejects missing pixels or source atlas regions. This is encoding/signature
validation, not complete pixel decoding. Corrupt image bodies must also fail in the
worker/renderer before publication. SVG rasterization and native atlas compilation
follow in the asset pipeline; the two SVG corpus projects currently receive explicit
conversion diagnostics. No fake pixel replacement is used for parity evidence.

Font family/fallback requirements remain authored. The initial compiler reports an
`EXTERNAL_FONT` warning for text nodes; font packaging and host adapters must make the
remaining dependency explicit. Phase 9 is not accepted until the worker/Ship workflow
and actual exported Web rendering satisfy the complete asset/playback gate.
