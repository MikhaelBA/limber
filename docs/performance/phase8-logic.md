# Phase 8 integrated Logic renderer evidence

10 October 2026. Windows, Playwright Chromium 153, ANGLE Vulkan SwiftShader software
graphics, development build. The Standard/Heavy workload adds a trigger-driven 0.2s
transition and raw clip library to the combined Phase 7 constraints. The actual editor
preview renders the same portable Logic players and their posed buffers.

| Profile  | Bones | Weighted vertices | IK  | Follow | Path | Springs | Core CPU p95 | Update/render-submit CPU p95 | Frame-gap p95 | Accepted ticks/frame p95 |
| -------- | ----- | ----------------- | --- | ------ | ---- | ------- | ------------ | ---------------------------- | ------------- | ------------------------ |
| Standard | 64    | 2500              | 5   | 1      | 1    | 12      | 0.90ms       | 1.20ms                       | 16.70ms       | 3                        |
| Heavy    | 124   | 10000             | 10  | 1      | 1    | 22      | 3.80ms       | 4.10ms                       | 33.40ms       | 4                        |

Each profile measures 180 steady frames after warm-up. CPU includes update, cached
display synchronization and render submission, excluding GPU completion. Both CPU
p95 values pass 16.7ms. The 120Hz clock accepts at most twelve ticks per display frame;
measured work therefore depends on display cadence. These values are workload evidence,
not a controlled speedup comparison with earlier renderer or no-spring fixtures.

The browser compares all actual displayed matrices and mesh positions after twelve
paused Steps against both the standalone stepped player and uninterrupted accepted
ticks. The transition is still blending at that point. Weighted vertices, Deform and
all constraint stages are retained; scene rebuilds and mesh geometry count remain
unchanged through steady playback. Disabled Logic displays authored setup, and Save
must exactly equal the input project. The independently predicted critical spring
response is also covered in core tests.

Heavy clipping cuts the visible mesh halfway: inside pixels remain white and outside
pixels equal the artboard background. Additional small goldens verify two independent
clip shapes, exclusive clip ends, unused clip suppression, native RGBA/alpha and
animated raw Character draw order. Color edits preserve native unsigned values and
exact Undo/Redo. They caught real stencil, shared-mask and color conversion defects.

Actual software frame gaps do not certify hardware GPU 60fps. Renderer/user-agent
metadata and raw results are stored in `packages/editor/.smoke/logic-performance.json`.
Native fixtures and screenshots accompany CI evidence. The complete local and remote
acceptance status remains in PROGRESS.md; Phase 8 is partial until that gate passes.
