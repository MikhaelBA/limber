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

## Native path follow and source schema 8 (Phase 7D)

Paths own continuous cubic Bezier segments in an owner bone's local coordinates.
The shared ordered stage places a direct chain on measured world arc distances and
aligns each bone's transformed +X with the tangent. Authored length, scale and shear
remain unchanged. Translation/rotation strengths are independent; local rotation
offsets and global serialized order are Advanced fields. Native save persists paths,
constraints and their ordinary bone progress controls. See ADR 0021 for limits and
the deterministic 128-interval-per-segment arc approximation.

Progress is a length fraction; optional driver local X adds percentage points.
The inspector explicitly keys driver X using the existing bone timeline command.
Open paths clamp distances and closed paths wrap, including negative progress.
Collapsed curves hold the sampled pose; singular parents hold the affected bone.
Metric caches are per skeleton and only rebuild cumulative lengths when the owner's
world basis changes. No renderer API participates in evaluation. IK, transform and
path share dependency/cycle validation and whole-stage finite-output rollback.

Authoring creates an independent owner/driver, edits joined endpoints atomically,
extends/removes segments and closes/opens curves. The character viewport draws the
evaluated path; curve controls currently use numeric owner-local fields. Dragging
Bezier handles directly in the viewport is a follow-up UX improvement. Paths can
be reused by independent chains. Removing a path removes its followers; removing a
referenced bone removes affected constraints. Controls and their tracks remain when
only a constraint/path is removed. Source 1–7 identifiers advance to 8, with absent
arrays meaning no paths. The optional compatibility exporter rejects native paths.

## Secondary-motion kernel (Phase 7E1)

Core exposes `advanceDampedSpring` and `FixedStepClock` with the numerical contract
in ADR 0022. The spring exactly integrates a constant-target damped oscillator over
a validated bounded step. The clock provides 120Hz step counts with a 100ms accepted
delta cap, retained fractional time and discarded-stall diagnostics. These utilities
provide the player/editor physics clock in Phase 7E2. Integration must
resample animation and primary constraints at each fixed step before advancing the
spring; passing one display-frame target to several spring steps is insufficient.

## Angular secondary motion and source schema 9 (Phase 7E2)

Optional `secondaryConstraints` run after the ordered IK/follow/path stage. Each
controls one bone's world +X heading with explicit frequency, damping, mix and maximum
angle coefficients. Soft/Bouncy/Firm are authoring presets, not implicit runtime defaults.
All primary headings sample before spring writes; secondary ancestors precede children.
The actual affine parent inverse and signed/sheared local X basis derive local rotation.
Pivot, scale, shear and length remain authored. Singular/collapsed bases hold; nonfinite
secondary output restores rotations/world matrices and rebases all spring state.

Editor and RuntimePlayer resample animation/FK/primary constraints at every 120Hz step
and then integrate the spring. Present the last completed step without interpolation.
Accepted time caps at 100ms after editor speed, retaining substep remainder. Events
aggregate across accepted steps; discarded stalls and seeks emit none. Compensation
in animation elapsed time preserves exact duration boundary event ordering.

Setup, paused preview, seek/stop, clip change, structural publication and explicit runtime
`resetSecondaryMotion()` rebase without lag. Pause drops remainder. Scrub displays the
primary authored pose; it does not replay past physics. Queued clip changes also rebase;
crossfades retain existing mixer blending. Frozen outgoing clips do not refire events.
Rigs with no secondary constraints retain their existing playback clock contract.

Setup authoring is atomic, with globally unique constraint identities/orders, one spring
per bone and a 128-spring cap. Primary creation inserts before secondary entries; deleting
a bone cleans its spring. Native schema 9 stores all coefficients. Absent arrays mean no
secondary motion; historical source identifiers advance to 9. The optional Spine adapter
rejects native springs. ADR 0022 defines numerical ranges, limits and reset semantics.

## Portable Logic kernel (Phase 8A)

Core exposes `LogicGraph`, typed parameter/condition/state/transition records,
`validateLogicGraph` and `LogicMachine` under ADR 0023. The renderer-free kernel owns
a validated cloned graph and baked clip durations. `step()` advances exactly one
120Hz tick; an adapter drives display accumulation. Setters validate types/ranges
before enqueueing inputs; getters read the preceding committed tick. Float values
and comparison literals canonicalize to Float32. Triggers latch until consumption
or explicit reset. A winning transition consumes only its fired-condition triggers.

Priorities are unique globally, lower first, including Any State. Each tick selects
at most one transition. Exit time reads the preceding completed state time. Active
blends either defer candidates or admit only a strictly higher-priority interrupt.
Snapshots expose destination/clip time and blend metadata; pose blending itself is
not part of this kernel increment. Unconditional immediate cycles fail validation;
conditioned/positive-exit cycles remain valid. Debug metadata is bounded and copied.

Source ownership/serialization, scene/rig adapters, typed event strengthening,
property binding and Logic UI/interaction are outstanding Phase 8 increments.
Source remains schema 9, and the existing player/editor behavior is unchanged by
these exports. A portable kernel does not close Interactive Alpha or provide a `.bbb`.

## Native Logic source and commands (Phase 8B)

Source schema 10 optionally stores one `logic` graph on an artboard or rig node.
Artboard states resolve scene clip IDs; rig states resolve animation names in that
rig's library. Both use the shared typed graph validator. References/identities are
owner-scoped, as with rig bones; copying a rig preserves an independent graph.
Unsupported node/component owners and ambiguous rig clip names reject before load.
Historical source headers advance to 10 without adding graphs to old assets.

Graph-only commands validate a proposed view before publishing it and preserve rig/
clip payload identities. They edit parameters/states/transitions/settings, remove
dependent edges on parameter/state deletion and forbid deleting the final state.
Unknown patch fields cannot replace stable identities. Rig clip rename rewrites state
references in the same atomic edit; referenced scene/rig clip deletion fails until
unlinked. Native Save/Open and invalid import isolation retain graph source exactly.
The optional Spine project adapter rejects active-owner native graphs explicitly.

This source increment does not execute graphs in the legacy editor/player pipeline.
Logic playback, pose blending, bindings, interactions and graph UI remain Phase 8 work.

## Portable Logic posing (Phase 8C1)

Core and @limber/runtime expose SceneLogicPlayer and RigLogicPlayer. They bake/cloned
graph and clip data, sample setup/entry without events and drive validated typed input
through the same bounded 120Hz clock. update(delta) returns accepted steps; held frames,
pause, reset, disabled graphs and dropped stall time do not emit events. snapshot and
recentChanges expose destination/blend/parameters and bounded debug metadata. The legacy
RuntimePlayer and editor animation queue remain unchanged; editor preview is not yet
connected to these adapters.

Scene poses resolve every transform/opacity channel against setup. Rig poses resolve
bone locals, slot colors, attachments/order and Deform, blend continuous channels from
the current pre-constraint animation snapshot, then solve FK/primary constraints and
secondary motion per tick. Skinning happens once per display update. Interrupted blends
freeze the actual current blend, rotation takes the shortest arc, and discrete channels
come from the destination. Both adapters retain state and the outgoing blend when
disabled, show authored setup while disabled, and restore the same blend on enablement.
Pause drops fractional time and rebases inertia. Reset retains playing/paused status.

Rig skin selection is instance-local and preserves source activeSkin. Optional injected
Skeletons must use the exact rig-owner source. In-place rebuild/replace publication
invalidates adapter pose buffers and requires a new player. Explicit resetSecondaryMotion
rebases inertia on the next held/advancing evaluation without resetting the graph.

Logic event samplers sort by time, retaining authored ties, deliver old-cycle end before
new-cycle zero, and include entry-zero keys on the first advancing step. Integer state
ticks and relative seam handling avoid duplicate held-frame delivery and binary .3/.1
seam loss. Events carry clip ID/name, cycle, key name/time and current number/string
payload. Limits are 512 keys/clip and at most 1000 loop cycles/fixed step. Callback input
is committed next step; reset/pause/disable cancels stale dispatch and recursive update
is rejected. At this increment typed payload records, bindings and editor graph/
interaction/debug preview were outstanding. It does not close Phase 8 or provide a .bbb.

## Explicit event payloads and schema 11 (Phase 8C2)

EventPayload accepts previous number/string scalars and explicit typed records with
exactly type/value: bool, float, int or string. Values validate without coercion;
numbers must fit finite Float32 range, int is signed 32-bit, string length is at most
4096 UTF-16 units. Typed floats canonicalize on emission, keeping source precision.
Events retain stable names (1–128 characters); source libraries cap each clip at
512 keys across event timelines. Payload records bake and emit as isolated copies.

Native scene/rig clips validate events before publication, including dormant clips;
graph loops validate the maximum 1000 cycles/fixed step during source load/editing.
Existing source headers advance to 11 without rewriting valid scalar payloads. Both
timeline composers offer explicit types and editable generic event templates. Invalid
drafts disable keying; commands validate before mutation and preserve exact history,
including fixed rig key time and preceding clip duration. Typed payload compatibility
export fails explicitly. Logic, SceneClock and legacy RuntimePlayer emit the same typed
values without changing the legacy players' time-zero/queue ordering. No audio/haptic
side effects execute automatically. Bindings and Logic UI/interaction/debug remain.

## One-way bindings and schema 12 (Phase 8D)

SceneLogicPlayer accepts optional component definitions and projects committed typed
parameters onto exposed instance text/string, visible/bool, opacity/float and tint/int
after animation and before component expansion/layout. Direct artboard text binding
names resolve string parameters from the same graph. Values are transient copies;
source text, definitions, stored overrides and animations remain unchanged. Opacity
inputs must be in [0,1], tint in [0,0xffffff]; invalid values reject before enqueueing.
Float values canonicalize to binary32. Duplicate writers are rejected. Disabled Logic
returns authored setup and retains state and pending input. Definitions are cloned/baked.

Bindings belong to artboard graphs; rig graphs cannot reference scene instances. Native
validation resolves exposures and direct names even when the graph is disabled. Without
a graph direct names are dormant. Parameter rename/delete and scene duplicate/delete
preserve valid references with exact history. Destructive exposure changes/extraction
are blocked with migration diagnostics. Headers advance to 12; graph editing/interaction
preview and debug UI remain for the next Phase 8 increment.

## Typed interaction routes and schema 13 (Phase 8E1)

SceneLogicPlayer and RigLogicPlayer expose dispatch(event,targetId), sharing a portable
LogicInputRouter. Signals are pointerDown/Up/Enter/Leave, click, focus, blur and test.
Null target means the owner viewport; artboard routes can target their own scene nodes,
while rig routes accept only null. Routes reference stable parameter IDs; non-trigger
values must match the declared type and every bound property domain. Trigger routes
omit value and fire. Matching routes queue in authored order, as one atomic batch with
full type/domain/capacity preflight. The queue remains bounded to 1024 waiting writes.
Paused/disabled input is retained; reset clears input and receipt history. Trace copies
contain tick, sequence, signal, target, route IDs and inputs, bounded to 256 receipts
and 1024 total writes. Structural deletion/duplication and parameter history preserve
valid references. Native validation includes disabled graphs; source advances to 13.
Visual graph authoring, pointer/focus preview delivery and debug overlay remain separate.

## Editor parity adapter (Phase 8E2)

LogicPreviewSession uses cloned native source and the same SceneLogicPlayer/RigLogicPlayer
as the portable runtime. Artboard preview evaluates its scene graph plus independent
rig graphs; a rig owner tests its viewport routes independently. Source edits and owner
changes construct fresh paused sessions. Test inputs never enter undo/source history.
Raw editor clocks pause when entering Logic, and clips/setup remain untouched.
Paused debug Step advances one accepted 120Hz tick without rebasing secondary motion,
then remains paused. Repeated Steps match continuous accepted ticks, including spring
poses and events. Explicit Pause retains its documented inertia-rebase policy.

The cached Pixi adapter consumes bound views before layout and posed skeleton vertices
after all constraints. Hidden displays can be revealed without rebuilds; text rasters
change only with content/style/box. Slot geometry, textures, ordering and clipping update
from the same pose buffers. Pointer delivery orders viewport then hit/captured node;
rig owners receive viewport signals once. Focus/blur and keyboard Enter/Space are
viewport inputs. Graph authoring validates before publication, and state drags coalesce
to one history command with cancellation. This adds no runtime file or schema bump;
the Phase 8 combined gate remains required before compiler/integration phases.
