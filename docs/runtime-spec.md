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
