# Unified Local Execution Engine Design

**Date:** 2026-10-07
**Status:** Design approved by user; implementation in progress

## Goal

Give the root agent a reliable main-process capability for running local commands and reading or editing arbitrary local text files. Keep permissions, cancellation, runtime records, model results, and renderer presentation on a consistent path while preserving the separate sandbox model.

## Non-goals

- Do not map sandbox paths to host paths or change sandbox execution and preview behavior.
- Do not expose filesystem access from the renderer or add renderer-to-main file-operation IPC.
- Do not add background process handles, snapshots, restore, or rollback UI.
- Do not use shell commands as the normal way to create or edit files.
- Do not add a database schema migration; use existing runtime steps, events, run metadata, and tool records.

## Architecture

Add a main-process `LocalExecutionEngine` responsible for path resolution, command lifecycle, text file operations, write coordination, risk classification, and normalized errors. Root-agent tools validate structured input, pass through the existing scheduler and approval callback, invoke the engine, and return structured JSON results. Renderer code only displays tool input, approval state, and result summaries already carried through the chat/runtime protocols.

```text
ToolLoopAgent
  -> structured local tool input
  -> main-process validation and canonical path resolution
  -> risk and permission evaluation
  -> RunToolScheduler
  -> LocalExecutionEngine
  -> structured result + runtime step/event
  -> AI SDK UI message + localized renderer summary
```

The existing `workspace_run_command` remains a compatibility tool. It delegates execution to the same command engine with its existing conversation-workspace path restriction and retains its existing tool id and output shape. New `local_*` tools can operate on any valid local path. Sandbox tools remain isolated.

## Tool contracts

All tools are registered in the root agent through the current `CHAT_TOOL_IDS`, descriptors, runtime defaults, and tool-selection flow. Inputs are validated in the main process as well as by the AI SDK schemas.

### `local_run_command`

- **Input:** `executable`, `args[]`, and optional `cwd`, `env`, `timeoutMs`.
- **Behavior:** Execute argv directly with `shell: false`. Preserve the current 20-second default, 60-second maximum, bounded stdout/stderr capture, environment allowlist, timeout, abort, and process-tree cleanup. Persist the run's current directory for later relative paths.

### `local_read_file`

- **Input:** `path`, optional inclusive `startLine`/`endLine`, and optional `maxBytes`.
- **Behavior:** Read UTF-8 text with a bounded response, line numbers, truncation state, and hash of returned text. Reject binary or invalid UTF-8 input with a structured error.

### `local_write_file`

- **Input:** `path`, `content`, and optional `expectedHash`.
- **Behavior:** Create or replace a UTF-8 text file using a same-directory temporary file and atomic replacement. If `expectedHash` is supplied, fail with a conflict when the current file does not match.

### `local_edit_file`

- **Input:** `path`, `oldText`, `newText`, and optional `replaceAll` and `expectedHash`.
- **Behavior:** Replace an exact text match. Require exactly one match by default; replace all only when explicitly requested.

### `local_apply_patch`

- **Input:** A multi-file patch using `*** Begin Patch`, `*** Add/Update/Delete/Move File`, context lines, and `*** End Patch` directives.
- **Behavior:** Parse the entire patch, resolve every target, and validate every operation before writing. Stage changes first and commit the set together with rollback on commit failure. Return a structured conflict if a target or context changed.

Relative local paths resolve from the current local execution directory. A new run starts in its conversation workspace; successful `local_run_command` calls update that directory. File operations do not change it. Absolute paths are accepted on the host platform. Tilde and environment-variable expansion are not performed.

Initial limits are 64 KiB of command stdout and stderr each, 64 KiB default and 256 KiB maximum returned text per read, 1 MiB per edited file, and 256 KiB per patch. Read ranges are one-based and inclusive. UTF-8 BOM and existing newline style are preserved by file mutations. Limits are centralized in the engine.

Reads also have a 32 MiB source-file ceiling, even when a requested line range or response limit would return less text. The engine reads and validates the complete source before selecting the requested range.

### File safety and concurrency

- Resolve an existing target through its real path. For a new target, resolve the nearest existing parent and append the remaining path segments. Reject NULs, invalid paths, non-regular file targets, directories, device files, and path-resolution failures.
- Arbitrary host paths are allowed; there is no conversation-workspace containment check on `local_*` tools. The compatibility workspace command continues to enforce its current workspace root.
- File mutation resolves symlinks to the underlying target before staging so replacement does not silently replace a link instead of the intended file.
- Serialize mutations by canonical path within an agent run. For multi-file patches, acquire locks in sorted canonical-path order to avoid deadlocks.
- Patch application validates every operation before mutation. If a commit fails after one or more replacements, restore already-replaced files from staged originals. If rollback itself fails, return a distinct partial-commit error and record every affected path.
- File mutations are limited to UTF-8 text. Binary files remain unsupported by these tools.

## Results and errors

Every `local_*` tool returns the same discriminated envelope:

```ts
type LocalExecutionResult<T> =
  | { ok: true; operation: string; data: T }
  | {
      ok: false;
      operation: string;
      error: {
        code: LocalExecutionErrorCode;
        path?: string;
        retryable: boolean;
        message: string;
      };
      partialResult?: unknown;
    };
```

Successful file data includes canonical path(s), byte and line counts, before/after SHA-256 values for changed files, and a unified change summary (`addedLines`, `removedLines`, and a diff preview capped at 16 KiB). Read data includes content, returned line range, truncation state, and the hash of the returned text. Command data includes the existing outcome, exit code, signal, timeout/abort flags, duration, byte counts, truncation flags, and redacted output. A completed command with a non-zero exit code is still a successful execution result; launch failure, timeout, and cancellation use `ok: false` and may include bounded partial output.

The compatibility `workspace_run_command` keeps its current `WorkspaceCommandResult` shape. The adapter converts the unified engine result back to that legacy shape.

Use these stable error codes: `INVALID_INPUT`, `INVALID_PATH`, `PATH_NOT_FOUND`, `NOT_A_FILE`, `ACCESS_DENIED`, `UNSUPPORTED_ENCODING`, `SIZE_LIMIT`, `MATCH_NOT_FOUND`, `MATCH_AMBIGUOUS`, `HASH_CONFLICT`, `PATCH_INVALID`, `PATCH_CONFLICT`, `COMMAND_NOT_FOUND`, `COMMAND_FAILED`, `TIMED_OUT`, `CANCELLED`, `PARTIAL_COMMIT`, and `RUNTIME_ERROR`. Expected failures do not rely on untyped exception strings. Unexpected exceptions are mapped to a non-retryable `RUNTIME_ERROR` after secret redaction. User cancellation and timeout remain distinguishable.

## Risk, permission, and approval

The engine classifies each operation before it runs. Known read-only commands and ordinary file reads are `read_only`; file writes, edits, and patches are `write`; destructive, install, network, process, and unknown commands retain distinct risk classes. Sensitive paths include OS-managed locations and known credential/config paths such as `.env*`, `.ssh`, `.gnupg`, `.aws`, `.azure`, `.config/gcloud`, `.npmrc`, `.pypirc`, `id_*`, and credential files. Paths outside the current conversation workspace are also marked `sensitive_path`. Matching is case-insensitive on Windows. This label does not itself reject an operation.

- **`full_access`:** Skip soft approval. Input, path, encoding, file-type, and resource-limit validation still run.
- **`ask`:** Require approval for every local executor operation, including reads and the compatibility command.
- **`approve_risky`:** Allow ordinary read-only operations automatically. Require approval for writes, edits, patches, sensitive paths, destructive/install/network/process/unknown commands, and any tool or agent policy that requests review.

Existing `requires_approval`, `requireApprovalToolIds`, `review_all`, and conversation permission settings remain additive review signals. Dynamic settings cannot downgrade a risk that the engine classifies as requiring approval. Approval applies to one AI SDK tool call and its signed input; it never grants a directory-wide exception. The main process resolves paths again and rechecks hashes/context immediately before execution after an approval response.

Pending approval state is stored in the existing run metadata as a per-tool-call SHA-256 fingerprint of the structured input, canonical targets, and current target state. Raw tool input and file contents are not added to run metadata. The fingerprint is removed when the call executes or the run is finalized; a resumed approval is rejected if its input or target state changed.

Approval presentation shows operation, target paths, risk reason, and the intended change or command summary. Command arguments and environment values are redacted with the existing sensitive-value rules. The structured tool input remains expandable in the chat. The existing AI SDK `ToolLoopAgent.toolApproval` request/response and resume flow is retained.

## Runtime records and privacy

Each operation records an existing runtime step and event with `runId`, `toolCallId`, tool id, operation, canonical path(s), risk, elapsed time, outcome, byte/line counts, hashes for changes, and a stable error code when relevant. Command audit input is redacted. Runtime records never store full file contents, environment values, or complete command output. The AI SDK chat message still carries the tool input and bounded result needed for model follow-up.

## Agent and renderer integration

- Add the five local tool ids to shared types, builtin tool seeds, tool descriptors, root runtime assembly, permission-sensitive policy, and the scheduler's read-only classification.
- Keep filesystem operations main-process-only. No preload or IPC additions are required.
- Update root-agent instructions to prefer dedicated file tools for edits, use `local_run_command` for commands/tests, and keep local files, conversation workspaces, and sandbox preview files distinct.
- Add Chinese and English metadata for tool names, descriptions, risk labels, and errors.
- Extend `GeneratedToolResult` and approval presentation to show operation/path summaries, command status, bounded diff statistics, and actionable structured errors. Avoid rendering complete command output or file bodies by default.
- Preserve compatibility for existing saved tool selections and `workspace_run_command` messages.

## Validation plan

Backend tests under `tests/desktop/main` will cover:

- Any-local-path resolution, symlink handling, relative paths, invalid paths, regular-file checks, and workspace compatibility restrictions.
- UTF-8 and byte/line limits, read ranges, atomic write, expected-hash conflict, exact-match uniqueness, and explicit replace-all.
- Multi-file patch parsing, full prevalidation, add/update/delete/move, no mutation on validation failure, rollback on commit failure, newline/BOM preservation, and same-path serialization.
- Approval decisions for each permission mode and additive dynamic policies; sensitive-path classification; approval response resume and pre-execution revalidation.
- Command output truncation, redaction, timeout, cancellation, process-tree cleanup, and runtime step/event summaries.
- Tool registration and AI SDK message/result compatibility.

Run the narrow relevant backend test first, then `vp check`, `vp test`, `vp run ayaka-desktop#typecheck:node`, `vp run ayaka-desktop#typecheck:web`, and the permitted desktop backend tests. Run an Electron build if preload/runtime packaging changes make it necessary. Do not add renderer/page tests or browser automation.

## Open decisions

None. The protocol, permissions, sandbox boundary, AI SDK integration, and renderer result approach were confirmed in chat. Implementation can begin after review of this written design.
