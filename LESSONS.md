# Lessons From Ayaka Changes

This file records concrete failure patterns seen in this repository, not
general advice or unverified hypotheses. Add entries when a diff, test, issue,
or review demonstrates a specific failure and a useful prevention rule. Keep
the lesson's evidence and preventive check together. Permanent rules belong in
[`docs/code-standards.md`](docs/code-standards.md); this log keeps the
repository-specific evidence behind them.

## Current lessons

### Local execution must preserve compatibility and approval guardrails

- **Rule:** When a capability is moved to a shared executor, trace every
  compatibility entry point too. The old adapter must not retain a weaker
  approval path or bypass the new executor's path and risk checks.
- **Evidence:** The implementation pass found that the compatibility command
  still used its old approval path, and its tool setting could disable
  review even for command classes that require it. The adapter and guardrail
  were moved to the main-process `LocalExecutionEngine`, retaining workspace
  scope, cwd, and its legacy result shape. The approved design explicitly
  retained that compatibility contract.
- **Prevention:** Cover both `local_*` tools and `workspace_run_command` in
  approval, risk-classification, scheduling, and path-scope tests. Current
  behavior is described in
  [`docs/architecture.md`](docs/architecture.md#local-host-execution-and-file-editing).
- **Provenance:** `docs/superpowers/specs/2026-10-07-local-execution-engine-design.md`,
  `f1d37d2`, and focused tests in
  `tests/desktop/main/lib/local-execution-engine.test.ts` and
  `workspace-command.test.ts` (2026-10-07).

### Parent-run recovery does not reconcile persisted child instances

- **Rule:** When recovering an interrupted parent run, reconcile the persisted
  Agent instance states owned by that run as well as its run, steps, and queued
  inputs; otherwise a child can appear live in diagnostics after its process
  has disappeared.
- **Evidence:** `cancelStaleRuntimeRuns()` updates stale runs, their in-flight
  steps, and queued inputs. `agent_instances` is a separate persisted table,
  and no update to its `queued`/`running` rows appears in that recovery
  transaction. Runtime status snapshots include instances for the selected run.
- **Prevention:** If fixing the gap, update only child records attached to the
  stale run in the same transaction, and test both stale active parents and
  resumable `waiting_approval` parents that should be preserved.
- **Status:** Confirmed source-level gap. This workflow-doc change does not
  modify the runtime or provide the missing recovery test.
- **Provenance:** `apps/desktop/src/main/lib/db.ts` (`cancelStaleRuntimeRuns`,
  `agentInstances`) and `runtime-snapshot.ts`, verified 2026-10-13.

### Re-derive derived runtime summaries when their source set changes

- **Rule:** When a displayed runtime summary is derived from more than one
  record collection, update the derivation when a new source is added; do not
  silently keep counting only the original collection.
- **Evidence:** The tool-call count was originally derived from runtime steps.
  A later change logged relevant tool calls in both steps and runtime events,
  so the direct step-only filter could undercount. The derived selector now
  reads both sources.
- **Prevention:** When an event producer or persistence shape changes, search
  and test the consumers that aggregate those records, including deduplication
  where both sources can describe the same call.
- **Provenance:** `d5ed1be` (2026-10-13), which adds the derived count helper.

### Prompts and copy must state each tool's actual boundary

- **Rule:** When neighboring tools do related but distinct work, describe the
  exact input/output and handoff between them in tool metadata and the Agent
  instructions; do not imply browsing or capabilities a tool does not have.
- **Evidence:** `web_search` discovers sources and returns summaries/links;
  `web_open` reads accessible text from a supplied URL and is not interactive
  browsing. A recent update aligned metadata and instructions with that split.
- **Prevention:** Test tool descriptors/prompt instructions as well as the
  host executor; verify output claims against the implementation.
- **Provenance:** `210edb6` (2026-10-13) and
  `tests/desktop/main/lib/chat-tools.test.ts`.

### Streaming metadata visibility follows visible activity

- **Rule:** During assistant streaming, do not show message-time metadata above
  the separate waiting state while the assistant has produced no visible text,
  reasoning, renderable activity, or generated UI. Once content/activity
  appears, preserve the timestamp behavior.
- **Evidence:** The renderer fix gates the timestamp on actual streamed message
  activity rather than the generic streaming flag alone.
- **Prevention:** For a UI metadata predicate, consider the empty/in-progress
  state and every independently renderable part, not just text length.
- **Provenance:** `c9a89f9` (2026-10-10),
  `apps/desktop/src/renderer/src/components/MessageList.tsx`.

## Maintaining this file

- Add an entry only when repository evidence shows the failure. Record the
  affected behavior, preventive rule, concrete test/check, and date/commit
  where available.
- Do not infer occurrence counts or a history of recurrence from one commit.
  Revisit lessons when the area changes; add new evidence when an independent
  change confirms the same pattern.
- Move broadly applicable rules to `docs/code-standards.md` only after
  repeated, independently verified evidence and maintainer review. Keep
  Ayaka-specific details and concrete cases here.
- Correct or remove a lesson when current source/tests contradict it. Lessons
  never override `AGENTS.md`, the implementation, tests, or the owning
  subsystem reference.
