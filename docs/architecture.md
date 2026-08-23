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
memory, the sandbox, settings, automations, and local workspace command execution. The local
command tool is deliberately serialized even for read-only commands so its run-scoped cwd and
process/stdin lifecycle cannot race. A cancelled run never starts a queued side effect.

### Workspace command tool

`workspace_run_command` is a root-Agent-only built-in tool. It is included by the chat tool
selector's automatic mode and can also be selected manually. Its input is structured JSON rather
than a shell string:

```json
{
  "executable": "rg",
  "args": ["--files", "src"],
  "cwd": "subdir",
  "env": { "NO_COLOR": "1" },
  "timeoutMs": 20000
}
```

The main process invokes `spawn(executable, args, { shell: false, stdio: ["ignore", ...] })`.
`cwd` must be relative to the conversation workspace and is persisted in the current Agent run's
metadata for the next call; `env` is allowlisted and applies only to that call. There is no
persistent `cd`, `export`, pipe, redirection, or interactive stdin protocol. Timeouts are clamped
to 1-60 seconds, output streams are bounded independently, and timeout/cancel/run-end cleanup
terminates the complete process tree (`taskkill /T` on Windows, process groups on Unix).

In automatic mode, known read-only invocations may run without approval. Writes, deletion,
installation, network, process/service, shell interpreters, and unknown commands require a new
approval for each call.
Malformed input, absolute/escaping paths, workspace symlink escapes, and missing cwd directories
are rejected. This risk decision runs before the built-in-tool approval bypass; `review_all` and
the Agent tool policy can still elevate a read-only command to approval. The approval and result
UI show the structured argv, relative cwd, risk, exit state, bounded output, and the following
warning: a workspace cwd is not an OS security boundary. A program can still access external
files, use the network, or start other processes.

Runtime steps and events retain `tool_id`, risk, approval decision, relative cwd, outcome, exit
code/signal, duration, byte counts, and truncation flags. They never persist complete command
output or environment values; command inputs, outputs, and audit summaries are redacted before
display or persistence. The existing `sandbox_run_command` remains a separate Docker/local
sandbox protocol and is not changed by this tool.

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
