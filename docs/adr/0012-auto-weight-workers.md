# ADR 0012: isolated automatic weight computation

Status: accepted for Phase 6E.

Setup auto weights consumes attachment vertices transformed by the slot's setup-world matrix and
the setup-world segments of explicitly bound bones. It uses nearest finite segments with inverse
square distance, a maximum influence limit, stable bone-index ties and normalized rows. Exact
coincidence shares weight between coincident selected segments; zero-length bones are points.
This deterministic heuristic is a starting point for manual weight painting, not an anatomical solver.
Rebind explicitly after changing the setup skeleton when a new bind pose is intended.

Each request owns a module Worker and job ID. Progress is reported at 128-vertex intervals.
Cancellation terminates the Worker, including active computation. Completion and every failure
remove listeners and terminate it once. Switching away from Setup or unmounting the mesh panel
cancels the job. Opening another project/rig cannot publish the old result.

No source/history mutation occurs while computing. Publication checks the originating project,
skeleton, Setup mode and a complete source-rig fingerprint, then validates an atomic command.
Invalid/stale results preserve source and redo. Successful publication retains bindings and Deform
tracks and produces one exact undo/redo step. Fingerprints deliberately reject any intervening
source change, including clip/slot metadata, rather than guessing whether it affects the result.

The browser regression computes real Standard/Heavy-size geometry in the real Worker. It holds
only final message delivery to deterministically exercise cancellation/stale-result races. It records
computation duration and rendered frame gaps; these are local evidence, not a universal hardware
budget. Full Standard constraints/clips, Heavy clipping/deform and measured skinning costs remain
part of the final Phase 6 performance gate. Source validation/publication still runs on the main
thread and is not covered by the worker-only responsiveness measurement.
