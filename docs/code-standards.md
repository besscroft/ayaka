# Code Standards

This guide captures stable rules for changes to Ayaka. Repository-specific
runtime, IPC, persistence, test-scope, and toolchain constraints in
[`AGENTS.md`](../AGENTS.md) remain authoritative. Use
[`docs/subsystems/README.md`](subsystems/README.md) to find the current-state
reference for the subsystem being changed.

## Scope and behavior

- A change does only what its approved goal needs. Keep unrelated refactors,
  style changes, and policy changes separate.
- Describe behavior before and after the change, including the cases that must
  remain unchanged. Follow the actual entry point through callers, state,
  persistence, side effects, failure paths, and the user-visible result.
- When changing a shared predicate, contract, tool policy, or lifecycle, search
  for every caller and sibling flow. Cover the relevant variants in the same
  change or state why a variant is intentionally out of scope.
- Prefer owning modules and narrow interfaces. Preserve main/preload/renderer,
  Core/desktop, local execution/sandbox, and other documented trust boundaries.

## Tests and evidence

- Add a focused regression test for changed behavior. It should assert the
  caller-visible guarantee and fail when that guarantee is removed, rather than
  coupling to private implementation details.
- Use realistic inputs and include relevant empty, invalid, boundary, failure,
  cancellation, concurrency, and cross-platform cases. Do not fabricate
  external API behavior; use project fixtures or cited upstream evidence.
- Start with the smallest permitted test group, then follow `AGENTS.md` for the
  required repository, desktop, typecheck, and build checks. Desktop renderer
  page tests/browser automation are out of scope.
- Report each verification that ran and its result. Explicitly list checks not
  run, environmental failures, and known repository baseline issues. Do not
  turn a failed or skipped check into a pass by repeating it without changing
  the diagnosed cause.

## Persistence, IPC, and security

- Treat the Electron main process as the authority for filesystem, SQLite,
  secrets, provider credentials, MCP processes, approvals, and sandbox effects.
  Renderer code accesses these only through the typed preload API.
- Keep persistence invariants explicit. Schema changes update Drizzle schema
  and generated migration together, then verify empty-database initialization
  and relevant seed/write paths; never hand-edit an old migration for a new
  schema change.
- Validate IPC input at the main-process boundary. New or migrated contracts
  should share schema-derived types across the main process, preload, and
  renderer.
- Tests that touch user data use isolated temporary directories. Never read or
  write real credentials, databases, MCP secrets, or user configuration in
  tests.
- Fail closed on malformed, ambiguous, unavailable, or stale security-sensitive
  state. Do not widen access, weaken approval, or infer safety from a renderer
  check or a documented warning.

## Documentation and review

- Update the owning reference from `docs/subsystems/README.md` in the same
  change when observable behavior, ownership, interfaces, state transitions,
  compatibility, security boundaries, or failure semantics change. A
  contract-preserving internal refactor does not need a prose change.
- Do not invent a new rule because it sounds generally good. Concrete but
  one-off findings may be captured in `LESSONS.md`; add a permanent standard
  only after the pattern recurs and is verified.
- Design proposals and decisions belong in `docs/superpowers/specs/`; keep
  current behavior in the subsystem reference and keep the two clearly
  distinguished.
- Review the complete diff, not only the edited function. Check linked docs,
  callers, tests, generated files, and unchanged sibling cases. A document or
  passing test alone does not prove behavior the check did not exercise.
- A change/PR description should name each affected subsystem and describe the
  observable trigger and before/after behavior, including compatibility or
  failure changes. Review the claim against implementation, docs, and the cited
  test or runtime evidence.
- Commits and handoff notes should identify the behavior changed, why, and what
  was verified. Never claim a platform, provider, or runtime path was tested
  without direct evidence.
