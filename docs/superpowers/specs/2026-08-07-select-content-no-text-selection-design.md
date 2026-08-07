# SelectContent Text Selection Design

## Scope

Update the desktop renderer's standard `SelectContent` component so that all content rendered inside its popup cannot be selected as text.

This change is limited to `apps/desktop/src/renderer/src/components/ui/select.tsx`. Custom popup components and native Electron menus are out of scope.

## Design

Add Tailwind's `select-none` utility to the default class list of the `SelectPrimitive.Popup` rendered by `SelectContent`. Because the utility is applied to the popup root, it covers the list, items, labels, separators, and scroll controls without adding a wrapper element or changing the component API.

Consumer-provided classes remain supported through the existing `cn` call and `className` prop.

## Validation

Run the repository check command and the desktop renderer typecheck. Confirm the worktree diff contains only the intended `SelectContent` class change plus this design document, while preserving unrelated existing changes.
