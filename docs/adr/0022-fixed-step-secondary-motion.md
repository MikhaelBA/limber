# 0022 — Fixed-step angular secondary motion

Status: implemented in Phase 7E2 with source schema 9. Local and remote acceptance
are recorded in PROGRESS.md; Phase 7 closes only after the complete remote gate.

Implement restrained angular spring/inertia presets. World +X heading is the target
after animation/FK/primary constraints. Preserve pivot, scale, shear and length;
derive local rotation through the evaluated parent inverse and authored signed/sheared
X basis. All target headings sample before secondary writes. Secondary parents run
before children. These are post-primary overrides, never iterative feedback into
primary constraints. This feature does not simulate cloth, collision, gravity or
linear pivot inertia.

## Portable kernel

`advanceDampedSpring` solves the constant-target ODE
`x'' + 2*zeta*omega*x' + omega^2*(x-target) = 0`, with `omega = 2*pi*frequency`.
One real trigonometric/hyperbolic solution covers under/critical/overdamping without
subtracting nearly equal exponential roots. At critical damping the sine ratio
limit is the step duration. Small arguments use a bounded sinc expansion. The
function mutates a reusable value/velocity record after validation of inputs/output.
Frequency is 0.1–20Hz, damping ratio 0–2 and step duration 0–0.1s; nonfinite/range or
overflow inputs fail without mutation. Zero steps and equilibrium hold exactly.

`FixedStepClock` returns a step count for 1/120s evaluation. Per-update accepted time
is capped at 0.1s, at most 12 steps. Retain fractional remainder; expose discarded
stall seconds for diagnostics. Nonfinite, zero or negative deltas contribute zero.
Clock time derives from the integer step count. A 1e-12s rounding allowance prevents
frame subdivision losing a whole step. Reset clears time, remainder and diagnostics.
The clock itself neither advances animation nor evaluates secondary motion.

Numerical verification includes independent analytical and fine RK4 goldens,
constant-target subdivision across the critical boundary, undamped energy, settling,
atomic rejection, 10/60/120/144/240/1000 display subdivision and 10000-frame drift.

## Playback integration contract

Optional source secondary constraints have globally unique IDs/orders and
run after primary constraints. Each controls one bone with a soft/bouncy/firm preset,
strength, max deflection and Advanced frequency/damping. Presets author explicit
coefficients; no runtime dependency on UI defaults. Creation/edit/delete/reorder
are Setup-only and atomic, and deleting a bone cleans references. Limit 128 per rig,
one spring per bone, strength in [0,1], max deflection in [0,pi]. Secondary orders
must follow every primary order and place ancestors before descendants. Creating
a primary constraint inserts it before secondary motion in the same transaction.

Target animation and primary constraints MUST sample once per fixed substep, not
once per display frame. Present the last completed fixed step without interpolation.
Cap accepted time after editor playback speed. Equal accepted elapsed time and the
same authored inputs must agree across display delta subdivisions. Differing cap
loss or external edit sequences are intentionally different accepted inputs.

Setup, paused preview, scrub/stop, clip switch, source publication and explicit
runtime reset rebase without lag. Pause discards fractional remainder; resume starts
from the current sample with zero velocity. Scrub previews the authored primary pose
and does not replay historical physics. Onion skin/static scene preview use the same
non-simulating policy. Runtime clip switches reset inertia even for crossfades. Rigs
without secondary motion retain the legacy clock/evaluator contract.

Collect events across actual fixed steps in step order, preserving mixer ordering
within a step. Initialization/rebase suppress events; dropped stall time and seek
fire no events. World angles unwrap by shortest delta at each step (rotations faster
than pi per step alias). Hold each sampled target over its step for the exact spring
integration. Clamp deflection and remove outward velocity at the bound. Singular or
collapsed required bases hold the sample and invalidate that spring until it becomes
valid. Nonfinite world output restores secondary rotations/world matrices and rebases.
Allocate motion buffers/backups on structural publication, never in the frame loop.

Integration acceptance requires animated-target frame subdivision parity, arbitrary
affine heading, parent/child springs, loop/fade/queue/event goldens, degeneracies,
native source/history/browser workflows and a profiled combined IK/follow/path/spring
fixture. Full local and remote CI must pass before closing Phase 7 and starting Phase 8.
