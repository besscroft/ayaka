# MCP Runtime And Lifecycle

This reference describes MCP lifecycle and boundaries currently implemented in
the desktop main process. [MCP preset definitions](../mcp-presets.md) have their
own maintenance guide; this page covers how configured server instances run.

## Ownership And Source Of Truth

- Server configuration, enabled state, lifecycle state, managed runtime
  versions, dependency-install records, and secrets are stored in the desktop
  database. `apps/desktop/src/main/lib/schema.ts` defines their schema.
- `mcp-lifecycle-manager.ts` is the per-server lifecycle coordinator.
  `mcp-client-manager.ts` owns MCP client/transport connections. Dependencies,
  runtimes, import/export and OAuth each remain in their owning main-process
  modules; renderer callers use IPC.
- Remote `http` and `sse` configurations describe client connections to an
  existing remote service. Ayaka does not install or manage that remote
  service. Stdio configurations may use a user-provided command or an
  explicitly installed package dependency.

## Runtime Selection And Installation

- Stdio server startup uses a managed Node/uv runtime when the configured
  command is a supported runtime launcher and one is installed; otherwise it
  may use the corresponding executable on `PATH`. Electron itself is never an
  MCP Node runtime.
- Managed runtimes are versioned below the app's user-data runtime directory.
  A running server keeps its resolved executable when another runtime version
  is installed; removal is refused while the runtime is in use.
- Runtime installation is an explicit user action. The installer validates a
  manifest, archive target paths, and SHA-256 before atomically installing the
  runtime. It does not execute vendor install scripts, install Python, or
  modify PATH. See [Runtime settings and installation](../mcp-runtime.md) for
  the platform/manifest details.
- `apps/desktop/src/main/lib/mcp-command.ts` recognizes safely parsed
  `npx`/`uvx` package invocations.
  Ambiguous command forms are left unchanged and require confirmation rather
  than being guessed. Package dependencies are installed only from the
  explicit dependency action and into a server-specific directory; install
  scripts are disabled unless the user authorizes them.

## Start, Recovery, And Stop

1. A tool call, discovery, explicit start, or the eligible application-start
   restoration path may request a connection. Disabled servers remain stopped.
2. Before stdio starts, Ayaka checks that the required runtime/dependency is
   ready. Incomplete cases are surfaced as `needs_runtime`, `needs_install`, or
   `needs_confirmation`; start does not silently install dependencies.
3. A start is serialized per server. On success the main process stores the
   running state and only then invokes registered post-start hooks. Those hooks
   run outside the per-server lifecycle lock so they may discover tools
   without deadlocking startup.
4. An unexpected stdio process exit schedules bounded reconnect attempts only
   while its persisted desired state is `running`. The manager reacts to its
   close event and updates the run state; it does not independently own an OS
   PID retry loop. Remote transports are marked stopped on close and do not
   auto-start a remote service.
5. On application restart, recovery clears stale in-process lifecycle state;
   it does not connect every configured server. Only enabled stdio servers
   with installed dependencies qualify for the existing optional/startup
   restoration entry point. Disabled, remote, or incomplete servers remain
   lazy until requested.
6. Stop clears retries and closes the client connection. Application shutdown
   unsubscribes lifecycle events and closes all active MCP connections.

## Secrets, Imports, And Failure Behavior

- Decrypted MCP/Skill secrets stay in the main process. Renderer IPC, logs,
  diagnostics, tests, and preset metadata must not expose plaintext secrets.
  Presets refer to user-entered encrypted values using `$secret:NAME`; install
  always leaves a new instance disabled until reviewed and enabled by the user.
- Remote HTTP MCP endpoints require HTTPS unless they target localhost/loopback.
  Import accepts a documented subset of Claude JSON and Codex TOML, previews
  unsupported fields, merges instead of deleting existing servers, and imports
  servers disabled. See [`mcp-runtime.md`](../mcp-runtime.md) for details.
- Start failures are classified into actionable lifecycle states and are
  recorded as runtime events. Stdio stderr is bounded. MCP errors are redacted
  against configured server secrets before being shown or logged.
- Recovery of a persisted dependency operation left in `installing` marks it
  interrupted/failed with a retryable diagnostic rather than assuming the
  external package manager finished.

## Verification

The backend tests for these contracts live under `tests/desktop/main/lib/`:
[`mcp-command.test.ts`](../../tests/desktop/main/lib/mcp-command.test.ts),
[`mcp-client-manager.test.ts`](../../tests/desktop/main/lib/mcp-client-manager.test.ts),
[`mcp-lifecycle-manager.test.ts`](../../tests/desktop/main/lib/mcp-lifecycle-manager.test.ts),
[`mcp-config-manager.test.ts`](../../tests/desktop/main/lib/mcp-config-manager.test.ts), and
[`mcp-presets.test.ts`](../../tests/desktop/main/lib/mcp-presets.test.ts). Run only the permitted main/Electron groups from
`AGENTS.md`; there are no desktop renderer page tests for MCP screens.

Update this reference in the same change when runtime ownership, startup or
recovery triggers, authentication boundary, transport compatibility, secret
handling, failure classification, or user-visible MCP lifecycle states change.
