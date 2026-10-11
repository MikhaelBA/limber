# ADR 0026: Practical weight authoring

Date: 2026-10-11. Status: accepted.

The existing Weights brush changed one bone at a time and hid important editing behavior. The user requested the workflow described by the [Spine Weights guide](https://en.esotericsoftware.com/spine-weights), with a practical facial performance example.

## Decision

Keep the existing normalized linear blend skinning and immutable bind matrices. Add Direct and proportional Add/Remove/Replace, group bone selection, vertex selection, feather, identity-based clipboard, per-attachment locks, selected influence visualization, binding order and dominant-bone triangle overlap. Continuous gestures own one history entry. Direct/brush edits work during Animate/playback and never author animation keys. Geometry changes and binding capture remain Setup operations.

Auto uses an original deterministic geodesic solver over the triangulated mesh and path/polygon edges, rather than vertex-to-bone distance alone. Each connected component seeds each bone at its closest vertex; shortest edge distances produce normalized inverse-square influences. It respects selected vertices/bones and locked budgets during publication. The reference guide does not publish Spine's automatic-weight formula; numerical equivalence to its proprietary solver is not claimed.

Smooth traverses only hull and explicit internal authoring edges. Auto remains cancellable in a worker; stale results cannot publish. Prune previews actual posed geometry and GPU colors without modifying serialized source, reports removal counts, preserves locks, and can publish several selected meshes as one transaction. Weld copies nearest shared-bone weights, with an optional 0.01 rig-unit overlap tolerance and at least two common bindings. Swap rejects locked targets.

Optional source-only `weightLocks` and `weightEdges` retain authoring intent. Locks and manual smoothing edges are excluded from native export. Binding order survives native export and controls triangle ordering in both renderers. Duplicating a bone subtree copies owned slots, attachments, paths and relevant animation tracks, remapping copied influences by bone identity while preserving references to uncopied bones.

Paths retain cubic source segments, with optional normalized control-point weights and bind matrices. Shared endpoints have identical influences. Their sampler skins controls before measuring and following the curve; constraints read all influence bones and reject dependency feedback. Cached control matrices avoid resampling an unchanged weighted path. Bounding boxes and clipping polygons use the same skinning kernel. Path topology edits preserve or interpolate endpoint influence rows.

The four-clip example embeds unchanged generated base/feature images. Viseme/lid/expression attachment tracks, localized weights and falling tears produce recognizably different facial performances. Native raw playback canonicalizes fixed-step sample times after loop reduction so stepped mouth shapes switch on their exact authored ticks.

## Acceptance

Portable numerical tests cover locks, proportional redistribution, topology-aware Auto, manual-edge Smooth and triangle order. Editor commands cover exact history, group brushes, clipboard identity/counts, batch prune, binding updates, welding, duplicated influence remapping and weighted path/bounding-box/clipping native transport. Real browser gates cover pointer editing, GPU overlay and preview, Animate isolation and four facial clips in development and production. The example compares 2,040 native/editor frames with zero visible vertex error and proves a nonzero weight contribution in every clip. Full acceptance counts are recorded in PROGRESS.md after execution.

This is an expansion of the existing mesh/animation tooling. It does not start Phase 10 Unity work.
