# About Settings Page Design

## Summary

Add a read-only About tab to the existing desktop settings dialog. The page presents Paimon's product identity, the installed application version, the MIT license, and useful project links without turning the settings surface into a marketing page.

## Information Architecture

- Add `about` to the settings tab model and place it at the bottom of the settings navigation, visually separated from configurable and maintenance tabs.
- Keep the current settings dialog and tab-state architecture. Do not introduce a route or a second dialog.
- Keep the tab content in a focused `AboutSettings` component instead of expanding the already large settings dialog implementation.

## Content And Visual Design

- Use the existing Paimon application icon as the only brand image.
- Present `Paimon` as the product name and `Void AI` as the local-first desktop workspace identity.
- Show the runtime application version returned by Electron, not a renderer-side hard-coded value.
- Show the MIT license and the current copyright holder from the repository license.
- Provide three explicit actions: project repository, documentation, and issue reporting.
- Use the existing semantic theme tokens, radius system, Button component, and Lucide icon wrapper. The layout is a constrained single column with sparse separators and no nested cards, gradients, or decorative motion.
- Keep all copy available in Simplified Chinese and English.

## Data And Integration

- Add a `system:version` IPC handler backed by `app.getVersion()`.
- Expose `system.version()` through preload types and the renderer API wrapper.
- Load the version when the About component mounts. Display a neutral fallback if the request fails; the rest of the page remains usable.
- Open external resources with a new browser window request so the main-process `setWindowOpenHandler` continues to send them to the system browser.

## Accessibility And Interaction

- Preserve the settings dialog's existing keyboard and Escape behavior.
- Use clear action labels instead of icon-only external links.
- Mark decorative icons and the duplicated product logo appropriately for assistive technology.
- Keep metadata at readable contrast and allow long values to wrap.
- Add no automatic motion. Existing theme and reduced-motion settings continue to apply unchanged.

## Verification

- Extend i18n coverage for the About navigation and core labels.
- Add a focused renderer unit test for version normalization and the three external resource definitions without introducing a DOM test framework.
- Run `vp check`, `vp test`, `vp run desktop#test`, and the desktop web and node type checks.
- Manually verify direct settings navigation, external links, Chinese and English copy, light and dark themes, and the minimum supported window size.

## Non-Goals

- Update checking or release-channel management.
- Displaying Electron, Chromium, operating-system, or diagnostic details.
- Changing the application name, icon, settings route model, or update configuration.
- Refactoring unrelated settings tabs or the dialog's existing focus-management behavior.
