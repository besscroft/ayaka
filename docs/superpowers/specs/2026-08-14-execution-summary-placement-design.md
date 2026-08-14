# Execution Summary Placement Design

## Context

`MessageItem` currently renders the execution summary inside `MessageContent`. `MessageContent`
uses the user-message bubble styling for user messages, so tool, source, compaction, or image parts
attached to a user message can cause the execution summary to appear inside that bubble.

## Goal

Keep the execution summary as an assistant-side activity disclosure, positioned above the
assistant's response content and outside user message bubbles.

## Design

- Keep `getExecutionSummary` and its activity counting unchanged.
- Render the existing `ChainOfThought` execution summary only when `message.role === "assistant"`.
- Move that `ChainOfThought` block to the assistant message wrapper, immediately before
  `MessageContent`, so it is a sibling of the content rather than a child of the styled bubble.
- Preserve the existing open/closed behavior, labels, step details, source links, and generated
  image previews.
- Do not change message persistence, part filtering, tool execution, or user message editing.

## Data Flow

`UIMessage.parts` -> `getExecutionSummary(parts)` -> assistant-only `ChainOfThought` -> existing
activity steps and detail renderers. User messages still render their normal text and attachments,
but never render this execution summary.

## Error Handling

No new runtime error path is introduced. Existing part guards and safe source/image rendering remain
the same. If a user message contains tool-like parts, those parts continue through the existing
rendering path while the summary disclosure is omitted.

## Testing

- Keep the existing aggregation tests for `getExecutionSummary`.
- Add a rendering regression test or focused render assertion proving that the summary disclosure
  is not rendered for a user message.
- Add a focused render assertion proving that an assistant summary precedes its message-content
  node in the generated markup.
- Run the focused renderer test, `vp check`, and the desktop test command required by the repository
  checklist.

## Alternatives Considered

1. Add a public outside-content slot to `MessageContent`: clearer as a generic API, but broader than
   this bug and changes a shared component contract.
2. Render summaries at `MessageList` level: centralizes layout, but weakens the direct relationship
   between a message and its parts.
3. Chosen: conditionally render the existing disclosure as a sibling before `MessageContent` in
   `MessageItem`. It is the smallest change that directly fixes the incorrect ownership and
   preserves current behavior.
