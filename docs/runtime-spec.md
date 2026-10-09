# Runtime behavior and migration contract

## Existing skeletal evaluator

Coordinates are y-down, rotation uses radians, and transforms are affine matrices stored as
`[a,b,c,d,tx,ty]`. Rendering consumes evaluated vertices and matrices; it does not define the pose.

Evaluation: restore setup values, sample/blend animation, solve FK, solve ordered IK (refreshing world
matrices), apply deform and skinning, resolve draw order and submit render items. FK before IK is
intentional: IK requires current world-space targets. Preserve this tested dependency when adding
new solvers; do not reorder steps solely to match a schematic diagram.

The player supports looping, queueing, crossfade, named events and skins. Its public update argument
is seconds; EditorEngine.tick accepts milliseconds. A frame delta is capped at 100ms. This is the
legacy playback policy, not a fixed-step physics contract. Physics needs a separate deterministic policy.

Numeric parity tolerance: 1e-4 absolute for transforms and vertices unless a fixture specifies otherwise.
Known IK limitations: softness/pole-vector solving is absent; shear and mirrored chains need additional
coverage. Never advertise unimplemented solver fields as supported runtime behavior.

## Planned independent runtime format

Source: `format: bonebybone-project`, schema version, stable project/artboard/node IDs, editable scene,
assets, rigs and authoring metadata. Extension `.bbbproj`, structured JSON prototype initially.

Runtime: `format: bonebybone-runtime`, independently versioned and compiled from source. Extension
`.bbb`. It must omit editor-only metadata and include explicit feature compatibility. Do not simply
rename the source JSON to `.bbb`. Binary encoding is deferred until measurement justifies it.

The current RuntimePlayer continues to accept legacy documents until the runtime compiler milestone.
UI layout, typed parameters, triggers, binding, state priority, event ordering across state transitions
and interruption semantics must receive their own golden fixtures before engine adapters are added.

## Scene Motion Alpha (source schema 2)

Artboards optionally own scene clip libraries; absent means empty. Scene tracks target stable node IDs and numeric transform/opacity properties. Their keys reuse stepped/linear/cubic interpolation. `sampleSceneClip` returns transient transforms/opacity; `SceneClock` defines forward time and ordered loop events. See ADR 0006 for boundary, scrubbing and event semantics. Legacy skeletal clips retain their existing contract inside each rig. The shipping runtime compiler is still pending; source schema 2 is not `.bbb`.

## Portable UI model (source schema 3)

Layout resolves local unscaled boxes before additive transform animation. Nine-slice source borders survive resizing unchanged. Components expand without copying children into authored instances, with typed exposed overrides and explicit migration requirements. ADR 0007 defines these semantics and text adapter limits. Schemas 1 and 2 migrate by advancing the schema identifier only; missing layout/components retain absolute/empty defaults. These source/evaluation contracts do not imply that the legacy RuntimePlayer renders UI or consumes `.bbb`.

## Rig markers (source schema 4)

Bone local transforms are composed with their parent's evaluated world transform in topological order. Setup data is restored before every sample; Setup mode bypasses animation tracks, while Animate samples into the transient pose. Slots bind to bones and own color, default attachment and draw-order position. Active skin entries replace slot defaults; sampled attachment tracks override that resolved attachment from their first key onward. Animated draw order is a full permutation of slot indices. Structural edits rewrite these references by identity before publication.

Optional skeleton markers have unique IDs, names, same-rig bone references and local affine transforms. Point, socket and spawnPoint have no area geometry. Hitbox, hurtbox and trigger carry a centered positive rectangle or a simple polygon of 3–256 coordinate pairs (concave allowed, self-intersections rejected). Positions use rig units and angles radians. Evaluation after FK/IK computes `rigNodeWorld * boneWorld * markerLocal`. The returned outline is transformed by the same matrix; geometry is metadata and does not itself run collision detection. Preview and runtime consumers use the sampled pose without modifying authored markers. Source schemas 1–3 migrate by advancing only the schema identifier.

Spine export cannot represent these native semantics and reports their omission; it leaves the native source untouched. The portable evaluator is available from core, but the `.bbb` compiler and Unity/Cocos socket APIs remain later milestones.

Human guides and mirrors author setup data only. Guides add a new hierarchy using rig units and positive Y down; their named bones remain ordinary editable bones. Mirror applies a vertical reflection `[-1, 0, 0, 1, 2*axisX, 0]` to each selected setup world matrix, then derives local transforms relative to copied or existing parents. Marker local transforms/geometry stay unchanged while their references move to the copied bones. Each insertion is one atomic undo step and does not duplicate artwork, weight bindings, constraints or animation tracks.

## Mesh influence validation and editing

Indexed weight rows cover every vertex exactly once. Nonempty rows require unique integer bone indices in range, finite nonnegative weights and a sum within 1e-5 of one. Missing weights or count-zero rows use the current slot bone. Invalid source rows fail load; runtime skinning is not a repair step. Existing valid legacy weighted coordinates remain unchanged in this milestone.

The standalone mesh algorithms normalize using overflow-safe scaling. Prune uses descending weight, ascending bone index for ties, a normalized threshold and maximum influence count; remaining values renormalize to one. Positive input always retains at least its strongest influence. Paint changes one bone while retaining all other proportions, including when the selected bone is the slot bone. Setup Normalize/Prune preserves animation/deform tracks and restores exact source on undo/redo.
