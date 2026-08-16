# Conversation scroll button positioning design

## Goal

Keep the “jump to latest” button anchored to the bottom center of the conversation viewport while the conversation content scrolls independently. The button must no longer move with message, reasoning, or tool-result content.

## Scope

- Change only the renderer conversation layout and its focused tests.
- Preserve the existing scroll-distance thresholds, auto-follow behavior, smooth scrolling, reduced-motion handling, and localized aria label.
- Do not change message rendering, persistence, IPC, or the input composer.

## Design

`Conversation` will become a two-layer layout:

1. An outer `relative` flex item will own the conversation viewport’s positioning context.
2. An inner `min-h-0 flex-1 overflow-y-auto` element will remain the scroll controller’s `containerRef` target and will contain `ConversationContent`.
3. `ConversationScrollButton` will render as a sibling of the inner scrolling element, so its `absolute bottom-4 left-1/2` positioning is relative to the viewport shell rather than to the scrollable content.

The context provider will continue to wrap the layout, and `ConversationContent` will keep using `contentRef` against the inner scroll container. Existing callers, including `MessageList`, will not need to change their composition.

## Behavior and data flow

The scroll controller continues to derive `isAwayFromLatest` from the inner element’s `scrollHeight`, `scrollTop`, and `clientHeight`. When that state is true, the button is rendered by the outer shell; when false, it is omitted. Clicking the button calls the existing `scrollToLatest` callback, which keeps its current reduced-motion and smooth-scroll behavior.

If the conversation has no overflow or is at the latest position, no button is rendered. If the scroll container is resized or content disclosure changes, the existing `ResizeObserver` and scroll-preservation logic remain unchanged because their refs still point to the same inner element/content nodes.

## Validation

- Add or update renderer tests to assert the conversation layout keeps the scroll container and jump button in separate layers while preserving the button’s accessibility label and existing threshold behavior.
- Run the focused conversation scroll tests.
- Run `vp check` and the relevant desktop renderer test command.

## Acceptance criteria

1. Scrolling the conversation moves messages but does not move the jump button from the viewport’s bottom-center position.
2. The button remains above the composer because the conversation component’s own viewport is the positioning context.
3. The button appears only when the user is more than the existing button threshold away from the latest content.
4. Clicking the button still reaches the latest content and clears the button state.
5. Reduced-motion behavior, localization, empty state rendering, and all non-scroll conversation behavior remain unchanged.
