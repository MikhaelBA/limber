# Phase 7 combined constraint evidence

10 October 2026. Windows, Playwright Chromium 153, ANGLE Vulkan SwiftShader software
graphics, development build. The reproducible
`constraintFixture` generator combines all four solver stages with the Phase 6 mesh
workload. Each profile measures 180 steady-state ticker frames after warm-up. CPU
includes core evaluation and Pixi update/render submission, excluding GPU completion.

| Profile  | Bones | Weighted vertices | IK  | Follow | Path | Springs | Vertex transforms/frame | Core CPU p95 | Update/render-submit CPU p95 | Frame-gap p95 |
| -------- | ----- | ----------------- | --- | ------ | ---- | ------- | ----------------------- | ------------ | ---------------------------- | ------------- |
| Standard | 64    | 2500              | 5   | 1      | 1    | 12      | 10000                   | 0.80ms       | 1.90ms                       | 22.10ms       |
| Heavy    | 124   | 10000             | 10  | 1      | 1    | 22      | 40004                   | 3.90ms       | 5.50ms                       | 56.90ms       |

Both CPU p95 values pass the 16.7ms gate. Heavy retains clipping and full-coordinate
Deform. Its four extra rigid clipping vertices account for four additional transforms.
The closed path follows an IK-driven affine owner; its reflected/sheared chain has
parent/child secondary motion. Weighted bones also carry springs. All ten original
clips and source arrays are retained; the saved source must equal the input exactly.

CPU timing depends on accepted fixed steps per display frame. The clock accepts at
most 100ms/12 steps, samples animation and primary constraints per step, and skins
once after the final step. Numeric tests independently compare 10Hz and 60Hz playback
and require exactly equal final matrices/vertices. Timings are workload measurements,
not a controlled speedup comparison with the no-spring Phase 6 fixture.

Actual frame gaps remain visible and do not certify hardware GPU 60fps. Browser
renderer/user-agent metadata accompany raw results in
`packages/editor/.smoke/constraint-performance.json`; screenshots/native projects
are uploaded by CI. The overall Phase 7 gate also requires the complete local and
remote regression, recorded in PROGRESS.md. Hardware profiling remains a later
platform/release requirement.
