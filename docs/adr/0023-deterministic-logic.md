# ADR 0023: Deterministic Logic graphs

Status: portable parameter/state/transition kernel implemented in Phase 8A after
the Phase 7 gate. Phase 8B adds native schema 10 graph ownership, validation and
atomic authoring commands. Phase 8C1 implements portable scene/rig pose adapters and
chronological fixed-step event delivery. Phase 8C2 adds explicit typed event payloads,
source validation and scene/rig event authoring. Bindings, interaction and graph UI
below remain required later increments.
Sol 6.1 / High is appropriate.

## Model and ownership

One optional graph belongs to an artboard or a rig node. Both use the same portable
state/parameter evaluator. Artboard states reference scene clip IDs; rig states
reference existing animation names. A state may have no clip, representing setup.
Graph disablement bypasses logic without altering clips, tracks or setup assets.
Native artboard/rig `logic` is optional; absence means no graph. References and graph
identities are scoped to their owner, matching rig-local bone references. Graph copies
on distinct rig owners remain independent. Component-local graphs are unsupported in
v1. Renaming a rig clip updates its state references atomically; deleting a referenced
scene/rig clip is rejected until the artist unlinks it. Removing a parameter removes
dependent transitions entirely, preserving the meaning of remaining guards. Removing
a state removes its incident edges and chooses the first remaining state if entry was
removed; the last state cannot be removed. Graph removal keeps raw animation assets.
Native compatibility export explicitly rejects active-owner graphs.
Stable IDs identify parameters, states, transitions, bindings and preview input routes.
Names are unique within their category and are the external parameter API.
Nested graphs and layered state machines are later extensions.

Parameters are bool, finite Float32-range float, signed 32-bit int, string (at most
4096 UTF-16 code units), or trigger. SetBool/SetFloat/SetInt/SetString validate the
declared type before changing runtime state; Fire and ResetTrigger accept only
triggers. Triggers are latched booleans, not counters. Source stores explicit initial
values; a trigger always starts false. Unknown names and wrong values fail atomically.
Runtime float values and float condition literals canonicalize to IEEE-754 binary32
after range validation. Source retains authored numbers; evaluation compares the
canonical values so native `SetFloat` and Web agree at condition boundaries.
Reset restores defaults, entry state, zero time and empty debug/event buffers.
The kernel's `step()` advances one accepted tick. Setters enqueue up to 1024 pending
inputs; getters expose committed values. `snapshot()` and `recentChanges()` return
isolated metadata copies; debug history holds at most 64 changes. Disabling the
kernel freezes state and pending inputs, and reset restores authored enablement.
The adapter must separately discard the fractional clock when pausing/disabling.

## Fixed step and ordering

Run Logic on a portable 120Hz clock, accepting at most 100ms/12 steps per update and
retaining fractional time. The graph evaluator itself consumes exactly one fixed
step; adapters own display accumulation. Invalid/nonpositive delta accepts no time.
Pending input is committed at the next accepted step, in setter order. A recorded
stream attaches inputs to integer step indices, so display-frame grouping cannot
change behavior. No zero-delta transition execution or event delivery occurs.

At each step: commit inputs; finish a prior blend whose elapsed duration has reached
its bound; evaluate eligible transitions; select at most one; consume its triggers;
enter the destination at time zero; advance current state/blend by one step; sample
animation; apply bindings; evaluate primary constraints/secondary motion; emit crossed
animation events and bounded debug changes. Initialization/reset samples entry setup
without events. Time-zero events emit on the first advancing step after entry.

Transitions have unique nonnegative integer priorities; lower values win globally.
Eligible local edges originate at the active destination state; Any State edges have
no source. Their priority competes in the same list. Any State edges to the active
state are skipped and do not consume triggers. Local self transitions are invalid
in v1. Every condition is required (AND). No conditions means unconditional.
Bool/string accept equality/inequality, numbers also ordered comparisons; triggers
accept only `fired`. Conditions reference declared parameter IDs and typed literals.
Only triggers on the winning edge are consumed, together, after all guards pass.
Other latched triggers remain pending until consumed/reset. Failed candidates consume
nothing. No transition chaining occurs within a step.

Exit time is optional normalized [0,1], measured against the state's clip duration
since entry, regardless of looping. It means the first pass has reached that fraction,
not a repeated narrow loop window. Any State cannot specify exit time; no-clip states
cannot specify positive exit time. Exit guards sample the preceding completed step.
Incoming destination starts immediately and its time/conditions are authoritative
during a blend. Clip time loops or clamps according to the state's loop flag.

## Blending and interruption

Transition duration is finite 0–10 seconds. Zero duration switches immediately.
Nonzero duration snapshots the current evaluated local/view pose as the outgoing
pose, holds it, and blends toward the advancing destination pose. This supports
interruption without a visual discontinuity and avoids an unbounded mixer tree.
Continuous numeric channels blend linearly; rotation follows the shortest arc.
Discrete attachment/draw-order/visibility/text values come from the destination.
Both snapshots are fully resolved against setup so unkeyed properties cannot leak.
Primary constraints and secondary motion evaluate the resulting blended pose once.
State entry rebases angular inertia using the current blend sample.

An active transition's interruption policy is `none` or `higherPriority`.
`none` defers every candidate until blend completion. `higherPriority` permits only
a candidate whose numeric priority is strictly lower than the active transition's.
An interrupt freezes the current blended result as its outgoing snapshot, enters
the new destination and restarts blend elapsed time. There is no source-state search
or automatic return stack; artists author explicit return transitions. Debug view
shows the active destination, transition/progress, accepted tick and recent changes.

Only the destination clip crosses new event intervals; frozen outgoing poses emit
none. Logic events sort chronologically, with authored timeline/key order breaking
equal-time ties. The preceding loop's endpoint precedes the next loop's time-zero
keys; accepted steps preserve step order. This is an explicit Logic contract and
does not rewrite the legacy animation queue/mixer's event ordering. Pausing, reset, disabled graphs and dropped stall
time emit no events. Per-step event buffers must never duplicate held-frame output.
New authoring emits explicit `{type,value}` payload records: bool, Float32-range
float, signed 32-bit int or string up to 4096 UTF-16 units. Types do not coerce and
unknown fields/nested objects are invalid. Existing number/string scalars remain
supported. Authored float precision stays in source; emitted typed floats canonicalize
to binary32. Baking/emission copies records so listeners cannot change future events
or source. Every native scene/rig clip validates events even when graphless/unreferenced;
Logic eventful-loop limits also validate before import/authoring publication. Source
schema 11 adds these payloads. Compatibility export rejects typed payloads explicitly.

Both timeline event composers provide explicit type/value controls and editable
Footstep/AttackHit/SpawnProjectile/SFX/Haptic/UIConfirm starting templates. Invalid
drafts disable key creation; key commands validate again before mutation. Rig event
commands capture input/time and deep-copy payload history, restoring the preceding
clip duration on undo so later playhead movement cannot alter redo. This increment
does not automatically execute audio/haptic/game actions; consumers handle emitted
generic named events according to their game.

SceneLogicPlayer and RigLogicPlayer drive the shared clock/kernel without DOM or
renderer dependencies. Initialization/reset samples entry without events; each
accepted tick fully resolves destination channels against setup. Bone locals, slot
colors and Deform blend from the pre-constraint animation snapshot, then FK/primary/
spring run once per tick and skinning runs once per displayed update. Discrete slot
attachments and draw order select destination immediately. Zero-step updates resample
held animation and present spring state without advancing it. Pause clears fractional
time and rebases secondary inertia. Disable shows setup but freezes state/input/blend;
reenabling restores the same held blend without replacing its outgoing snapshot.
Reset restores authored enablement/default parameters/entry, retaining pause status.
Skin selection is transient per player, including injected editor skeletons, and
never changes source activeSkin. Structural publication invalidates injected pose
buffers; the editor must construct a new adapter before the next update. A target
skeleton must belong to the exact rig source passed to the adapter.

Each event sampler bakes at most 512 keys. Eventful loops require at least one
thousandth of a fixed step in duration, bounding delivery to 1000 cycles per step.
Time keys map to integer accepted ticks with relative floating-point seam handling;
tiny positive keys belong to the first advancing tick. Event callbacks enqueue inputs
for the next step. Callback reset/pause/disable stops stale dispatch and remaining
steps; recursive update is rejected. Public snapshots/debug data remain isolated.

## One-way bindings and interaction

Bindings write transient view values after animation and before layout/rendering.
They do not mutate source transforms, tracks, component overrides or undo history.
V1 binds typed parameters directly to explicitly exposed component-instance properties
(text/string, visible/bool, opacity/float, tint/int), without coercion or expression
evaluation. Opacity is bounded [0,1], tint [0,0xffffff]; incompatible values fail
atomically before parameter publication. Multiple writers to one exposure are invalid.
Deleting an exposure/instance/parameter removes or blocks its dependent binding with
an actionable diagnostic. Disabling logic restores the authored view immediately.
Existing text-node `binding` names are explicit direct-text bindings to same-graph
string parameter names. With a graph present, unknown/wrong-type names are validation
errors; without a graph they remain dormant authoring metadata. Component definition
text-binding annotations are dormant unless exposed/bound by an artboard instance.
There is no implicit lookup into globals or evaluation of the name as an expression.

Preview routes map a scene node or character viewport to pointer down/up/enter/leave,
click, focus/blur or a test control. Routes author a typed value or fire a trigger;
no code strings, network actions or source mutations. UI and native adapters deliver
these routes to the same input queue. Browser event ordering is recorded as received;
replay preserves its integer tick/sequence. Preview pause retains state/parameters;
resume starts with an empty fractional clock. Structural publication resets preview.

## Validation and acceptance

Reject malformed arrays/enums, duplicate IDs/names/priorities, nonfinite/range-invalid
coefficients, unknown entry/state/clip/parameter/property references, incompatible
conditions/bindings/routes and local self edges. Cycles of unconditional immediate
transitions are invalid (including Any State expansion); conditioned or positive
exit-time cycles are allowed and execute at most one edge per step. V1 graph caps:
128 parameters, 256 states, 1024 transitions, 32 conditions per transition and 256
bindings/routes. These are explicit bounded v1 limits, not release hardware budgets.

First prove the DOM-free parameter/graph kernel against independent trace goldens,
trigger priority/consumption, exits, interruption, cycle diagnostics and recorded
inputs split into different display frames. Then integrate source validation/commands,
scene and rig pose adapters, bindings, state graph UI, interaction and debug preview.
Keep each increment partial until its own gate passes. Phase 8 closes only after
native/history/disabled-logic parity, representative scene/character browser workflows,
full local checks and remote CI. Phase 9 follows that acceptance gate.
