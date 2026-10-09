# ADR 0010: Setup mesh topology and atomic editing

Status: accepted; Phase 6 remains in progress.

A mesh is a single triangle disk with a simple boundary, finite distinct vertex pairs and matching finite UVs. Every vertex belongs to a nondegenerate face. Interior edges have two oppositely oriented adjacent faces; boundary edges form one closed ring matching the authored hull. Absolute triangle area must equal boundary area. Holes, disconnected islands, duplicate positions, self-intersections, overlapping edges, missing faces and unmatched UVs are rejected before load/publication. Near-degenerate tests use a scale-aware area tolerance. Collinear forward boundary vertices are supported.

When an existing mesh omits meshHull, infer the boundary from its faces without rewriting source. New triangulation without a hull interprets the supplied vertices as the ring. Constrained triangulation explicitly excludes exterior faces; sort and orient generated triangles canonically. The cdt2d dependency lives behind the separate mesh/triangulate entry point; the core validation entry point does not import it.

Grid/hull creation and vertex insertion/removal validate private rig snapshots before installation. Vertex-count changes remove incompatible Deform tracks using the existing editor policy; the geometry, UVs, weights, hull and exact prior tracks restore together on undo. Invalid changes do not affect source, pose or redo. Removing a boundary vertex that strands an interior point on/outside the new boundary is rejected rather than silently repairing other vertices. Position-only setup drags retain same-count Deform tracks and publish only valid candidates. Viewport failures appear in the status bar and retain the last valid preview.

These checks validate setup geometry. Sampled animation and skinning may legitimately fold a mesh and are not subjected to setup topology rejection each frame. Full Deform input validation, explicit bind-pose skinning, worker jobs, linked meshes and Heavy performance remain later Phase 6 increments. Validation currently costs O(triangles + hull squared); fixture profiling must measure this before the full phase gate.
