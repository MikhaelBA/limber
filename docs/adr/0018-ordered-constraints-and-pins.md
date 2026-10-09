# ADR 0018: Ordered constraints and semantic limb pins

Status: accepted for Phase 7A; ADR 0019 extends the affine/pole/softness and
position-dependency portions in Phase 7B. Initial restrictions below are historical.

Use one renderer-independent constraint entry point after FK and before skinning.
Currently it dispatches ordered IK and refreshes FK after each solve; later solver
types must join the same serialized order space. No iterative feedback is implied.

Each IK has a unique nonempty ID, unique nonnegative safe-integer order, a direct
one/two-bone chain, finite mix in [0,1] and bend direction ±1. Finite setup transforms
and nonnegative lengths are required. Zero scales/lengths remain valid authored
data, with their solver behavior addressed separately. Pole and nonzero softness
are rejected until implemented, rather than silently accepted as working fields.

A constraint writes the world transforms of its chain root's whole subtree. Its
target must be outside that subtree. It reads its target and chain-parent world
transforms. If another constraint writes either read, that writer must have a
lower order. Reject dependency cycles and invalid ordering before publication.
Overlapping writers with independent inputs are allowed; the later solve wins.
Validation and dependency analysis run on structural publication, never per frame.

All IK add/edit/remove/reorder commands validate a detached rig snapshot and
publish once, preserving the existing rig-scoped history, weights, animations and
redo on failure. Authoring is Setup-only. Stable IDs survive undo/redo.

Pin Hand / Pin Foot selects the hand/foot endpoint bone. Its parent and grandparent
form the limb chain; its pivot must already coincide with the parent's +X tip.
Create a target at that pivot in rig space (parentId null), so body movement does
not carry the pin. Preserve the setup elbow/knee side. One undo removes both the
target and constraint. An already-controlled limb fails with a useful message;
do not create conflicting targets or replace keyed targets silently.

The first Pin increment supports unit-scale, unsheared, unreflected setup limbs.
Unsupported affine chains fail before mutation. Robust affine solving is the next
increment; this contract does not mark all Phase 7 numerics complete.

No new persistent field is needed: pins use ordinary existing bones/IK fields and
source schema 6. Keep the separate shipping runtime schema for Phase 9. Artist
controls expose pins, strength and bend; Advanced holds target and ordering.
