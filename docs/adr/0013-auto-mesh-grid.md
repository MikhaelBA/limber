# ADR 0013: automatic grid mesh jobs

Status: accepted for Phase 6F.

Auto mesh starts from a region's TL/TR/BR/BL corners and UV pairs. Bilinear interpolation generates
a deterministic regular lattice with configurable positive integer subdivisions, perimeter and
triangle indices. The source quad and generated disk both pass portable topology validation.
The operation preserves transformed/reflected corners and cropped/flipped source UVs. It retains
transparent pixels: alpha tracing and outline simplification are not implemented by this grid tool.
The existing manually authored hull tool remains available.

Generation and topology validation run in a dedicated module Worker. The shared job runner owns
request IDs, progress validation, hard cancellation, startup/transport errors and cleanup. Progress
is limited to approximately one-percent increments to avoid flooding the UI for narrow tall grids.
The source rig fingerprint, project/rig identity and Setup mode must still match at publication.
Source input is copied, and successful results create one validated command with stable new IDs.

The new mesh preserves the original region attachment and its animation references. It updates
the selected slot's setup assignment or active skin override, matching the existing mesh creation
semantics. Undo restores exact source and redo restores the same mesh identity. Invalid dimensions,
geometry or stale results preserve source and redo. Switching mode/unmounting cancels the job.
Main-thread source publication costs remain part of the unfinished Phase 6 performance gate.
