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
IK supports signed/nonuniform scales, shear, world-space poles and soft reach as specified in
ADR 0019. Singular parents hold the sampled pose; unreachable targets project radially in the
chain parent's space. Softness eases extension without stretching authored lengths/scales.

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

Source schema 5 optionally stores mesh boneBindings by stable bone ID. At an explicit Setup bind, B = inverse(boneSetupWorld) * slotSetupWorld. Weighted sampling is sum(weight * boneWorld * B * (vertex + deform)); missing B is identity, and count-zero rows use the current slot bone. Stored B remains frozen until rebinding. Reflections and shear are supported; invalid/singular matrices and unbound weight references fail publication. Cursor/deform editing inverts the vertex's blended evaluated transform, rejecting singular blends without changing source. ADR 0011 defines caching, validation and export limits. Native bindings currently require native save; Spine export rejects them explicitly.

Deform tracks target existing vertex geometry once per clip. Key times are finite, nonnegative and strictly increasing; offsets are either null (zero setup offsets) or a complete finite coordinate array. Curves are linear, stepped or cubic Bezier with finite controls and X controls in [0,1]. Cubic Y overshoot is supported; conservative segment bounds must fit the Float32 pose cache. Import, direct RuntimePlayer construction, structural publication and export validate these inputs. Missing/prefix offsets are rejected explicitly rather than silently padded. Sampling applies the outgoing curve before crossfade blending; animated triangle folding remains valid.

Setup meshes require finite distinct vertices, matched UVs and a nondegenerate manifold triangle disk covering one simple boundary exactly. Invalid geometry fails load before replacing the active project. Missing meshHull on existing geometry is inferred from boundary edges without rewriting source. New concave triangulation includes interior faces only. Topology changes invalidate affected Deform tracks atomically with exact undo; position-only setup edits retain tracks. Animated mesh folding remains allowed. See ADR 0010 for numeric tolerance, unsupported topology and performance limits.

Indexed weight rows cover every vertex exactly once. Nonempty rows require unique integer bone indices in range, finite nonnegative weights and a sum within 1e-5 of one. Missing weights or count-zero rows use the current slot bone. Invalid source rows fail load; runtime skinning is not a repair step. Existing valid legacy weighted coordinates remain unchanged in this milestone.

The standalone mesh algorithms normalize using overflow-safe scaling. Prune uses descending weight, ascending bone index for ties, a normalized threshold and maximum influence count; remaining values renormalize to one. Positive input always retains at least its strongest influence. Paint changes one bone while retaining all other proportions, including when the selected bone is the slot bone. Setup Normalize/Prune preserves animation/deform tracks and restores exact source on undo/redo.

## Shared mesh instances (source schema 6)

`meshSourceId` references one owned same-rig mesh. Geometry arrays are baked aliases in memory
and omitted from linked attachments in native JSON. Texture, weights, Bind and Deform remain
independent; creation copies authored Deform once, without live inheritance. Setup geometry edits
propagate to all followers; vertex-count changes update all influence rows and clear affected Deform
tracks in one atomic history step. Detach makes geometry independent. Source deletion requires
detaching followers. Missing/cyclic/chained/conflicting sources fail load before project replacement.
ADR 0016 specifies the contract and current Spine adapter limitation.

## Ordered constraints and limb pins (Phase 7A)

`solveConstraints` is the shared stage used by character preview, scene preview, onion skin
and RuntimePlayer after FK and before skinning. It dispatches IK/transform follow in one baked serialized order,
refreshing FK after each constraint. There is no iterative feedback or per-frame graph analysis.

IK IDs and nonnegative integer orders are unique. Chains have one bone or a direct parent/child
pair; strength is finite in [0,1] and bend is ±1. Setup fields/lengths and derived setup world
matrices must fit finite Float32 pose storage. Finite zero-length/zero-scale bones remain valid
source data. Targets/poles inside a controlled subtree, dependency cycles and a reader ordered before
its target/pole/chain-parent writer fail import and structural publication. Overlapping independent
writers execute sequentially; later constraints win. ADRs 0018/0019 detail the dependency contract.

Pin Hand/Foot selects the endpoint bone and controls its parent/grandparent limb. Its pivot must
sit at the parent's +X tip. The new target is parentless in rig space, keeping the pin independent
of body motion while reachable. Position is pinned, not endpoint orientation. Initial bend keeps
the setup side; a collinear limb prefers away from its body. Pins are ordinary existing bone/IK
fields in schema 6, authored through one Setup-only command with stable undo/redo IDs. Their
targets can receive ordinary bone animation keys in Animate. Pins require aligned setup limbs.
Phase 7B supports invertible reflected/scaled/sheared limbs and parents;
collapsed pins reject atomically. Pole/softness fields are supported with ADR 0019 semantics.

## Transform follow and source schema 7 (Phase 7C)

Optional skeleton `transformConstraints` share IDs/orders with IK. World follow computes
`inverse(controlledParentWorld) * targetWorld * offset`; local follow uses `targetLocal * offset`.
Offset composition is affine, in target coordinates. Translation/rotation/scale/shear mixes are
independent finite values in [0,1]. Rotation follows the shortest arc; scale is signed linear mix;
shear blends its tangent coefficient. Canonical local QR decomposition absorbs shearY into shearX
and retains reflection in scaleY. Full mixes reproduce the desired affine; zero mixes preserve the
exact sampled pose and translation-only follow preserves all sampled basis fields. Required
singular inverses/decompositions hold the entire constraint. ADR 0020 specifies dependencies.
The shared stage also rolls back controlled locals and preceding world matrices if any solved
world matrix overflows Float32, with per-skeleton scratch allocated only on structural publication.

Creation can keep the evaluated setup pose using a computed offset. Create/edit/delete/reorder are
atomic, Setup-only and rig-scoped; deleting a referenced bone removes its follow constraints.
Native source schema 7 identifies this model, with absent arrays meaning no follow constraints.
The optional Spine adapter rejects native follow or pole/soft-reach semantics before exporting.
The independent `.bbb` shipping schema/compiler is still a Phase 9 task.
