# Database, Conversation Lifecycle, And Migrations

This reference describes current persistence ownership and the contracts
around initialization, migrations, conversations, and batch writes. The runtime
tables and IPC snapshot shapes for Agent runs are described in
[`architecture.md`](../architecture.md#persistence).

## Ownership And Source Of Truth

- `apps/desktop/src/main/lib/schema.ts` defines SQLite tables and Drizzle
  relations. Checked-in migration SQL and metadata live in
  `apps/desktop/drizzle/`. The live database is created below Electron's
  `userData/data/ayaka.db`; it is not a repo fixture or committed artifact.
- `apps/desktop/src/main/lib/db.ts` owns database setup, migrations, seed
  behavior, and persistence APIs. Bounded aggregators or storage contracts may
  live in neighboring modules such as `message-store.ts` and
  `runtime-snapshot.ts`, but `db.ts` owns Drizzle read/write composition.
- The main process owns the live database connection. Renderer requests cross
  through the preload bridge; the main IPC handler validates external payloads
  before calling persistence.

## Initialization And Recovery

Opening a writable DB configures SQLite and applies checked-in migrations
before defaults/seeds run. Database initialization marks stale active Agent
runs from a prior process as interrupted, updates their in-flight steps, and
discards queued run inputs while preserving approval runs that can be resumed.
The recovery does not currently update `agent_instances` for stale parent runs,
so persisted `queued` or `running` child status can remain visible after process
restart even though the child no longer exists in memory.
Read-only access does not run migrations/seeds. The app entry point separately
recovers MCP lifecycle/dependency records before eligible startup restoration;
see the [MCP runtime reference](mcp-runtime.md). Database writer-worker
routing remains an internal detail of the main process; callers use typed
persistence functions.

Conversation soft-delete, restore, and workspace preparation/cleanup keep
their associated rows inside explicit transaction boundaries where the
individual operation must be atomic. Permanent deletion of one conversation
also removes its workspace row in one transaction. The current batch permanent
delete loops over IDs and runs one transaction per ID; therefore it can leave
earlier IDs deleted if a later ID fails. This is the implemented contract; do
not describe the batch as all-or-nothing unless its implementation and test
are changed together.

Queue messages and runtime child-instance recovery have their own lifecycle
contracts, documented alongside Agent runtime. Persisted status should agree
with the containing run after cancellation, startup recovery, or a retry.

## Message And Snapshot Contracts

- `saveMessagesBatch` accepts one conversation per batch. Validate each row,
  the conversation and message-ID ownership before writing; then upsert in one
  transaction and increment `conversations.message_revision` once. A mixed
  conversation, invalid row, missing conversation, cross-conversation ID, or
  write error must not leave a partial batch or revision change.
- `applyMessagesPatch` checks the conversation and optimistic base revision.
  Message hydration reads revision and message rows together so the renderer
  does not combine versions from separate reads.
- Chat uses conversation-scoped `agents:runtimeStatus` for high-frequency
  polling. The bounded result contains runs and selected-run records for that
  conversation; cold diagnostic collections remain on explicit full-snapshot
  paths. Both full snapshots remain available to their administrative callers.
- IPC schemas in `apps/desktop/src/shared/ipc-schema.ts` define the migrated
  contract. Parse at the main boundary and derive preload/renderer types from
  the shared schema where available. Legacy channels retain their established
  names/shapes until deliberately migrated.

## Schema And Migration Changes

For a schema change:

1. Edit `schema.ts` and its relations at the data-model owner.
2. From the repository root generate SQL with
   `vp run ayaka-desktop#db:generate`; inspect both SQL and metadata. Do not
   hand-edit an existing migration to represent a new schema change.
3. Apply the checked-in migration through the normal app migration path; test
   opening an empty database and the relevant seed/initialization behavior.
4. Test the changed persistence invariant with `AYAKA_USER_DATA_DIR` pointing
   at a temporary root. Never use a real user's data folder.
5. If IPC or runtime snapshots expose the field, update their contract and
   authorization/ownership checks in the same change.

Do not commit `.drizzle-dev`, DB files, WALs, real user-data directories,
generated `out` files, or secrets.

## Verification

- Focused DB/runtime tests are in `tests/desktop/main/lib/db-performance.test.ts`
  and adjacent owner modules. Use Electron-backed tests for SQLite paths that
  require the Electron ABI, according to the runner and scope in `AGENTS.md`.
- When changing DB schema, initialization, seed data, IPC ownership, or run
  recovery, validate fresh DB creation plus the specific read/write failure
  case. Report native ABI, Windows filesystem, or repository format-baseline
  limits with their actual command results.
