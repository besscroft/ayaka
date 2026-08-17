# Permanent Agent Deletion Soul File Cleanup

## Problem

Permanently deleting an archived agent removes its database record, but the
agent's per-agent soul file can remain on disk when SQLite writes are routed
through the writer worker. Archive/restore must continue to preserve the soul
file.

## Design

Keep the permanent deletion entry point in `apps/desktop/src/main/lib/db.ts`,
but separate database-row deletion from filesystem cleanup. When the main
process uses the SQLite writer, it sends a database-only deletion command to
the worker and, after that command succeeds, removes the agent's soul file in
the main process. Direct non-worker deletion uses the same ordering locally.

The existing storage helper remains the single filesystem implementation. It
removes the primary `SOUL.md.enc` file and its `.bak` file, treats missing
files as already clean, and invalidates the main-process soul cache. No
database schema, IPC contract, archive behavior, or restore behavior changes.

## Error handling

Database deletion must complete before file cleanup begins. Filesystem errors
continue to be surfaced to the caller and recorded as the existing diagnostic
event when possible. Cleanup remains idempotent for already-missing files.

## Testing

Keep the existing direct deletion coverage and add regression coverage for a
permanent deletion routed through the SQLite writer. The routed case must
assert that both the primary and backup soul files are absent after deletion;
the archive/restore test continues to assert that those files are preserved.
