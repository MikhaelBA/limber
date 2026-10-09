# ADR 0020: Transform follow constraints and a shared order

Status: accepted for Phase 7C. Complete phase acceptance still needs path/secondary motion.

Source schema 7 adds optional skeleton transformConstraints. Each entry has a
stable ID, controlled boneId, targetId, world/local space, target-space affine
offset, four independent [0,1] mixes (translation, rotation, scale, shear) and a
nonnegative integer order. IDs/orders share the same namespace as IK. Missing
lists mean no transform constraints; existing project schemas upgrade their
identifier without fabricating constraints.

World follow evaluates inverse(controlled parent world) * target world * offset.
Local follow evaluates target local * offset directly in the controlled parent's
coordinates. Target offsets compose as matrices, not individual field additions.
Creation can preserve the currently evaluated setup pose by computing the inverse
source-target matrix times the controlled matrix. It must reject an undefined
inverse before any source mutation. Editing/creation/removal is Setup-only and
uses validated detached snapshots; exact undo/redo and rig navigation remain.

Translation blends linearly. For any nonzero basis mix, canonically decompose the
current and desired local affine matrices: nonnegative scaleX, reflection in
scaleY, shearY absorbed into shearX. Rotation uses shortest-arc mix; signed scales
mix linearly; shear mixes its tangent coefficient. This decomposition is confined
to the transform-constraint stage because selective affine copy requires an
explicit component convention. Full mixes reproduce the desired matrix. Zero
mixes preserve the exact sampled pose; translation-only follow preserves all
sampled basis fields without canonicalization. A required singular/near-singular
inverse or decomposition holds the entire constraint deterministically.

The shared stage checks that solved world matrices remain finite Float32 values.
If a solve overflows (including descendant matrices), restore that constraint's
controlled locals and its preceding FK matrices before continuing. Each Skeleton
allocates its matrix backup once on creation/structural publication, never per
frame. This applies to IK and follow and leaves authored data intact.

The Skeleton bakes a mixed IK/transform list once on publication. Runtime order
is global, renderer independent and refreshes FK after each active constraint.
Transform writes can move their root origin, so world position dependencies are
inclusive. IK root rotations leave their own origin intact. World transform reads
need the full target/parent basis; local reads depend only on constraints writing
that target's own local transform. Same controlled subtree targets are rejected;
cycles/invalid global order fail publication. Independent overlapping writes remain
explicitly sequential. Bone deletion removes any referencing transform constraint.

Beginner UI exposes a Follow target action and four strength controls. Advanced
shows space, offset fields and global ordering. Offset edits/invalid mixes cannot
leave an invalid live rig. Native Save/Open and preview/runtime parity are required.

The optional Spine adapter rejects native follow and pole/soft-reach semantics
explicitly instead of silently exporting different behavior. Native source files
retain all fields; native shipping format remains a separate Phase 9 deliverable.
