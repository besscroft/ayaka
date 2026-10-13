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
- `apps/core`: the host-agnostic Hono backend package used as the HTTP contract boundary.
- `apps/docs`: the React Router v8 documentation site deployed to Cloudflare Workers.
- `packages/assets`: shared static assets consumed by the desktop app and documentation site.
- `apps/desktop/drizzle`: checked-in SQLite migrations and Drizzle metadata. The runtime database is created under Electron's `userData/data/ayaka.db`, not in the repository.
- `apps/desktop/resources`: packaged desktop assets, including pet resources.
- `tests/vite-plus`: root-level Vite+ smoke tests.
- `tests/desktop`: desktop backend tests, kept separate from production `src` code.
- `docs`: architecture notes, component notes, and implementation specifications. `docs/architecture.md` is the source of truth for the product/runtime model.
- `docs/code-standards.md` and `docs/subsystems/README.md`: stable engineering rules and the index of subsystem references.
- `LESSONS.md`: concrete, evidence-backed failures and prevention checks from Ayaka changes; independently repeated rules may be reviewed for promotion to code standards.
- `.agents/skills`: local agent skills. Root formatting and linting intentionally ignore skill trees.

Keep new reusable code in the owning app until a real cross-app consumer exists; do not create a package only to move one file. Use `apps/core` for host-agnostic HTTP/runtime contracts and `packages/assets` for genuinely shared static assets.

## Coding Agent Workflow

Use this repository's tracked docs as the source of truth. Do not treat local planning files such as `task_plan.md`, `findings.md`, and `progress.md` as committed project guidance; they are intentionally ignored.

For every task:

1. Read the relevant section of this guide and inspect `git status --short` before editing. Preserve existing user changes.
2. Trace the affected behavior through its real callers, state/persistence, side effects, IPC and renderer surface as applicable. Prefer the focused source/test references in `docs/subsystems/README.md`; verify the linked implementation because docs can drift.
3. Keep the change to its stated goal. Check parallel entry points and sibling flows when a shared rule or behavior changes; preserve neighboring behavior not included in the goal.
4. For behavior changes, add or update tests that exercise observable behavior and fail if the regression is reintroduced. Select the smallest permitted relevant check first; for docs-only work validate links and formatting instead. Do not claim checks that were not run.
5. Update the owning current-state reference in the same change when responsibilities, interfaces, state transitions, compatibility, security or failure behavior change. Design proposals belong in `docs/superpowers/specs/`; do not present a proposal as current behavior.
6. Before handoff, review the complete diff, `git diff --check`, validation results, and whether user-facing behavior, architecture docs and tests agree. For substantial changes, also compare new failures or corrected misunderstandings with `LESSONS.md`; add a lesson only when evidence shows a reusable prevention rule. State limitations and unrun checks explicitly.

For architectural work, clarify scope and trade-offs before implementation, record the approved design in a spec, then make a staged implementation plan. Narrow fixes that follow an already documented and confirmed flow may skip a separate spec, but still need a focused change and evidence. Do not change CI permissions, signing, release, or publishing policy as incidental cleanup.

Read `docs/code-standards.md` before substantive code changes or code review. Read the affected subsystem reference named by `docs/subsystems/README.md`. Review `LESSONS.md` before behavior, persistence, IPC, provider, security, test-infrastructure or cross-platform changes; record new lessons only when this repository supplies concrete evidence, and promote repeated validated lessons instead of duplicating permanent rules.

### Task paths

- **Bug/fix:** reproduce the reported behavior when possible, trace the owning path and its sibling cases, add a focused regression, then validate the user-visible result. Do not substitute a passing intermediate step for the requested outcome.
- **Feature/architecture:** define goal, non-goals, observable behavior, ownership/boundaries, failure handling and validation before implementation. Record approved non-obvious decisions in a dated design under `docs/superpowers/specs/`; split independent subsystems into separate designs/plans.
- **Review:** prioritize concrete behavior, security, persistence, compatibility and missing-test findings. Trace beyond the changed lines and distinguish verified behavior from assumptions.
- **Docs/tooling/CI:** check source-of-truth files, all links and affected callers. Workflow, release and permission changes are high-impact; do not modify them as incidental cleanup.

### Documentation update rule

- Current architecture references explain what the code does today and link to implementation/tests; update them alongside changes to contracts or behavior.
- `docs/superpowers/specs/` contains design proposals/decisions and may be historical. Confirm status and source links before treating an old proposal as current guidance.
- `LESSONS.md` contains dated, evidence-backed failure patterns. A one-off suspicion or unverified finding is not a repository rule.

## Runtime Boundaries

- The Electron main process owns filesystem access, SQLite, migrations, provider/API keys, MCP connections, sandbox execution, and other privileged operations.
- The renderer must use `window.api` through the preload bridge. Do not import Electron, Node built-ins, database clients, or provider secrets into `apps/desktop/src/renderer`.
- An IPC feature normally has three coordinated pieces: the handler in `apps/desktop/src/main/ipc/index.ts` (or the owning main-process module), the exposed method in `apps/desktop/src/preload/index.ts` and its type in `index.d.ts`, and the renderer wrapper/consumer in `src/renderer/src/lib/api.ts` or a component.
- IPC inputs that cross the main-process boundary should be declared in `apps/desktop/src/shared/ipc-schema.ts` and parsed by the main-process handler; preload and renderer types should be derived from the same contract where that channel has been migrated.
- API keys and MCP/Skill secrets are encrypted and resolved in the main process. Never return decrypted values through IPC, logs, tests, or UI state.
- The app is local-first. Runtime facts, approvals, tool calls, handoffs, sandbox work, and errors are recorded in SQLite runtime tables; keep those records consistent when adding execution paths.

## Data And Migrations

- Define tables and relations in `apps/desktop/src/main/lib/schema.ts`.
- Generate migrations from the desktop package with `vp run ayaka-desktop#db:generate`; inspect the generated SQL and metadata before committing them. Do not hand-edit an existing migration to represent a new schema change.
- Apply migrations through the app (`migrate()` in `src/main/lib/db.ts`). Use `vp run ayaka-desktop#db:studio` only for local inspection.
- Seed/default behavior lives with the main-process runtime defaults and database initialization. Schema changes must be tested against an empty database and the relevant seed path.
- Tests that touch persistence should set `AYAKA_USER_DATA_DIR` to a temporary directory. Never use a real user-data directory or commit `.drizzle-dev`, database files, keys, or generated `out` artifacts.

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
vp run ayaka-desktop#test              # full desktop backend test suite
vp run ayaka-desktop#test:main         # desktop main-process tests
vp run ayaka-desktop#test:electron     # Electron-backed desktop tests
vp run ayaka-desktop#typecheck:test    # backend test-only TypeScript checks
vp run ayaka-desktop#typecheck         # node and web TypeScript projects
vp run ayaka-desktop#typecheck:web
vp run ayaka-desktop#typecheck:node
vp run ayaka-desktop#build
vp run build:desktop:win         # or build:desktop:mac / build:desktop:linux
vp run docs#build
```

The desktop scripts rebuild `better-sqlite3` as needed. If native bindings are stale after changing Node/Electron versions, run `vp run ayaka-desktop#rebuild:native` before retrying. The package also exposes `ayaka-desktop#db:generate`, `ayaka-desktop#db:studio`, and `ayaka-desktop#db:migrate` for Drizzle work.

The test runner can use Node or launch Electron with `ELECTRON_RUN_AS_NODE=1`;
`better-sqlite3` must match the ABI of the process that actually loads it. Read
`apps/desktop/scripts/run-desktop-tests.mjs` and
`apps/desktop/scripts/rebuild-better-sqlite3.cjs` before diagnosing native
binding errors. A Node ABI failure is a test-environment failure, not evidence
that an Electron-backed database test passed or failed.

`vp run ayaka-desktop#test` uses Node's built-in test runner through `tsx` and includes the main/node and Electron-backed backend groups. Tests live under `tests/desktop` and are registered through the main and Electron aggregate entries. A focused group can be run with the corresponding `pnpm test:<group>` command from `apps/desktop`; the aggregate command is the expected final verification.

### Desktop Test Scope

- Desktop tests are backend-only. The page/renderer test suite has been intentionally removed to keep validation focused and avoid spending tokens on UI tests.
- Do not add, restore, or run page/renderer tests or browser automation for desktop pages. In particular, do not recreate or reference `tests/desktop/renderer/**`, `tests/desktop/renderer.test.ts`, `apps/desktop/tsconfig.test.web.json`, `test:renderer`, or `typecheck:test:web`.
- The permitted desktop test commands are `vp run ayaka-desktop#test:main`, `vp run ayaka-desktop#test:electron`, and the aggregate `vp run ayaka-desktop#test`. Test-only type checking is Node-only via `vp run ayaka-desktop#typecheck:test`.
- `vp run ayaka-desktop#typecheck:web` remains a production renderer type check when build/type safety requires it; it is not a reason to add or run page tests. `tests/vite-plus` remains in scope because it is a root-level toolchain/API test group, not a desktop page test.

## Change Guidelines

- Match the existing TypeScript/ESM style and run `vp check` after edits. Use the `@renderer/*` and `@shared/*` aliases where the local Electron Vite config provides them.
- Keep renderer UI in the existing React/shadcn Base UI composition. Reuse Lucide icons, existing i18n helpers, and the app's `MotionConfig`; animations must respect the reduced-motion setting.
- Add user-facing strings to `apps/desktop/src/renderer/src/lib/i18n.messages.ts` rather than hard-coding copy in components. Preserve both Chinese and English entries when changing shared UI text.
- Prefer narrow main-process modules under `apps/desktop/src/main/lib`. Keep IPC handlers thin and put validation/business logic in the owning module so it can be unit tested without a window.
- For agent, workflow, tool, memory, approval, sandbox, or provider changes, add or update focused tests under `tests/desktop/main` while mirroring the production source area. Include runtime event/step assertions when the change affects execution or diagnostics.
- For renderer/UI changes, do not add page tests or browser automation; use only the production type check/build when needed and test backend behavior through `tests/desktop/main` or `tests/desktop/electron.test.ts` when applicable.
- Do not commit build output, native rebuild output, local databases, secrets, or generated temporary files. Keep unrelated worktree changes intact.

## Review Checklist

Before handing off a change, confirm:

- The smallest relevant test group passes, then run `vp check`, `vp test`, and the appropriate desktop test command.
- IPC additions are typed in preload and consumed through `lib/api.ts`.
- Database changes include a migration, empty-database initialization coverage, and seed/runtime checks where applicable.
- Privileged data stays in the main process and error paths produce actionable, localized UI messages when user-facing.
- Build-sensitive changes have a desktop typecheck/build result, especially changes involving Electron, `better-sqlite3`, preload, or packaging.
