# Remove Default Operator Agent

## Goal

New users must not receive the built-in `agent-operator` agent, displayed as
the "火种" agent in the client.

## Scope

- Remove `agent-operator` from the default child-agent seed list.
- Keep the root agent and the researcher agent unchanged.
- Do not delete or mutate existing database records. Existing installations
  may already have this agent and should retain their data.
- Keep runtime root-agent behavior unchanged; `agent-void` remains the
  required default root agent.

## Implementation

The default seed definition in `runtime-defaults.ts` is the only production
change required. Database initialization already inserts child agents by
iterating that list, so removing the seed prevents creation for new databases
without introducing a destructive migration or startup cleanup path.

## Testing

Update the runtime architecture seed test to assert that the default child
agent list contains no `agent-operator` entry. Existing assertions for the
remaining default agents and built-in tools stay in place.

## Acceptance Criteria

1. A new database initialized by the desktop app contains no `agent-operator`
   record.
2. The root agent and `agent-researcher` seed behavior remains unchanged.
3. Existing databases are not modified by this change.
4. The focused runtime architecture test passes.
