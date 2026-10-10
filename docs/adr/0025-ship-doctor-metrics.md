# ADR 0025: Ship Doctor inventory, budgets and measured work

Status: inventory and warning policies implemented; live profiler and Ship UI pending.

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

## Remaining measured-work acceptance

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
