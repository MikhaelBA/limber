# BoneByBone delivery roadmap

The product specification is the target. Limber functionality is retained and its milestone numbering
is historical. A partial implementation never implies the corresponding product gate is complete.

| Phase | Scope                                                                | Status                                       |
| ----- | -------------------------------------------------------------------- | -------------------------------------------- |
| 0     | Foundation, architecture contracts, lint and browser CI              | Complete; CI 37528484374 passed              |
| 1     | Project/scene model, commands, portable save and local recovery      | Complete; CI 37591752107 passed              |
| 2     | Scene renderer, pivot, gizmos, multi-selection, performance fixtures | Implemented; local checks passed, CI pending |
| 3     | Timeline/graph, explicit auto-key, multi-key operations              | Partial legacy implementation                |
| 4     | Game UI, 9-slice, text/RTL, layout, components                       | Pending                                      |
| 5     | Rig UX, mirror, guides, sockets and markers                          | Partial legacy implementation                |
| 6     | Auto mesh/weights, pruning, linked meshes and workers                | Partial legacy implementation                |
| 7     | Robust IK, transform/path constraints and secondary motion           | Partial legacy IK                            |
| 8     | Logic, typed parameters, state machine and bindings                  | Pending                                      |
| 9     | Native runtime compiler, Ship Doctor, profiler and atlas workers     | Partial legacy player/atlas                  |
| 10    | Unity importer, world and UGUI runtime                               | Pending                                      |
| 11    | Cocos Creator integration and parity                                 | Pending                                      |
| 12    | PSD import, recovery hardening, accessibility, public beta           | Pending                                      |
| 13    | Commercial services only when validated                              | Pending                                      |

## Reporting protocol

Each milestone records exact scope, tests, remaining gate requirements and commit in PROGRESS.md.
Run relevant checks before committing; push after success. Report failed/unavailable remote checks
honestly. Do not execute later phases merely because reference prompts are embedded in PRODUCT_SPEC.

## Current viewport checklist

- [x] Portable world/local transform evaluation and affine golden tests.
- [x] Pixi adapter, cached geometry during drags, inherited opacity/tint and draw order.
- [x] Camera pan/zoom/frame, move/rotate/scale, snapping and pivot interaction.
- [x] Multi-selection, one undo per gesture, Escape cancellation and world-preserving reparent.
- [x] Stored 100-image screenshot fixture and render-submit timing instrumentation.
- [x] Full local checks and six browser regression suites for Phase 2.
- [ ] Phase 2 CI gate before Motion Alpha.
