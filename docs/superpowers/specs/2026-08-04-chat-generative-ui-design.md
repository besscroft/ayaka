# Chat Generative UI Design

## Goal

Improve the desktop chat experience by rendering useful, structured tool results as compact,
state-aware UI while preserving the existing AI SDK UI message protocol, persistence format, and
approval flow.

The implementation follows AI SDK 7.0.14 Generative UI guidance: tool calls remain typed
`UIMessage.parts`, and the renderer maps tool names and tool states to React components.

## Scope

- Keep `/api/chat`, preload IPC, SQLite schema, and persisted `UIMessage` JSON unchanged.
- Add a renderer-side tool UI registry with runtime validation for untrusted or provider-specific
  output shapes.
- Use Compact + Summary only: completed tools are collapsed by default and expose a short summary
  in the tool header; active, approval, and error states remain visible.
- Render specialized views for web, memory, automation, sandbox, provider-native, and runtime
  tools. Unknown tools continue to use the existing JSON fallback.
- Only expose safe external links, downloads, and previews. Do not add state-changing actions to
  message cards.

## Architecture

`MessageList` remains responsible for message ordering, text, reasoning, approvals, and the tool
shell. A generated tool result layer handles only tool-name resolution, summary extraction, output
normalization, and result presentation.

The data flow is:

```text
UIMessage.parts
  -> tool name/state normalization
  -> compact summary + renderer registry lookup
  -> specialized result component or JSON fallback
  -> existing Tool disclosure and approval shell
```

The normalization layer accepts `unknown` output and validates fields before rendering. It does
not access IPC, mutate messages, or keep local execution state, so it is independently testable.

## Tool Renderers

- Web: `web_search` renders result count, titles, domains, snippets, and safe source links;
  `web_open` renders page metadata, final URL, and collapsible page text.
- Memory: search and mutation tools render memory titles, scope/kind, summaries, and status.
- Automation: `cron` renders job name, status, schedule, next run, and execution summary without
  pause, delete, restore, or run controls.
- Sandbox: file lists, file content, command output, snapshots, artifacts, and preview links use
  compact file/log/list views with truncation and safe URLs.
- Provider-native: `file_search`, `code_interpreter`, and `tool_search` render stable summaries and
  expandable structured output; provider-specific shapes fall back safely.
- Runtime: `current_time`, `runtime_snapshot`, `model_capabilities`, and `conversation_search`
  render compact summaries with collapsible details.
- Existing media generation rendering remains unchanged.

## State Behavior

- `input-streaming` and `input-available`: show active loading state and keep the disclosure open.
- `approval-requested`: keep the approval UI visible and preserve existing response callbacks.
- `output-available`: show compact summary and keep details collapsed by default.
- `output-error` and `output-denied`: show the error or denial prominently and keep details open.
- Unknown or malformed outputs: show the existing safe JSON fallback.

## Safety And Compatibility

- External URLs pass through the existing rich-content URL sanitizer and only permitted protocols
  are rendered as links.
- Long text, URLs, file paths, and command output are truncated or placed in scrollable containers.
- Historical messages continue to render from their persisted parts without migration.
- Streaming updates re-render from `useChat` state; no second client-side protocol is introduced.
- New user-facing labels and status text are added to both Chinese and English i18n entries.

## Verification

Focused tests cover normal, empty, malformed, unknown, approval, error, and denied tool states;
summary extraction; safe URL handling; truncation; and provider fallback. Existing MessageList
activity tests are extended for state-aware summaries and disclosure behavior.

Final validation uses `vp check`, desktop web/node typechecks, and `vp run desktop#test`.
