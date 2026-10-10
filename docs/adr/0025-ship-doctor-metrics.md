# ADR 0025: Ship Doctor inventory, budgets and measured work

Status: inventory, warning policies, live posed work and measured profiler implemented;
Ship UI and saved custom policy integration pending.

## Contract

`inspectRuntimeInventory(NativeRuntimeAsset, budget)` is a portable on-demand report.
The asset has already passed strict native ingestion; the report does not mutate its
program, advance a player, install resources or infer pixel-body validity. It expands
each artboard's UI instances and counts each independent character, including hidden
instances. Definitions that are not instantiated are not artboard workload.

Inventory counts bones, constraints, slots, expanded nodes, authored animation timelines,
skeletal vertices/triangles, clipping polygons and potential weighted vertex transforms
across **all attachment variants/skins**. Shared mesh geometry is counted once per rig,
but independent variant weights retain their own influence counts. These are inventory
and potential-work figures, never active frame counts. Mixed zero-influence entries
retain the engine's defined rigid fallback; they are not labeled invalid weights.

Physical resources count atlas pages once and independent images once per native resource
ID. Logical atlas views do not duplicate page memory. Approximate texture memory means
base-level RGBA8 width × height × 4; it excludes mipmaps, MSAA, decoded CPU copies, text
rasters, driver allocation and font-engine memory. Encoded texture/font byte totals are
reported separately. Independent raster headers are inspected by the same renderer-free
atlas parser used before worker decoding. Missing/corrupt/unsupported dimensions produce
object-specific coded errors; incomplete memory/dimension totals remain `null`, not zero.
Actual pixel/font-body decode remains the worker/host publication gate.

## Budgets and diagnostics

Mobile Low, Mobile High, Desktop and Web are independent starting **warning policies**,
not hardware guarantees or alternatives to native hard ingestion limits. Custom starts
from Web and supplies team thresholds. Every complete budget owns a bounded label and
finite nonnegative thresholds for the exact known metrics. Counts must be safe integers;
timings may be fractional milliseconds. Saving workspace custom policy is a Ship UI task.

`checkRuntimeBudget` accepts only known actual values or explicit unknown fields. Equality
passes; values strictly above a threshold receive a warning with code, scope, metric,
actual/limit, object ID, explanation and remedy. Inventory, frame, resource and profile
scopes remain distinct. Unmeasured draw calls/timings are not fabricated as zero. Native
font coverage/fallback/license diagnostics compose with inventory/resource findings.

## Live posed work and measured profiling

`inspectRuntimeFrame(player)` reads current expanded scene and selected rig attachments
without invoking solver/skinning or advancing clocks. Vertex/influence/bind-matrix counts
describe **one eligible skinning publication of this pose**, even while playback is paused.
They are not an assertion that a zero-tick update performed skinning. Hidden rigs still
contribute their configured CPU workload. Vertex/triangle fields are skeletal content;
they exclude UI tessellation and mask GPU triangles. Clipping vertices include selected
polygons even when the renderer's exclusive boundary leaves a mask unused. Configured
constraints count solver entries, not a fabricated number of arithmetic operations.

`activeTrackCount` counts incoming selected animation timelines. Pausing retains the
selected pose, while Stop or disabled Logic returns zero. The runtime freezes outgoing
blend poses, so those captured poses do not invent an additional sampled track.

`RuntimeFrameProfiler` owns 1–600 retained samples (default 120), with no per-record array
allocation. It validates each sample before mutation, retains accepted ticks (0–12),
distinguishes missing draw counts from zero, and returns detached nearest-rank min/median/
p95/max statistics over the current window. Failed render submissions do not masquerade
as successful samples.

`NativeWebFrameProfiler` measures actual CPU update **including adapter sync**, then actual
CPU render submission separately. Core WebGL2 draw methods are temporarily wrapped for
that submission and restored on success/failure; mask passes count. Other backends,
extension draw paths and nested instrumentation are unavailable rather than assumed zero.
This is neither GPU elapsed time nor target hardware FPS certification. The actual native
golden records seven calls with stencil masks versus fewer after removing them, agrees
with an independent observer and preserves exact rendered pixels and context methods.

## Workspace acceptance

Active scene/rig counts must follow live attachment selection, draw order, component
expansion and clipping semantics. Selected animation tracks, solver/skinning work and
rendered geometry are different costs; hidden character CPU evaluation remains visible.
Draw calls require actual renderer instrumentation, including mask passes. CPU update and
render submission timings are measured separately with bounded samples; software-rendered
CI evidence is not a hardware FPS claim. The Ship workspace must label inventory versus
current frame versus measured percentiles, preserve custom policies and provide focusable
findings plus the actual export/load/play workflow.

## Evidence

Unit fixtures cover repeated component rigs, hidden instances, all variants, shared geometry,
mixed weights, packed page deduplication, resource errors, equality/unknown boundaries and
malformed custom policy/measurements. Browser acceptance compares all fifteen actual worker
exports against host-decoded physical source dimensions and RGBA memory, verifies expanded
node counts and unchanged source/player state, and restores owned font resources.
Live work also matches independent core skinning counters on the weighted Fox sample and
ordinary poses. Window rollover/unknown coverage/atomic invalid samples are unit-tested;
actual native Web CPU samples, stencil draw counts and failed-render cleanup are browser-tested.

The Ship UI labels packaged inventory, posed work and CPU percentiles separately, owns
cancellable source/texture capture and native resource staging, persists custom policies
and verifies actual export/load/play. Findings are searchable/filterable and keep code,
severity, object and remedy. Rig diagnostics add artboard/expanded-rig context because
attachment IDs can repeat across independent owners. Zero-influence mesh vertices retain
legal rigid fallback rather than being mislabeled as invalid; exclusive self-ending clip
ranges are warnings. Inspection can select source slots/bones/graphs, authored component
instances or native atlas pages without modifying model content. Foreign native assets
do not claim a verified source association. Automated fix actions belong to Phase 12.

Compatibility reports own detached native requirements and host support. Only the accepted
Web host is available; Unity/Cocos stay pending until their respective engine gates pass.
The user explicitly waived old-file compatibility before release. Native v1 does not
invent a previous-reader guarantee or migration adapter for an unpublished format.
