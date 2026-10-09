# ADR 0015: weight publication without structural rebuilding

Status: accepted for Phase 6H; the complete performance gate remains open.

Measured final-message publication on the local Heavy-size fixture took 295.5ms after a 347ms
Worker computation. The weight command redundantly cloned, validated and rebuilt the entire rig,
including unchanged topology, all bind-coordinate pairs and Deform bounds. Running the algorithm
in a Worker alone did not eliminate the publication pause.

Weight-only commands now validate complete normalized rows and allowed bound bone indices, then
publish one copied weights array. Undo/redo changes only that property, retaining attachment and
pose/deform/bind caches. The complete source fingerprint still rejects changes before initial
publication. Fingerprinting reads source directly instead of cloning it first. Topology, bone order,
bindings and animation remain validated authoring/load invariants; structural commands retain full
snapshot validation. Geometry changes still need rebuilding and are not covered by this shortcut.

The shared weight parser optionally materializes decoded rows. Validation streams the same checks
using one bone-index stamp buffer, avoiding per-vertex Set/row/influence allocation. Optional allowed
indices reject known but unbound bones. Existing malformed and seeded normalization tests remain
the correctness contract. Cache-identity and rejected-unbound-result tests protect atomic publication.

The browser harness times final delivery plus authoring promise microtasks. Production-build runs
reported 21.5ms Standard and 41.4ms Heavy publication, versus 86.4ms and 295.5ms before.
These are local measurements, not universal frame budgets; subsequent render reconciliation is
outside this publication timer. Full representative playback and GPU/frame evidence remain pending.

Core skinning accepts an optional reusable statistics record: active attachments, total/rigid/weighted
vertices, actual influence-point transforms and world*bind matrix products. No record is allocated
by evaluation. The driver resets the supplied counters each call; direct attachment evaluation
accumulates into a caller-owned record. Counters preserve numerical output and skip inactive slots.
