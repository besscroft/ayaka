# Ayaka Architecture

Ayaka uses one execution model for chat, automations, skills, and child agents: an outer
`AgentLoopSessionManager` owns the run while the AI SDK `ToolLoopAgent` performs one ReAct step at
a time.

## Runtime

Each `AgentLoopSession` owns a `runId`, an abort signal, the coordinator and runtime recorder,
budget counters, and two persisted FIFO input queues. User messages are `steering`; internal
automation, tool, and system messages are `follow_up`. After a step, steering is consumed first,
then follow-up. A run ends naturally only when the model has no tool calls and both queues are
empty.

Root defaults are eight turns, 50 tool calls, and ten minutes. When a budget is exhausted, tools
are disabled for one final response and a `budget` event is recorded. Approval pauses retain the
same `runId`; cancellation, errors, aborts, and application shutdown are hard stops. Startup marks
unfinished runs `interrupted` and discards queued inputs without replaying side effects.

`RunToolScheduler` allows known read-only tools to execute concurrently and serializes writes to
memory, the sandbox, settings, and automations. A cancelled run never starts a queued side effect.

## Persistence

`runtime_runs` stores origin, status, finish reason, usage, and the final summary. `agent_run_inputs`
stores the input kind, source, JSON message, sequence, lifecycle status, and discard reason. The
`(run_id, status, sequence)` index provides FIFO reads. Runtime events use `agent`, `loop_input`,
`skill`, `budget`, `tool`, and diagnostic kinds.

The development database is intentionally greenfield. The initial Drizzle migration contains no
legacy execution tables or compatibility columns.

## Boundaries

Agents own identity, model policy, handoff policy, memory, and tool selection. Skills provide
instructions, input schema, configuration, trigger words, and approval policy. Activating a skill
returns structured instructions; the session decides subsequent tools, handoffs, memory writes,
and stopping.

Chat sends `POST /api/chat` with `runId` and `mode` (`start` or `resume`). During an active run the
renderer sends `runtime.enqueueInput` and keeps the message editable. `runtime.cancelRun` aborts
the same session. Model, reasoning, and tool settings are captured at run start and apply to the
next run only.

## Recovery

The main process interrupts active sessions before closing. On the next startup, persisted active
runs become `interrupted` and queued inputs become `discarded`. The content and diagnostics remain
available for inspection, but no model call or tool side effect is replayed automatically.

## MCP runtime boundary

MCP configuration is persisted in `tool_servers` and normalized by the main process. Stdio servers
are lazy-started by the MCP lifecycle manager and are always spawned through an external Node or uv
runtime. Managed runtimes live under Electron user data, take priority over `PATH`, and are versioned
so upgrades do not interrupt an existing server. HTTP and SSE entries represent local client sessions;
Ayaka does not start or stop their remote service.

The uv managed runtime is a pair of external `uv`/`uvx` binaries downloaded only after an explicit
user action. A bundled, SHA-256-pinned manifest covers supported Windows, macOS, and Linux targets;
Linux targets are separated by glibc or musl. Custom HTTPS manifests are supported as an advanced
source and fall back to the bundled/official source when unavailable. The installer never executes
Astral shell/PowerShell installers, uses Electron's executable, changes PATH, or installs Python as
part of the uv runtime action.

Runtime state, dependency installation state, and runtime preferences are persisted separately from
the MCP definition. This keeps configuration, executable selection, and process lifecycle independent
while allowing the existing MCP ToolSet, approval policy, OAuth, and runtime event records to remain
the single Agent integration path.
