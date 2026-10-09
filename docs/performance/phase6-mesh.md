# Phase 6 mesh performance evidence

9 October 2026. Sol 6.1 / High was sufficient for these increments.

## Representative production-build run

Windows, Playwright Chromium 153, headless ANGLE Vulkan SwiftShader software graphics. Each
profile records 180 steady-state ticker frames after warm-up. CPU time includes core evaluation,
viewport updates and Pixi render submission; it excludes asynchronous GPU completion.

| Profile  | Bones | Weighted vertices | Constraints | Clips | Vertex transforms/frame | Core CPU p95 | Update/render-submit CPU p95 | Actual frame-gap p95 |
| -------- | ----- | ----------------- | ----------- | ----- | ----------------------- | ------------ | ---------------------------- | -------------------- |
| Standard | 60    | 2500              | 5           | 10    | 10000                   | 0.30ms       | 1.70ms                       | 27.60ms              |
| Heavy    | 120   | 10000             | 10          | 10    | 40004                   | 0.80ms       | 3.20ms                       | 61.00ms              |

Heavy includes a rendered clipping mask and full-coordinate Deform. Its transform count includes
the four rigid clipping vertices; per-frame bind matrix products are 60/120. Native/runtime/editor
numeric parity, source preservation and exact history are checked in addition to timing.

Both CPU p95 values pass the 16.7ms budget. Software graphics has slower real frame cadence, so
these results **do not certify 60fps GPU playback on release hardware**. The graphics renderer and
actual gaps are explicitly included in evidence. Hardware/GPU profiling belongs to the later platform
budget/profiler milestone and should precede performance claims in a release.

The full Heavy auto-weight job took 500.6ms in the production run, with eight rendered frames during
computation and a maximum 66.7ms frame gap. A real inspector interaction succeeds while computation
is running. Publication took 31.4ms, retained existing GPU geometry/ghost caches and preserved clips
and Bind through undo/redo/save/reopen. The separate geometry-only regression fixture measured
14.1ms Heavy publication in the full local development-suite run. Different fixture/build measurements
are not a controlled speedup comparison.

## Costs removed and validation

Weight-only/property updates no longer force replacement of all GPU geometry or reconstruction of
the ghost skeleton. UV/topology/attachment/count changes still rebuild the required geometry, and
texture changes resolve independently. Browser counters verify cache retention for weight publication.

Deform validation uses a conservative finite bound to avoid scanning every vertex for every binding
on ordinary animation segments. Near Float32 limits, exact coordinate checks remain, including
cancellation and genuine overflow tests. Source geometry/UVs outside Float32 range are rejected
before pose/GPU allocation. Shared-mesh validation also rejects sparse conflicting derived arrays.

Local checks passed: 341 unit tests, TypeScript, lint/architecture boundaries, formatting, package and
editor builds. All sixteen browser workflows passed; the final production profile workflow also
passed. Scene/RTL raster gates retain their existing tolerances. Raw browser evidence is written to
`packages/editor/.smoke/mesh-performance.json` and uploaded by CI with the screenshots.

The final remote Phase 6 gate is recorded in PROGRESS.md and ROADMAP.md after it completes.

## Remote acceptance gate

[CI run 37982002648](https://github.com/MikhaelBA/limber/actions/runs/37982002648), commit `95bdfd1`,
passed all 341 unit tests, sixteen browser workflows, Docker and both deployments on a clean Linux
checkout. Standard/Heavy CPU update/render-submit p95 was 1.40/4.20ms. Heavy worker computation
and publication were 290.7/39.9ms, with the asserted inspector interaction, rendering and cache
preservation. The CI renderer was also SwiftShader: actual frame-gap p95 was 29.7/87.3ms, with
a 116.7ms maximum gap during Heavy worker computation. These graphics-cadence limits remain
visible in the evidence and are not relabeled as 60fps playback. This closes the Phase 6 acceptance
gate defined in ADR 0017; platform hardware/GPU certification remains a later release task.
