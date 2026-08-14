# Agent Publish and Trash Design

## Summary

- Draft agent cards expose a one-way Switch that publishes the agent as available.
- Every unlocked agent can be removed from the list by archiving it to the existing trash.
- Restored agents always return as disabled drafts.
- Busy agents cannot be archived, and permanent deletion must remain atomic and remove runtime-state residue.

## Interaction

- Show an off Switch labelled "Make available" only on unlocked draft cards.
- Turning it on updates the agent to `status: "active"` and `enabled: true`. While the request is pending, disable only that card. On success, refresh the list so the card moves to Available; on failure, keep the draft unchanged and show an error toast.
- Do not show a reverse Switch on available cards.
- Show Delete on every unlocked draft or available card. Confirmation explains that the agent moves to trash and will return as a draft if restored.
- Disable Delete while runtime status is `queued`, `running`, `reviewing`, `handoff`, `tool_calling`, `sandbox`, or `learning`. Allow it for `idle`, `failed`, or missing runtime state.
- After archiving the selected agent, close its detail view and clear its selection.

## Data Behavior

- Reuse `agents.update`, `agents.archive`, `agents.restore`, and `agents.delete`; add no schema, IPC, or public API.
- New and duplicated drafts persist with `enabled: false`.
- Publishing writes `active` and enabled together.
- Archiving rechecks locked and busy state in the main process, then writes `archived` and disabled.
- Restoring accepts only archived agents and writes `draft` and disabled.
- Permanent deletion records its diagnostic event and deletes the policy and agent in one database transaction. After commit, remove the agent from the in-memory runtime-state map.

## Verification

- Cover publication patches, draft defaults, list movement, locked/busy rejection, archive and restore behavior, and permanent deletion without foreign-key errors or runtime-state residue.
- Run `vp check`, `vp test`, `vp run ayaka-desktop#test`, `vp run ayaka-desktop#typecheck`, and `vp run ayaka-desktop#build`.
- Manually verify publish, archive confirmation, trash restore, permanent deletion, and Chinese/English labels in the desktop app.

## Scope

- Delete means move to trash, not immediate permanent deletion.
- The card Switch is one-way; the existing editor status controls remain.
- Archiving does not cancel an active run and does not preserve the pre-archive status.
