# Realtime Voice Context Summary

## User goal

Add Realtime API support and a voice conversation feature independent from current text chat. Entry is in the upper-left navigation area. The page is independently designed and follows visual option B selected by the user: readable transcript and text input with visible voice connection state.

## Approved decisions

- Separate realtime conversation history and navigation list.
- Save transcript and session metadata only; never retain audio.
- Reopen a past transcript read-only. “Continue” starts a new realtime provider connection and includes the latest 20 user/assistant turns as context.
- First provider scope: OpenAI plus custom OpenAI-compatible providers that are explicitly marked as supporting Realtime. Existing custom providers default off. The opt-in does not validate compatibility.
- Realtime availability is also model-specific. Custom models must have the `realtime` capability enabled; OpenAI catalog inference recognizes IDs containing `realtime` or `live`.
- General Settings stores a default Realtime model using the existing app settings KV store (no schema migration); new sessions preselect it, and session-page choices remain temporary.
- Main process mints short-lived client credentials from the configured encrypted provider key. Renderer receives only the short-lived token/session setup data. Installed hook POSTs to a setup URL, so use a validated local Hono setup route invoking main-process provider logic rather than raw renderer IPC.
- Microphone permission is requested only after an explicit connect action.
- All new UI strings need Chinese and English entries.
- No page/renderer tests or browser automation. Backend persistence/provider tests plus production renderer typecheck/build are permitted.

## Repository and SDK facts already observed

- Workspace: `C:\github\ayaka`; Vite+ commands; Node >=22.12, pnpm 11.6.
- Electron main process owns SQLite, credentials, and privileged APIs. Renderer uses `window.api` through preload.
- AI SDK 7.0.14; OpenAI provider 4.0.7; React provider hook 4.0.15.
- Installed Realtime hook is exported as `experimental_useRealtime`; options accept `model`, `api: { token }` where `token` is a POST setup endpoint URL, optional session config, and callbacks. It returns status/messages/connect/disconnect/sendTextMessage/audio controls.
- Runtime inspection confirmed the hook itself does not request microphone permission. Renderer calls `getUserMedia()` on explicit connect, then starts capture when hook status becomes connected.
- The hook setup URL cannot carry custom headers, so the existing random local server token is included as a query parameter and compared in constant time by the setup route; request body/session config are constrained.
- AI SDK OpenAI Realtime implementation calls `<baseURL>/realtime/client_secrets` and derives websocket URL from the base URL host at `/v1/realtime`; custom compatible endpoints must match those routes.
- Generated migration `0010_safe_human_fly.sql` creates transcript-only `realtime_sessions` with an updated-time index; persistence accepts text messages only, never audio bytes.
- Provider docs describe server-minted short-lived token with `experimental_realtime.getToken()` and browser-side Realtime session.
- Root `task_plan.md`, `findings.md`, and `progress.md` belong to prior tasks. Do not overwrite them.
- Visual mockup B and the brainstorm companion artifacts are in ignored `.superpowers/brainstorm/realtime-layout/`.

## Completion status

Implementation and verification are complete. Desktop node/web production typechecks and builds passed; Core tests 4/4, root tests 13/13, and focused Realtime tests passed. The full desktop main aggregate had 3 Windows symlink EPERM failures (292 passed); test-only typecheck has 4 pre-existing errors; global `vp check` reports 308 formatting issues while task-touched files pass targeted formatting. After the default-setting follow-up, native rebuild in the standard desktop build hit Windows EBUSY because Electron processes were holding the module; direct `pnpm exec electron-vite build` passed. See `progress.md` for the full verification record.
