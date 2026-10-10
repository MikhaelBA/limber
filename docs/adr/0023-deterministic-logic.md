# ADR 0023: Deterministic Logic graphs

Status: portable parameter/state/transition kernel implemented in Phase 8A after
the Phase 7 gate. Source remains schema 9; ownership, pose adapters, bindings,
interaction and graph UI below are required later increments, not delivered yet.
Sol 6.1 / High is appropriate.

## Model and ownership

One optional graph belongs to an artboard or a rig node. Both use the same portable
state/parameter evaluator. Artboard states reference scene clip IDs; rig states
reference existing animation names. A state may have no clip, representing setup.
Graph disablement bypasses logic without altering clips, tracks or setup assets.
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
none. Event order follows the existing per-clip timeline order and loop seam policy;
accepted steps preserve step order. Pausing, reset, disabled graphs and dropped stall
time emit no events. Per-step event buffers must never duplicate held-frame output.
Typed payload strengthening belongs to this phase's event increment.

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
