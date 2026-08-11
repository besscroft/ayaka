# shadcn Preset Theme Refactor

## Goal

Make `b1s8zoQt6` (nova, neutral, lucide, Inter, default radius) the renderer's visual source of truth. Provide `white`, `black`, and `ocean` skins while preserving the app's existing renderer behavior, IPC flows, chat runtime, and desktop-pet window behavior.

## Theme Contract

- `SkinId` becomes `white | black | ocean` and the fresh-install default is `white`.
- White and Black use the preset's light and dark neutral token sets, including core, chart, radius, font, and menu tokens.
- Ocean reuses White's non-color geometry and typography and overrides only color tokens.
- Existing persisted values migrate on read: `nova-light` to `white`, `nova-dark` to `black`, and `ocean-light` to `ocean`. New writes use only the new IDs.
- `success`, `warning`, and `danger` remain application status tokens because they are outside the preset's core token contract.

## Component Architecture

- `apps/desktop/components.json` aligns with the preset's `base-nova` configuration.
- `components/ui` uses shadcn Base UI primitives for buttons, cards, fields, dialogs, alerts, badges, menus, overlays, tabs, toggles, loading states, tables, empty states, and sidebar navigation.
- The existing large custom UI facade is removed after consumers migrate. Any remaining local wrapper is limited to business behavior and re-exports standard primitives.
- Existing `ai-elements` remain the semantic layer for conversations, messages, prompt input, reasoning, tools, attachments, queues, and tasks. Their styling uses shadcn semantic tokens rather than legacy foreground alpha classes.

## Migration Order

1. Update the theme types, settings compatibility parser, preset configuration, global CSS tokens, and theme/settings tests.
2. Add or update the required shadcn Base UI components and migrate the shared component imports.
3. Migrate AppShell, navigation, conversation list, ChatView, MessageList, MessageInput, model selection, reasoning, and tool selection.
4. Migrate SettingsDialog and the three skin previews.
5. Migrate Agents, Tools, MCP, Skills, Automations, Memory, About, Desktop Pets settings, and all confirmation/edit dialogs.
6. Remove unused custom primitives and legacy skin/style copy while keeping i18n in both Chinese and English.

## Invariants

- Data loading, IPC calls, streaming, attachments, tool calls, editing, deletion, retry behavior, and persistence do not change.
- Reduced-motion behavior, title-bar drag regions, and transparent desktop-pet windows do not regress.
- Dialogs and overlays retain accessible titles, keyboard dismissal, focus behavior, and modal semantics.
- The main window keeps its current information architecture and responsive relationships; only visual hierarchy, component composition, spacing, and semantic styling change.

## Verification

- Theme tests cover complete tokens, White/Ocean geometry equality, color scheme, radius, font, and legacy ID migration.
- Renderer tests cover skin selection, settings persistence, dialogs, tabs, popovers, selects, chat input, and tool/model selection.
- Static checks ensure business code does not rely on the legacy custom facade or core hard-coded colors.
- Run `vp check`, `vp test`, `vp run desktop#test`, `vp run desktop#typecheck`, and `vp run desktop#build`.
- Manually verify White, Black, and Ocean across chat, settings, management pages, dialogs, narrow layouts, persistence, keyboard access, and reduced motion.
