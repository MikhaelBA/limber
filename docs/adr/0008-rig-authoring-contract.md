# ADR 0008: Rig helpers, runtime markers and structural edit safety

Status: proposal; Phase 4 CI must pass before implementation.

Retain the existing bone, slot, attachment, skin and animation model. Rig helpers create setup data through scoped commands and cannot insert animation keys. Setup and animation remain visibly distinct modes. The character viewport retains its current coordinate convention (positive Y downward); a human guide uses head above pelvis and legs below it.

Runtime markers are optional skeleton data with stable IDs, a name, bone reference, local affine transform and semantic kind: point, socket, spawn point, hitbox, hurtbox or trigger. Area markers use rectangle or polygon geometry; point-like markers use only a transform. Evaluation composes the sampled bone world matrix with the marker local matrix. Scene/world consumers may prepend the rig node matrix. A socket is an output attachment point, not an IK constraint or an engine-specific component.

Introduce source schema 4 for this authored extension; older native schemas retain every existing field during in-memory migration. The legacy document reader accepts absent marker arrays as empty. Validate marker IDs, finite transforms, supported geometry and same-rig bone references before the active document changes. Optional Spine export must report unsupported semantics rather than silently advertise marker parity.

Mirror Bones duplicates the selected subtree's setup bones about a vertical rig-space axis using affine reflection and decomposition, with fresh stable IDs and readable unique names. It does not imply duplicated mesh bindings, slots or animation. Markers attached to copied bones may be copied with remapped references. Existing reflected/sheared parents must preserve the mirrored world pose within numeric tolerance. A parameterized human helper adds a new named hierarchy in one undo step; it never replaces an existing rig.

Structural edits must be transactional. Validate a proposed change before publishing it, including references in inactive skins and all animation tracks. Deleting a slot must retain original slot/draw-order positions on undo. Deleting a bone must explicitly handle its child bones, slots, weights, constraints, markers and animation references; failed edits leave data and redo intact. Unknown skin activation must fail before mutation. Animated slot attachment tracks override skin defaults only where the existing track contract specifies.

Phase 5 evidence must include setup/key isolation, skin switching with preserved animation, reflected hierarchy transforms, deterministic socket poses during playback, hierarchy/slot edge cases, save/reopen and a real browser human-rig/marker workflow. Pin Hand/Foot creates semantic targets using supported IK fields; solver robustness, softness and additional constraints remain Phase 7.
