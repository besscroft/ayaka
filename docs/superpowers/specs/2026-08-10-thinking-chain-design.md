# Thinking And Chain Of Thought Design

## Goal

Separate continuous model reasoning from discrete execution activity so the chat is transparent
without turning every assistant message into one large disclosure. The existing AI SDK UI message
protocol, persistence format, IPC surface, and main-process runtime remain unchanged.

## Rendering Model

`MessageList` derives two renderer-only views from `UIMessage.parts`:

- `Reasoning`: combines all `reasoning` parts in order and displays the original text. It opens while
  the last assistant message is actively streaming and its final part is an unfinished reasoning
  part, then closes when the answer becomes the latest part or the final reasoning part is `done`.
  Historical reasoning is collapsed by default and remains manually expandable.
- `ChainOfThought`: summarizes tools, sources, context compaction, and image/reasoning files as
  high-level steps. Existing Tool disclosures remain the source of detailed input, output, approval,
  and error content.
- When the assistant has not emitted any visible part yet, `MessageList` renders an assistant-side
  `ChainOfThought` fallback. It uses the existing runtime snapshot for model/tool/approval progress
  and shows a single active waiting step until runtime data arrives; it never invents reasoning text.

Reasoning is considered streaming only while the message is streaming, the last message part is a
reasoning part, and the final reasoning part is not marked `done`. This deliberately ignores an
older `streaming` part once a later reasoning or answer part has arrived.

## State And Safety

Active tool calls and approval requests keep the execution summary open. Failed or denied tool calls
use an error step and keep the summary available for inspection. Aborted or failed streams stop
animation but preserve received content.

Source links and reasoning images pass through the existing rich-content URL sanitizer. Unsafe URLs
render as non-clickable content. Long reasoning content is rendered through the existing safe rich
content renderer with a bounded scroll region.

The fallback is removed as soon as a reasoning or execution part becomes available, so the user
sees one authoritative progress surface at a time. Runtime step titles are used only as high-level
labels; raw detail payloads and diagnostics are not rendered in the chat message.

## Verification

Focused tests cover reasoning aggregation and streaming transitions, execution summary counts and
states, approval/error behavior, static disclosure rendering, localized copy, and unsafe URL
fallbacks. Final verification uses `vp check`, desktop web/node typechecks, and
`vp run desktop#test`.
