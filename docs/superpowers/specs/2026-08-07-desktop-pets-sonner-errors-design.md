# Desktop Pet Error Toast Design

## Goal

Show every desktop-pet management error through the existing Sonner wrapper `notify.error`. This keeps error details out of the page layout while preserving recovery actions.

## Interaction and Data Flow

- A local-pet load failure displays a generic user-facing error toast.
- A store list load failure maps the existing store error categories to localized text and displays a toast. The page keeps only a neutral unavailable state and a retry button.
- Failures from selecting, importing, deleting, toggling, resetting position, downloading, and updating display a localized error toast.
- `snapshot.assetError` and `pet.error` are treated as load-result errors and displayed through Sonner after a successful refresh instead of inline red text.
- Existing success notifications, retry, scrolling, pagination, and confirmation-dialog behavior remain unchanged.

## Scope

- Reuse `apps/desktop/src/renderer/src/lib/toast.ts`, `storeErrorMessage`, and `userFacingErrorMessage`.
- Modify only `DesktopPetsSettings.tsx`; do not change IPC contracts, the main process, database, or i18n messages.
- Avoid duplicate refresh notifications: show one request error for a failed refresh, and show each distinct card-level error returned by a successful refresh.

## Verification

- Run `vp check --fix`.
- Run the desktop web type check and desktop test suite.
- Confirm error details no longer appear inline in the desktop-pet management page and store failures still expose retry.
