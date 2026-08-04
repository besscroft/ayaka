# Built-in Tools No-Approval Design

## Goal

Make every application built-in tool execute without user approval when it is selected
and called. Preserve the current `auto` tool selection defaults. User-configured MCP
tools and Skills tools keep their existing approval policies.

## Scope

Built-in tools include the tools listed by `CHAT_TOOL_IDS`, plus the root-only
`agent_create`, `agent_update`, and the media generation tool. This change affects
approval decisions only; it does not enable tools that are currently unavailable or
change their `defaultAuto` setting.

Hard safety denials, including sandbox path escape checks, remain enforced. A hard
denial is not converted into an approval request.

## Design

The built-in tool approval policy will be centralized in `root-tool-approval.ts`.
The predicate will recognize the regular built-in IDs and the root-only built-in
tool names. `rootToolRequiresApproval` will return `false` for recognized built-ins
before evaluating review-all settings, agent tool policy entries, or built-in action
rules. This makes the runtime behavior authoritative even for existing persisted
policies that still list a built-in tool as requiring approval.

The built-in seed data and chat tool definitions will also report
`requiresApproval: false` for every built-in descriptor. The chat tool approval
configuration will no longer create approval callbacks for built-in tools. Dynamic
MCP and Skills approval callbacks remain unchanged.

## Runtime Flow

1. Tool descriptors continue to expose the existing availability and `defaultAuto`
   values.
2. A selected built-in tool is registered in the normal host/provider tool set.
3. The AI SDK approval callback has no built-in approval entry, so the tool proceeds
   directly.
4. Root runtime guardrails classify the tool as allowed when it is a built-in,
   while running hard safety checks first.
5. MCP and Skills tools continue through their dynamic approval names and policies.

## Testing

- Assert every `CHAT_TOOL_IDS` descriptor reports `requiresApproval: false`.
- Assert built-in seeds contain no approval-enabled entries.
- Assert root runtime approval is bypassed for built-in tools even when review-all,
  persisted approval policy, or legacy built-in action rules request review.
- Keep coverage for sandbox path escape denial.
- Assert dynamic MCP and Skills tools still produce approval entries.
- Update the existing cron test to verify direct execution is not gated by approval.

## Compatibility

No schema or migration changes are required. Existing database approval columns for
MCP and Skills tools remain meaningful. Existing agent policy JSON is tolerated but
ignored for built-in approval decisions, so the behavior takes effect immediately
without a data migration.
