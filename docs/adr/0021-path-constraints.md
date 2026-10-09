# 0021 — Deterministic native path constraints

Status: accepted for Phase 7D implementation. Full Phase 7 also needs secondary motion.

Source schema 8 adds optional same-rig paths with stable IDs/names and an owner bone,
one to 64 continuous cubic Bezier segments and an explicit closed flag. Each segment
stores start/control/control/end XY pairs in owner-local coordinates. Neighbours meet
exactly; a closed path ends at its first start. A rig supports at most 64 paths.

Path constraints control one to 128 direct parent/child bones. Progress is a fraction
of world-space arc length; optional driver bone local X adds percentage points (100
means one traversal). Ordinary bone tracks therefore animate progression without a
second animation evaluator. Spacing is a nonnegative world arc distance between
origins. Open distances clamp; closed distances wrap, including negative progress.
Endpoint clamping can place several origins at the endpoint. This is placement along
a spline, not length-preserving rope dynamics or stretch. Bone lengths/scales/shears
are unchanged; translation and rotation mixes are independent. Rotation makes each
bone's transformed local +X follow the tangent, compensating signed scale, shear and
the evaluated parent basis. Rotation offset is a local angle; it is not a promised
constant world angle under an anisotropic parent. Mixing uses shortest-arc rotation.

Each segment has 128 fixed parameter intervals. Coordinates and cumulative-distance
storage are allocated on structural publication. Distances are transformed chord
lengths, recomputed only when the owner's world linear basis changes. Binary search
in this deterministic approximation supplies a parameter; position and derivative
are evaluated on the actual cubic. Six bounded Newton iterations refine projected
chord progress within that parameter interval, removing straight-path parameterization
error. A segment join uses the incoming tangent; the closed seam uses the first segment.
This is bounded-cost approximate arc parameterization,
not exact integration. Tests compare curved paths to dense independent integration.
Translation of the owner does not invalidate metric lengths. A zero derivative uses
the enclosing nonzero chord; a wholly collapsed path holds the sampled pose. A required
singular parent holds that bone. Fully zero mixes leave all local fields unchanged.

IK/follow/path share IDs, serialized integer order and publication-time dependency
validation. The path owner must be outside the controlled subtree. Its full world
matrix and the root's parent matrix are reads. Driver local X depends on actual local
writers, not ancestor-only world changes. Driver inside the controlled subtree is
rejected. Path writes move the controlled root origin as well as descendants. Cycles
and orders preceding required writers fail before publication. Independent overlapping
writers run sequentially. Per-instance local/world backups restore an entire stage
if its resulting world matrices exceed finite Float32 precision, with no frame allocation.

Setup-only commands create/edit/delete paths/constraints and reorder them atomically.
Deleting a path owner removes its paths and affected constraints; deleting a chain/driver
bone removes referencing constraints. Undo restores exact IDs, data and clips. Native
save retains the source; the optional Spine adapter rejects native paths explicitly.
The independent shipping compiler remains Phase 9. Source identifiers 1–7 advance to
8 without inventing absent path arrays. Publication limits/approximation are part of
this versioned contract, and must be reassessed before more elaborate path weighting.
