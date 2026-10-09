# ADR 0014: deterministic neighbor weight smoothing

Status: accepted for Phase 6G.

Bound weighted meshes expose whole-mesh smoothing in Setup. A pass blends each vertex's influence
distribution with the uniform mean of its unique edge neighbors, using a strength in [0,1]. Every
pass reads the complete previous pass (Jacobi), never newly written rows. Neighbor indices are
sorted, so triangle/winding order and repeated edge appearances do not change the result. Empty
rows contribute the slot bone's rigid distribution. Normalize/prune after each pass using the shared
stable tie and maximum-influence rules. Strength zero still applies normalization/pruning and makes
empty rows explicit. The algorithm does not lock boundary vertices or solve anatomical constraints.

The portable function validates weight rows, indices, adjacency, strength, 1–100 passes and a positive
influence limit. The editor prepares plain copied input and runs computation in a dedicated Worker.
Progress is throttled to approximately one-percent increments across all passes. The same hard
cancel/startup/transport cleanup contract applies as other mesh jobs.

Publication reuses the validated weight snapshot command with a smoothing-specific history/error
label. It preserves geometry, bindings and Deform clips. Project/rig identity, Setup mode and source
fingerprint must still match; failed/stale/cancelled jobs do not change source or discard redo. Full
main-thread publication and Standard/Heavy playback profiling remain the final Phase 6 gate.
