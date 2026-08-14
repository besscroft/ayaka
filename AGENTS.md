<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

# Repository Guide

## Project Shape

This is a pnpm workspace for a local-first AI desktop application.

- `apps/desktop`: the production Electron app. It contains the main process, preload bridge, React renderer, SQLite/Drizzle persistence, local Hono server, agents, workflows, tools, memory, providers, and desktop pets.
- `apps/docs`: the Nuxt documentation site.
- `apps/desktop/drizzle`: checked-in SQLite migrations and Drizzle metadata. The runtime database is created under Electron's `userData/data/void-ai.db`, not in the repository.
- `apps/desktop/resources`: packaged desktop assets, including pet resources.
- `tests/vite-plus`: root-level Vite+ smoke tests.
- `tests/desktop`: desktop main-process and renderer tests, kept separate from production `src` code.
- `docs`: architecture notes, component notes, and implementation specifications. `docs/architecture.md` is the source of truth for the product/runtime model.
- `.agents/skills`: local agent skills. Root formatting and linting intentionally ignore skill trees.

The workspace currently has no shared package. Keep new reusable code in the owning app until a real cross-app consumer exists; do not create a package only to move one file.

## Runtime Boundaries

- The Electron main process owns filesystem access, SQLite, migrations, provider/API keys, MCP connections, sandbox execution, and other privileged operations.
- The renderer must use `window.api` through the preload bridge. Do not import Electron, Node built-ins, database clients, or provider secrets into `apps/desktop/src/renderer`.
- An IPC feature normally has three coordinated pieces: the handler in `apps/desktop/src/main/ipc/index.ts` (or the owning main-process module), the exposed method in `apps/desktop/src/preload/index.ts` and its type in `index.d.ts`, and the renderer wrapper/consumer in `src/renderer/src/lib/api.ts` or a component.
- API keys and MCP/Skill secrets are encrypted and resolved in the main process. Never return decrypted values through IPC, logs, tests, or UI state.
- The app is local-first. Runtime facts, approvals, tool calls, handoffs, sandbox work, and errors are recorded in SQLite runtime tables; keep those records consistent when adding execution paths.

## Data And Migrations

- Define tables and relations in `apps/desktop/src/main/lib/schema.ts`.
- Generate migrations from the desktop package with `vp run desktop#db:generate`; inspect the generated SQL and metadata before committing them. Do not hand-edit an existing migration to represent a new schema change.
- Apply migrations through the app (`migrate()` in `src/main/lib/db.ts`). Use `vp run desktop#db:studio` only for local inspection.
- Seed/default behavior lives with the main-process runtime defaults and database initialization. Schema changes must be tested against an empty database and the relevant seed path.
- Tests that touch persistence should set `VOID_AI_USER_DATA_DIR` to a temporary directory. Never use a real user-data directory or commit `.drizzle-dev`, database files, keys, or generated `out` artifacts.

## Common Commands

Run these from the repository root with Node `>=22.12.0`, pnpm `11.6.0`, and the `vp` CLI:

```bash
vp install
vp run dev:desktop
vp run docs#dev
```

Validation and builds:

```bash
vp check                         # repository formatting, lint, and type-aware checks
vp test                          # root tests configured in vite.config.ts
vp run desktop#test              # full desktop renderer + main-process test suite
vp run desktop#test:renderer     # desktop renderer tests
vp run desktop#test:main         # desktop main-process tests
vp run desktop#test:electron     # Electron-backed desktop tests
vp run desktop#typecheck:test    # test-only TypeScript checks
vp run desktop#typecheck         # node and web TypeScript projects
vp run desktop#typecheck:web
vp run desktop#typecheck:node
vp run desktop#build
vp run build:desktop:win         # or build:desktop:mac / build:desktop:linux
vp run docs#build
```

The desktop scripts rebuild `better-sqlite3` as needed. If native bindings are stale after changing Node/Electron versions, run `vp run desktop#rebuild:native` before retrying. The package also exposes `desktop#db:generate`, `desktop#db:studio`, and `desktop#db:migrate` for Drizzle work.

`vp run desktop#test` uses Node's built-in test runner through `tsx` and includes separate renderer/web, main/node, and Electron-backed groups. Tests live under `tests/desktop` and are registered through the renderer, main, and Electron aggregate entries. A focused group can be run with the corresponding `pnpm test:<group>` command from `apps/desktop`; the aggregate command is the expected final verification.

## Change Guidelines

- Match the existing TypeScript/ESM style and run `vp check` after edits. Use the `@renderer/*` and `@shared/*` aliases where the local Electron Vite config provides them.
- Keep renderer UI in the existing React/shadcn Base UI composition. Reuse Lucide icons, existing i18n helpers, and the app's `MotionConfig`; animations must respect the reduced-motion setting.
- Add user-facing strings to `apps/desktop/src/renderer/src/lib/i18n.messages.ts` rather than hard-coding copy in components. Preserve both Chinese and English entries when changing shared UI text.
- Prefer narrow main-process modules under `apps/desktop/src/main/lib`. Keep IPC handlers thin and put validation/business logic in the owning module so it can be unit tested without a window.
- For agent, workflow, tool, memory, approval, sandbox, or provider changes, add or update focused tests under `tests/desktop/main` while mirroring the production source area. Include runtime event/step assertions when the change affects execution or diagnostics.
- For UI changes, add or update the corresponding test under `tests/desktop/renderer`; do not add a browser automation dependency for a pure helper or state transition.
- Do not commit build output, native rebuild output, local databases, secrets, or generated temporary files. Keep unrelated worktree changes intact.

## Review Checklist

Before handing off a change, confirm:

- The smallest relevant test group passes, then run `vp check`, `vp test`, and the appropriate desktop test command.
- IPC additions are typed in preload and consumed through `lib/api.ts`.
- Database changes include a migration, empty-database initialization coverage, and seed/runtime checks where applicable.
- Privileged data stays in the main process and error paths produce actionable, localized UI messages when user-facing.
- Build-sensitive changes have a desktop typecheck/build result, especially changes involving Electron, `better-sqlite3`, preload, or packaging.
