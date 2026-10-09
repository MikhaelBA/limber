# ADR 0016: shared geometry and independent mesh instances

Status: accepted, 9 October 2026.

Native source schema 6 adds optional `AttachmentData.meshSourceId`. It points to an owned mesh
inside the same rig. Missing, self, non-mesh, cyclic and chained sources fail validation. Creating a
variant from another variant flattens its reference to the owner. Geometry means positions, UVs,
triangles and hull; native JSON writes those arrays once on the owner. Linked geometry fields in
memory are derived array aliases baked by Skeleton, keeping the existing renderer/skinning loops
free of source lookups. Conflicting redundant geometry is rejected on load rather than silently lost.

Texture, weights, frozen binding matrices and pose/Deform caches belong to each attachment ID.
Creating a variant copies weights, bindings and all authored Deform tracks once. Later changes are
independent; this is not live Deform inheritance. Each instance can be rebound, painted, smoothed,
auto-weighted or assigned another imported texture. The action assigns the instance to the selected
slot's default or active skin in one undo step.

Setup geometry edits, including edits initiated on a linked mesh, target the owner and refresh all
derived aliases. Position-only edits preserve independent Deform tracks. Vertex insertion/deletion
updates every instance's encoded weight rows and clears every affected Deform track atomically.
Detaching copies geometry into the instance without changing its weights, bindings or animation.
Deleting a source with followers is rejected before mutation; detach followers first. Deleting an
instance removes only its own references/tracks and restores exact attachment order on undo.

The current Spine adapter rejects shared meshes explicitly; detach first (native bindings remain a
separate export limitation). The native runtime evaluates each instance independently against the
shared geometry. Full-coordinate numeric fixtures and authoring/browser history tests cover this
contract. Advancing historical source schema identifiers remains a cheap existing reader behavior;
backward compatibility is not a pre-release acceptance requirement.
