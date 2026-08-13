# Agent tool-result reconciliation design

## Problem

The root agent runs one model/tool step at a time. After a step with multiple tool calls, the next step is built from `result.responseMessages`. In the failing DeepSeek scenario that value contains the assistant tool-call message but not the matching tool-result message, while the results remain available as `result.toolResults`. Passing that incomplete history to AI SDK 7 causes `MissingToolResultsError`. The same incomplete tool-call parts can also be persisted in the UI history after a failed stream, so retrying the conversation can fail before the agent loop starts.

## Design

Keep the existing loop and tool execution behavior. When a step completes, append the provider response messages and then append one standard `tool` model message containing every returned tool result. Preserve the result order and each result's `toolCallId`, `toolName`, and output/error payload. Avoid appending duplicate tool messages when a provider already includes them in `responseMessages`.

The reconciliation helper will be pure and unit-testable. It will accept the response messages and tool results, identify tool-call IDs already represented by tool-result messages, and add only missing results. The loop will use this helper before making the next model request. A second pure sanitizer will run before converting initial UI history to model messages: it removes only unfinished `tool-*`/`dynamic-tool` parts, while retaining ordinary content and completed tool outputs. No IPC, persistence, tool policy, UI, or completion-protocol changes are required.

## Error handling

If a tool result has no usable tool-call ID, it will not be synthesized into the prompt because it cannot be associated safely with a call. Existing stream error handling remains responsible for provider/runtime failures. The helper will preserve tool errors as tool-result content so the model can recover or report the failure. An incomplete persisted tool call is treated as abandoned on retry; it is not converted into a fabricated tool result.

## Verification

- Unit test reconciliation with three parallel tool calls and no results in `responseMessages`.
- Unit test that already-present tool results are not duplicated.
- Unit test that three incomplete persisted UI tool calls are removed while completed outputs and text remain.
- Run the focused main-process tests, desktop type checks, and `vp check`.
