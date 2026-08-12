import type {
  AgentInstanceRecord,
  AgentProfile,
  AgentToolPolicy,
  ChatToolDescriptor,
  ChatToolSelectionRequest,
  ConversationAgentState,
  RuntimeEvent,
  RuntimeRun,
  RuntimeStep,
  ToolsSnapshot,
} from "@shared/types";
import {
  DEFAULT_AGENT_HANDOFF_CONFIG,
  DEFAULT_AGENT_TOOL_POLICY,
  normalizeAgentHandoffConfig,
  normalizeAgentToolPolicy,
} from "@shared/types";
import {
  createClientChatToolDescriptors,
  filterUserVisibleChatToolDescriptors,
  getActiveChatToolIds,
} from "./chat-tools";

export interface AgentTreeNode {
  id: string;
  agentId: string | null;
  name: string;
  path: string;
  depth: number;
  status: string;
  summary: string | null;
  error: string | null;
  descendantCount: number;
  expanded: boolean;
  active: boolean;
  children: AgentTreeNode[];
}

export interface AgentTreeModel {
  root: AgentTreeNode;
  activePath: string;
}

export interface AgentToolView extends ChatToolDescriptor {
  active: boolean;
  approvalRequired: boolean;
}

export interface AgentToolGroup {
  category: ChatToolDescriptor["category"];
  tools: AgentToolView[];
}

export interface AgentActivityItem {
  id: string;
  kind: RuntimeStep["kind"];
  status: string;
  title: string;
  startedAt: number;
  finishedAt: number | null;
  durationMs: number;
  error: string | null;
}

export function getAgentInstructions(profile: AgentProfile | null): string {
  if (!profile) return "";
  return firstNonEmpty(profile.instructions, profile.persona, profile.description);
}

export function getAgentExpectedOutput(profile: AgentProfile | null): string {
  if (!profile) return DEFAULT_AGENT_HANDOFF_CONFIG.expectedOutput;
  return normalizeAgentHandoffConfig(profile.handoff_config_json).expectedOutput;
}

export function getAgentToolPolicy(profile: AgentProfile | null): AgentToolPolicy {
  return profile ? normalizeAgentToolPolicy(profile.tool_policy_json) : DEFAULT_AGENT_TOOL_POLICY;
}

export function buildAgentActivityItems({
  runId,
  activeAgentPath,
  steps,
  events,
  limit = 6,
  now = Date.now(),
}: {
  runId: string | undefined;
  activeAgentPath: string;
  steps: RuntimeStep[];
  events: RuntimeEvent[];
  limit?: number;
  now?: number;
}): AgentActivityItem[] {
  if (!runId) return [];

  const eventItems = buildToolEventActivities(
    events.filter(
      (event) =>
        event.run_id === runId &&
        event.agent_path === activeAgentPath &&
        (event.event_type === "tool.call" || event.event_type === "tool.result"),
    ),
    now,
  );
  const stepItems = steps
    .filter((step) => step.run_id === runId)
    .map((step) => ({
      id: `step:${step.id}`,
      kind: step.kind,
      status: step.status,
      title: step.title,
      startedAt: step.started_at,
      finishedAt: step.finished_at,
      durationMs:
        step.finished_at !== null
          ? Math.max(0, step.finished_at - step.started_at)
          : Math.max(0, now - step.started_at),
      error: step.error,
    }));

  return [...eventItems, ...stepItems]
    .sort((a, b) => b.startedAt - a.startedAt || b.id.localeCompare(a.id))
    .filter((item, _index, all) => {
      const duplicate = all.findIndex(
        (candidate) =>
          candidate !== item &&
          candidate.kind === item.kind &&
          candidate.title === item.title &&
          Math.abs(candidate.startedAt - item.startedAt) < 2,
      );
      return duplicate === -1 || item.id.startsWith("event:");
    })
    .slice(0, Math.max(0, limit));
}

function buildToolEventActivities(events: RuntimeEvent[], now: number): AgentActivityItem[] {
  const calls = new Map<string, RuntimeEvent>();
  const results: RuntimeEvent[] = [];
  for (const event of [...events].sort((a, b) => a.created_at - b.created_at)) {
    const detail = parseEventDetail(event.detail_json);
    const toolCallId = readString(detail, "toolCallId");
    if (event.event_type === "tool.call") {
      calls.set(toolEventKey(event, toolCallId ?? event.id), event);
    } else if (event.event_type === "tool.result") {
      results.push(event);
    }
  }

  const consumedCalls = new Set<string>();
  return results
    .map((result) => {
      const detail = parseEventDetail(result.detail_json);
      const toolCallId = readString(detail, "toolCallId");
      const call = toolCallId ? calls.get(toolEventKey(result, toolCallId)) : undefined;
      if (call && toolCallId) consumedCalls.add(toolEventKey(result, toolCallId));
      return createToolActivity(call, result, detail, now);
    })
    .concat(
      [...calls.entries()]
        .filter(([key]) => !consumedCalls.has(key))
        .map(([, call]) => createToolActivity(call, undefined, {}, now)),
    );
}

function createToolActivity(
  call: RuntimeEvent | undefined,
  result: RuntimeEvent | undefined,
  resultDetail: Record<string, unknown>,
  now: number,
): AgentActivityItem {
  const callDetail = call ? parseEventDetail(call.detail_json) : {};
  const toolName =
    readString(resultDetail, "toolName") ?? readString(callDetail, "toolName") ?? "tool";
  const durationFromResult = readFiniteNumber(resultDetail, "durationMs");
  const startedAt =
    call?.created_at ?? Math.max(0, (result?.created_at ?? now) - (durationFromResult ?? 0));
  const finishedAt = result?.created_at ?? null;
  const durationMs = Math.max(
    0,
    durationFromResult ?? (finishedAt === null ? now - startedAt : finishedAt - startedAt),
  );
  const failed =
    result?.status === "failed" ||
    readString(resultDetail, "outcome") === "tool-error" ||
    readString(resultDetail, "phase") === "error";
  return {
    id: `event:${result?.id ?? call?.id ?? toolName}`,
    kind: "tool",
    status: result ? (failed ? "failed" : "succeeded") : "running",
    title: toolName,
    startedAt,
    finishedAt,
    durationMs,
    error: failed ? readString(resultDetail, "error") : null,
  };
}

function toolEventKey(event: RuntimeEvent, toolCallId: string): string {
  return `${event.agent_path ?? ""}:${toolCallId}`;
}

function parseEventDetail(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function readFiniteNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function createAgentToolGroups({
  selectedModel,
  providers,
  tools,
  selection,
  policy,
}: {
  selectedModel: string | null;
  providers: Parameters<typeof createClientChatToolDescriptors>[0]["providers"];
  tools: ToolsSnapshot | null;
  selection: ChatToolSelectionRequest;
  policy: AgentToolPolicy;
}): AgentToolGroup[] {
  const descriptors = filterUserVisibleChatToolDescriptors(
    createClientChatToolDescriptors({ selectedModel, providers, tools: tools ?? undefined }),
  );
  const activeToolIds = new Set(getActiveChatToolIds(selection, descriptors));
  const allowedToolIds = new Set(policy.allowedToolIds);
  const approvalToolIds = new Set(policy.requireApprovalToolIds);
  const visible = descriptors.map((descriptor) => ({
    ...descriptor,
    active: activeToolIds.has(descriptor.id),
    approvalRequired: descriptor.requiresApproval || approvalToolIds.has(descriptor.id),
  }));
  const filtered =
    policy.mode === "custom"
      ? visible.filter(
          (descriptor) => allowedToolIds.has(descriptor.id) || approvalToolIds.has(descriptor.id),
        )
      : visible;
  const groups = new Map<ChatToolDescriptor["category"], AgentToolView[]>();
  for (const descriptor of filtered) {
    const group = groups.get(descriptor.category) ?? [];
    group.push(descriptor);
    groups.set(descriptor.category, group);
  }
  return Array.from(groups, ([category, groupTools]) => ({ category, tools: groupTools }));
}

export function buildAgentTree({
  run,
  instances,
  conversationState,
  currentStep,
  profiles,
  rootName,
  rootStatus,
  rootSummary,
  rootError,
}: {
  run?: RuntimeRun;
  instances: AgentInstanceRecord[];
  conversationState?: ConversationAgentState;
  currentStep?: RuntimeStep;
  profiles: AgentProfile[];
  rootName: string;
  rootStatus: string;
  rootSummary: string | null;
  rootError: string | null;
}): AgentTreeModel {
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const activeAgentId = conversationState?.active_agent_id ?? currentStep?.agent_id ?? null;
  const sortedInstances = [...instances].sort((a, b) => a.created_at - b.created_at);
  const nodeByPath = new Map<string, AgentTreeNode>();
  const rootPath = "/root";
  const root: AgentTreeNode = {
    id: `root:${run?.id ?? "idle"}`,
    agentId: run?.root_agent_id ?? null,
    name: rootName,
    path: rootPath,
    depth: 0,
    status: rootStatus,
    summary: rootSummary,
    error: rootError,
    descendantCount: 0,
    expanded: true,
    active: activeAgentId === (run?.root_agent_id ?? null),
    children: [],
  };
  nodeByPath.set(rootPath, root);

  for (const instance of sortedInstances) {
    const profile = profileById.get(instance.agent_id);
    const path = instance.agent_path || `${rootPath}/${instance.agent_id}`;
    const node: AgentTreeNode = {
      id: instance.id,
      agentId: instance.agent_id,
      name: instance.task_name || profile?.name || instance.agent_id,
      path,
      depth: Math.max(1, path.split("/").filter(Boolean).length - 1),
      status: instance.status,
      summary: instance.task_summary || instance.last_message,
      error: instance.error,
      descendantCount: 0,
      expanded: false,
      active: instance.agent_id === activeAgentId,
      children: [],
    };
    nodeByPath.set(path, node);
  }

  for (const instance of sortedInstances) {
    const path = instance.agent_path || `${rootPath}/${instance.agent_id}`;
    const node = nodeByPath.get(path);
    if (!node) continue;
    const parentPath = instance.parent_agent_path || getParentPath(path);
    const parent = nodeByPath.get(parentPath) ?? root;
    parent.children.push(node);
  }

  const activeNode = findActiveNode(root, activeAgentId, currentStep);
  const activePath = activeNode?.path ?? rootPath;
  markTreeState(root, activePath);
  return { root, activePath };
}

function markTreeState(node: AgentTreeNode, activePath: string): number {
  let descendants = 0;
  for (const child of node.children) {
    descendants += 1 + markTreeState(child, activePath);
  }
  node.descendantCount = descendants;
  node.expanded =
    node.path === "/root" || activePath === node.path || activePath.startsWith(`${node.path}/`);
  return descendants;
}

function findActiveNode(
  root: AgentTreeNode,
  activeAgentId: string | null,
  currentStep?: RuntimeStep,
): AgentTreeNode | undefined {
  if (currentStep?.agent_id) {
    const current = findNode(root, (node) => node.agentId === currentStep.agent_id);
    if (current) return current;
  }
  if (activeAgentId) return findNode(root, (node) => node.agentId === activeAgentId);
  return root;
}

function findNode(
  node: AgentTreeNode,
  predicate: (candidate: AgentTreeNode) => boolean,
): AgentTreeNode | undefined {
  if (predicate(node)) return node;
  for (const child of node.children) {
    const found = findNode(child, predicate);
    if (found) return found;
  }
  return undefined;
}

function getParentPath(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator > 0 ? path.slice(0, separator) : "/root";
}

function firstNonEmpty(...values: Array<string | null | undefined>): string {
  return values.find((value) => typeof value === "string" && value.trim())?.trim() ?? "";
}
