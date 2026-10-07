# ADR 0004 Complete recovery generations

Status: accepted for Phase 1B, 7 October 2026.

Write each recovery generation to its own OPFS directory. Write texture blobs first and the manifest
last, closing every stream before publishing a pointer. Commit current/previous pointers together in
one IndexedDB transaction. Keep the last readable generation even if the current head is corrupted.
Cleanup never precedes the index commit. Serialized writes and origin-scoped Web Locks prevent a slow
old write or another tab from interleaving index updates.

When OPFS is unavailable or a write fails, commit the complete document-plus-blob record to IndexedDB.
Keep the existing Limber database so old recovery records remain discoverable. Recovery tries the
current generation, then the previous one, and reports when it used the previous snapshot. Uncommitted
partial OPFS directories are ignored. Best-effort garbage collection removes superseded committed
generations; orphan directories after forced termination need a later storage maintenance pass.

Capture serialized data before asynchronous work so queued saves cannot mix two document revisions.
Clear cancels pending debounce work and queues after an in-flight save. Opening/restoring a project
cancels stale debounce work. Storage failures notify the user to download a project instead of silently
claiming autosave success.

Browser fault tests cover exact texture bytes, failed index transaction rollback, unavailable OPFS,
corrupted current manifest, closing a tab during an unfinished write, and clear/debounce ordering.
This is a two-generation recovery design, not user-facing version history or an operation journal.
Full browser-process/OS termination and multi-device quota stress remain public-beta hardening gates.
