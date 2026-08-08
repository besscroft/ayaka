# Stable Installed Skills Order

## Goal

Keep the installed Skills list in a predictable order after users enable, disable,
or edit a Skill. The list should be ordered by installation/creation time, with
the newest Skill first.

## Design

The existing `tools.discovered_at` column is the persisted creation timestamp for
Skill records and is already exposed as `created_at` in `ToolSkill`. The main-process
`listSkillTools()` query will use `discovered_at DESC` instead of `updated_at DESC`.

When timestamps are equal, the query will use `id ASC` as a deterministic secondary
sort key. This prevents SQLite row-order differences from changing the UI order.
No schema or migration change is required, and the renderer API remains unchanged.

## Testing

Add focused coverage for the Skill listing query or its owning database test:

- Skills are returned newest-created first.
- Updating a Skill does not move it ahead of a newer Skill.
- Equal creation timestamps use the stable ID tie-breaker.

## Scope

Only the installed Skills ordering is changed. Catalog ordering, deleted-Skill
ordering, and unrelated tool lists retain their existing behavior.
