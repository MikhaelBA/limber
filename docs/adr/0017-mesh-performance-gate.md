# ADR 0017: representative mesh performance evidence

Status: accepted, 9 October 2026.

Committed versioned fixture profiles plus `tools/mesh-fixtures.mjs` generate reproducible native
projects without external artwork. Standard has 60 bones, 2500 vertices with four influences each,
five active two-bone IK constraints and ten clips. Heavy has 120 bones, 10000 four-influence
vertices, ten constraints/clips, a real clipping mask and full-coordinate Deform. Bind matrices use
setup FK; animation changes weights' evaluated bone transforms without rewriting source geometry.
The prior geometry-only Worker fixtures remain separate cancellation/race regressions.

Opt-in bounded browser instrumentation samples the actual editor ticker. Core time includes
reset/mix/FK/IK/Deform/skinning and transient time updates; viewport time additionally includes
reconciliation/gizmos/position buffer updates. A UTILITY ticker observer runs after Pixi's LOW
render callback, so CPU frame time includes rendering submission. It does not wait for GPU
completion. Capture is capped at 600 frames and normal playback allocates no profiling records.
Reusable skinning work counters are enabled only during capture.

Each profile must pass a CPU update/render-submit p95 below 16.7ms across 180 steady-state samples
after warm-up. Actual frame gaps/maxima and the graphics renderer are recorded separately rather
than disguised as CPU timings or a guarantee of hardware-independent 60fps. Headless CI uses
software graphics; release hardware/GPU-completion profiling remains a separate measurement.
Heavy's full source also exercises real auto weights, progress, rendering and an inspector
interaction during computation, exact history and native roundtrip, and preservation of clips/Bind.

Weight-only publication must retain GPU geometry and the ghost evaluator's maps/pose cache.
Renderer reconciliation now rebuilds geometry only for actual attachment/UV/topology/count changes;
texture changes resolve independently. Ghost caches rebuild when the rig or structural world-matrix
allocation changes. Position-only edits continue streaming evaluated coordinates to existing GPU
buffers. Browser counters assert cache preservation after Worker publication.

Bind/Deform validation first computes conservative absolute segment bounds. A comfortably finite
matrix-transformed bound proves all vertices safe in O(vertices + bindings), avoiding the common
O(vertices × bindings) scan per segment. Near Float32 limits it retains the original exact vertex
checks; large cancellation remains accepted and genuine overflow remains rejected. A margin on the
fast bound protects floating-point rounding. This changes validation cost, not sampling semantics.
