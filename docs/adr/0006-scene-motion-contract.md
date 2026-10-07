# ADR 0006: Scene Motion Alpha contract

Status: proposed for Phase 3; implementation waits for the Phase 2 CI gate.

Scene clips belong to an artboard and target scene node IDs. Retain the existing skeletal animation format inside rig nodes; do not reinterpret bone IDs as scene IDs. Numeric scene tracks cover transform channels and opacity, reusing the existing tested stepped/linear/cubic interpolation. The graph editor and dopesheet edit the same keys. Clips, tracks and keys have stable IDs so moving keys never changes selection identity.

Introduce project schema 2 for scene clips. The reader migrates native schema 1 in memory, preserving artboards, nodes, rigs, IDs and assets. Historical fixture files stay immutable; migration tests compare every original field and the explicit new defaults. Save writes the current schema to a new download; it never overwrites the imported source. Unsupported future schemas still fail before replacing the open project. This is not the runtime `.bbb` format.

Before the first numeric key, retain the setup property. At and after the last key, hold its value. Curves belong to the outgoing key; Bezier X handles stay in [0,1], Y handles allow overshoot. Opacity is clamped only when evaluated for rendering; authored numeric curve data remains unchanged. Each clip permits one track per node/property. Keys are ordered by time and duplicate times on one track are rejected or replaced explicitly by the key command.

The portable clock consumes seconds. Scrubbing clamps to the clip duration, displays the exact endpoint and emits no runtime events. Forward playback emits events in (previous time, current time], with initial time-zero events emitted once when playing from the start. Loop boundaries emit end events before the next loop's zero events. Same-time events use their explicit array order. Pausing retains position; stop rewinds and clears pending events. Non-looping playback stops at the endpoint. Tests must cover multiple wraps and exact boundaries before runtime reuse.

Scene preview owns a transient clock outside React. The renderer receives evaluated transforms/opacity; source setup values are never overwritten by playback. Persistent key edits use project-scoped commands. Auto-key is explicit and visibly enabled/disabled; manual keying remains available. Multi-key move/duplicate/delete/time-scale operations commit atomically and keep IDs on moves, with fresh IDs on duplication. Cancellation leaves the source untouched.

The gate fixture imports two images, keys transforms and opacity, edits easing, previews, saves and reopens with identical sampled output. Existing character timelines and all prior source/recovery fixtures must continue to pass. This milestone does not add transition blending or state machines.
