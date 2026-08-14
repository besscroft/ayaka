# Remove Input Shortcut Hint

## Goal

Remove the shortcut-help line shown below the chat input because it is not needed. The underlying keyboard behavior remains unchanged.

## Scope

- Remove the `input.shortcutHint` paragraph rendered by `MessageInput`.
- Remove the unused Chinese and English `input.shortcutHint` translations.
- Keep Enter-to-send and Shift+Enter-for-newline handling intact.
- Do not modify unrelated working-tree changes.

## Implementation

The change is limited to the renderer chat input and its translation catalog:

1. Delete the hint `<p>` from `apps/desktop/src/renderer/src/components/MessageInput.tsx`.
2. Delete the `input.shortcutHint` entry from `apps/desktop/src/renderer/src/lib/i18n.messages.ts`.

No IPC, persistence, or API changes are required. No new test is needed for this static presentation-only removal; validation will confirm the key and rendered hint no longer exist and the desktop renderer typecheck still passes.

## Acceptance Criteria

- The text `Enter 发送 · Shift+Enter 换行` and its English equivalent are no longer rendered.
- No code references `input.shortcutHint` remain.
- Enter still submits the chat input, and Shift+Enter still inserts a newline.
- Existing unrelated modifications remain untouched.
