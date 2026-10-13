# Subsystem References

These references describe Ayaka's current architecture and observable
contracts where noted. Start with the closest reference, then follow its
source and test links; verify the implementation because documentation can
drift.

## Desktop runtime and persistence

- **Agent runtime and recovery:** [Architecture](../architecture.md) —
  [agent-runtime.ts](../../apps/desktop/src/main/lib/agent-runtime.ts),
  [agent-loop-session.ts](../../apps/desktop/src/main/lib/agent-loop-session.ts),
  [agent-coordinator.ts](../../apps/desktop/src/main/lib/agent-coordinator.ts);
  [agent-loop-session.test.ts](../../tests/desktop/main/lib/agent-loop-session.test.ts),
  [agent-coordinator.test.ts](../../tests/desktop/main/lib/agent-coordinator.test.ts).
- **Message persistence and scoped runtime/IPC:** [Architecture: persistence and IPC](../architecture.md#persistence) —
  [message-store.ts](../../apps/desktop/src/main/lib/message-store.ts),
  [runtime-snapshot.ts](../../apps/desktop/src/main/lib/runtime-snapshot.ts),
  [ipc-schema.ts](../../apps/desktop/src/shared/ipc-schema.ts);
  [ipc-schema.test.ts](../../tests/desktop/main/lib/ipc-schema.test.ts),
  [db-performance.test.ts](../../tests/desktop/main/lib/db-performance.test.ts).
- **Database initialization, conversation lifecycle and migrations:** [Database reference](database.md) —
  [schema.ts](../../apps/desktop/src/main/lib/schema.ts),
  [db.ts](../../apps/desktop/src/main/lib/db.ts); persistence tests are listed in the reference.

## Tools and execution

- **Workspace command:** [Architecture: workspace command](../architecture.md#workspace-command-tool) —
  [workspace-command.ts](../../apps/desktop/src/main/lib/workspace-command.ts),
  [workspace-command.test.ts](../../tests/desktop/main/lib/workspace-command.test.ts).
- **Local host execution and file editing:** [Architecture: local host execution](../architecture.md#local-host-execution-and-file-editing) —
  [local-execution-engine.ts](../../apps/desktop/src/main/lib/local-execution-engine.ts),
  [local-execution-engine.test.ts](../../tests/desktop/main/lib/local-execution-engine.test.ts).
- **Sandbox files, artifacts and previews:** [Architecture: generated previews](../architecture.md#generated-html-svg-and-application-previews) —
  [sandbox-agents.ts](../../apps/desktop/src/main/lib/sandbox-agents.ts),
  [sandbox-artifact-manager.ts](../../apps/desktop/src/main/lib/sandbox-artifact-manager.ts),
  [sandbox-preview-manager.ts](../../apps/desktop/src/main/lib/sandbox-preview-manager.ts),
  and the matching tests under `tests/desktop/main/lib/`.

## MCP

- **Runtime, transport, authentication and lifecycle:** [MCP runtime](mcp-runtime.md) —
  [mcp-lifecycle-manager.ts](../../apps/desktop/src/main/lib/mcp-lifecycle-manager.ts),
  [mcp-client-manager.ts](../../apps/desktop/src/main/lib/mcp-client-manager.ts),
  [mcp-config-manager.ts](../../apps/desktop/src/main/lib/mcp-config-manager.ts),
  [mcp-lifecycle-manager.test.ts](../../tests/desktop/main/lib/mcp-lifecycle-manager.test.ts),
  [mcp-client-manager.test.ts](../../tests/desktop/main/lib/mcp-client-manager.test.ts),
  [mcp-config-manager.test.ts](../../tests/desktop/main/lib/mcp-config-manager.test.ts).
- **Built-in preset format and maintenance:** [MCP presets](../mcp-presets.md) —
  [mcp-presets.json](../../apps/desktop/src/main/config/mcp-presets.json),
  [mcp-presets.ts](../../apps/desktop/src/main/lib/mcp-presets.ts),
  [mcp-presets.test.ts](../../tests/desktop/main/lib/mcp-presets.test.ts).

## Renderer component guide

- **Chat messages and stream behavior:** [Chat component guide](../chat-component.md) —
  [ChatView.tsx](../../apps/desktop/src/renderer/src/components/ChatView.tsx),
  [MessageList.tsx](../../apps/desktop/src/renderer/src/components/MessageList.tsx).
  Verify current behavior against source; renderer page tests and browser automation are intentionally out of scope.

## Maintaining a reference

- Update the owning reference in the same change when an observable contract,
  responsibility, trust boundary, state transition, failure mode, or supported
  verification path changes.
- Keep each current-state fact in one owning reference. Link to implementation
  files and tests rather than copying details that change often.
- For a new subsystem reference, explain purpose/ownership, source of truth,
  runtime path, state transitions, important constraints, failure and
  compatibility behavior, and supported verification.
- Design documents in `docs/superpowers/specs/` describe proposed or approved
  designs, not necessarily the code currently on `main`. Check the implementation
  before relying on them as current behavior.

## Describing and reviewing a change

1. Name the affected subsystem and the actual user/API/runtime entry point.
2. Explain the observable before/after behavior, including state, persistence,
   side effects, compatibility, and failure behavior where relevant.
3. Update the owning current-state reference if one of its contracts changed;
   state explicitly when an internal refactor preserves the contract.
4. Verify that tests or other direct evidence exercise the claimed behavior.
   List missing or environment-limited checks instead of implying coverage.
5. A documentation change describes the implementation; it does not replace
   tests, type checks, builds, or runtime evidence.
