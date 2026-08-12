# About Page Changelog Design

## Goal

Add an Update Log action to the About settings page. Activating it opens a dialog that loads and renders the repository-maintained `CHANGELOG.md` file as Markdown.

## Changelog Contract

The repository root will contain `CHANGELOG.md`, following a Keep a Changelog-style structure:

```md
# Changelog

All notable changes to this project are documented here.

## [Unreleased]

### Added

- Pending changes...

## [0.1.16] - 2026-08-12

### Added

- User-visible change.

### Fixed

- Bug fix.
```

Version headings use `## [version] - YYYY-MM-DD`; `Unreleased` is allowed and has no date. Every release contains one `### 中文` section and one `### English` section. Within those sections, use localized equivalents of the categories `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, and `Security`. Each entry is a concise, user-facing bullet. AI-generated summaries should update this file in reverse chronological order, keeping the newest release directly below `Unreleased`.

## Runtime Architecture

The main process owns filesystem access. A new `system:changelog` IPC handler reads the changelog as UTF-8 and returns its text. In development it reads the repository root `CHANGELOG.md`; in packaged builds it reads `resources/CHANGELOG.md` alongside the packaged application resources. The path is selected from the existing app-path/runtime environment conventions and is never accepted from the renderer.

The preload bridge exposes `system.changelog(): Promise<string>`, with a matching declaration in `index.d.ts`. The renderer consumes it through the existing `lib/api.ts` wrapper and selects the current language section for each release before rendering, falling back to the other language when necessary.

The electron-builder configuration copies the root `CHANGELOG.md` into the packaged resources directory. Missing or unreadable files return a rejected IPC promise; no file contents or filesystem paths are logged.

## UI Design

`AboutSettings` gains an `Update log` button in the existing resources/action area, using the existing Button component and a Lucide history/document icon. The button opens a dedicated dialog owned by `AboutSettings`.

The dialog has a localized title and a scrollable content region. It renders the loaded Markdown with the existing `RichContent` component, which already sanitizes HTML and URLs. The dialog has three content states:

- Loading: a localized loading indicator while `system.changelog()` is pending.
- Loaded: the current language's Markdown document rendered as readable, scrollable content, with a fallback to the other language when necessary.
- Error: a localized error message and a retry action; the About page remains usable.

Opening the dialog triggers a load. Closing it clears transient loading/error state. Reopening reloads the file so development changes are reflected without restarting the app. Existing Escape and backdrop-close behavior comes from the shared Dialog component.

All new visible strings are added to both Chinese and English dictionaries.

## Testing And Verification

Add focused tests for the pure changelog path/loader helper if the implementation extracts one from the IPC registration. Extend renderer coverage enough to verify the About action opens the dialog and displays loaded Markdown or the error state, using the repository's existing test conventions.

Validate with the smallest relevant tests, then `vp check`, the desktop typecheck, and the desktop test command. Confirm the packaged resource configuration includes `CHANGELOG.md` and does not include generated output or local runtime data.

## Scope

This change does not add remote changelog fetching, automatic version parsing, release-note synchronization, editing controls, or a new Markdown dependency. The existing `RichContent` parser is the rendering surface for the documented Markdown subset.
