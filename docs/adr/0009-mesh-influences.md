# ADR 0009: Mesh influence safety and portable algorithms

Status: accepted; Phase 5 passed CI 37842645552. Phase 6 is in progress.

Extract executable mesh algorithms into packages/mesh with no dependency on core, runtime, editor, React or Pixi. Core may depend on mesh validation; editor may use mesh algorithms and browser workers. Build references, dev/test aliases, dependency manifests and Docker must include the same dependency graph.

Retain the indexed legacy weight representation: each vertex has a count followed by bone-index/weight pairs. Absent weights and explicit count-zero entries retain rigid fallback to the slot bone. Every weighted attachment must have exactly one entry per vertex, with integer in-range bone indices, no duplicate influences, finite nonnegative values and a positive sum within 1e-5 of one. Invalid files fail before replacing the active project; no implicit destructive repair occurs. Numeric tests that historically supplied only a prefix of a quad's weights must supply the remaining rigid rows explicitly.

Normalization merges duplicates in explicit algorithm input, drops zero entries, divides by the largest finite input before summing (avoiding overflow), and orders results by bone index. Pruning ranks by weight descending, ties by bone index ascending, applies a normalized threshold and a positive integer maximum, then renormalizes. If a nonempty positive row would lose every influence, retain its strongest entry. All-zero rows become the explicit rigid fallback. Repeated operations agree within floating-point tolerance; undo/redo restores exact stored snapshots.

Painting one bone preserves the relative distribution of every other bone. The slot bone follows this same rule; painting it must not silently erase all other weights. A previously rigid vertex starts with unit influence on its slot bone. Normalize and Prune are atomic Setup commands; animation and deform tracks remain untouched.

This milestone does not change the existing skinning coordinate convention. Explicit bind-pose-preserving skinning, topology validation, auto-mesh/weight workers, linked meshes and measured Standard/Heavy fixtures remain required before the Phase 6 gate.
