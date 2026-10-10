import type {
  AgentCollaborationMessage,
  AgentContextCheckpoint,
  AgentInstanceRecord,
  AgentProfile,
  AgentRunInput,
  AgentRuntimeState,
  ConversationAgentState,
  InteractionProfile,
  MemoryRecord,
  RuntimeEvent,
  RuntimeRun,
  RuntimeSnapshot,
  RuntimeStatusSnapshot,
  RuntimeStep,
  SandboxArtifact,
  SandboxSessionView,
  SandboxSnapshot,
  SyncState,
} from "../../shared/types";

// Keep the aggregator independent from Drizzle. db.ts supplies narrow readers, while this
// module owns which records belong to a hot status response versus a cold diagnostic snapshot.
export interface RuntimeSnapshotReaders {
  listRuntimeRuns: () => RuntimeRun[];
  listRuntimeSteps: () => RuntimeStep[];
  listAgentRuntimeStates: () => AgentRuntimeState[];
  listConversationAgentStates: () => ConversationAgentState[];
  listSandboxSessions: () => SandboxSessionView[];
  listSandboxSnapshots: () => SandboxSnapshot[];
  listSandboxArtifacts: () => SandboxArtifact[];
  listAgentRunInputs: () => AgentRunInput[];
  listRuntimeEvents: () => RuntimeEvent[];
  listAgentInstances: () => AgentInstanceRecord[];
  listCollaborationMessages: () => AgentCollaborationMessage[];
  listContextCheckpoints: () => AgentContextCheckpoint[];
  listAgents: () => AgentProfile[];
  listMemories: () => MemoryRecord[];
  listInteractionProfiles: () => InteractionProfile[];
  getSyncState: () => SyncState;
}

export interface RuntimeStatusReaders {
  listRuntimeRunsForConversation: (conversationId: string, limit: number) => RuntimeRun[];
  getRuntimeRunForConversation: (conversationId: string, runId: string) => RuntimeRun | null;
  listRuntimeStepsForRun: (runId: string, limit: number) => RuntimeStep[];
  listAgentRunInputsForRun: (runId: string, limit: number) => AgentRunInput[];
  listRuntimeEventsForRun: (runId: string, limit: number) => RuntimeEvent[];
  listAgentInstancesForRun: (runId: string, limit: number) => AgentInstanceRecord[];
  getConversationAgentState: (conversationId: string) => ConversationAgentState | null;
}

export interface RuntimeStatusOptions {
  runId?: string | null;
  runLimit?: number;
  inputLimit?: number;
  stepLimit?: number;
  eventLimit?: number;
  instanceLimit?: number;
}

export type AgentRuntimeSnapshot = Pick<
  RuntimeSnapshot,
  | "runtimeRuns"
  | "agentRunInputs"
  | "runtimeSteps"
  | "agentRuntimeStates"
  | "conversationAgentStates"
  | "sandboxSessions"
  | "sandboxSnapshots"
  | "sandboxArtifacts"
  | "runtimeEvents"
  | "agentInstances"
  | "collaborationMessages"
  | "contextCheckpoints"
>;

export function buildAgentRuntimeSnapshot(readers: RuntimeSnapshotReaders): AgentRuntimeSnapshot {
  return {
    runtimeRuns: readers.listRuntimeRuns(),
    agentRunInputs: readers.listAgentRunInputs(),
    runtimeSteps: readers.listRuntimeSteps(),
    agentRuntimeStates: readers.listAgentRuntimeStates(),
    conversationAgentStates: readers.listConversationAgentStates(),
    sandboxSessions: readers.listSandboxSessions(),
    sandboxSnapshots: readers.listSandboxSnapshots(),
    sandboxArtifacts: readers.listSandboxArtifacts(),
    runtimeEvents: readers.listRuntimeEvents(),
    agentInstances: readers.listAgentInstances(),
    collaborationMessages: readers.listCollaborationMessages(),
    contextCheckpoints: readers.listContextCheckpoints(),
  };
}

export function buildRuntimeSnapshot(readers: RuntimeSnapshotReaders): RuntimeSnapshot {
  return {
    agents: readers.listAgents(),
    runtimeRuns: readers.listRuntimeRuns(),
    runtimeSteps: readers.listRuntimeSteps(),
    agentRuntimeStates: readers.listAgentRuntimeStates(),
    conversationAgentStates: readers.listConversationAgentStates(),
    sandboxSessions: readers.listSandboxSessions(),
    sandboxSnapshots: readers.listSandboxSnapshots(),
    sandboxArtifacts: readers.listSandboxArtifacts(),
    memories: readers.listMemories(),
    agentRunInputs: readers.listAgentRunInputs(),
    runtimeEvents: readers.listRuntimeEvents(),
    agentInstances: readers.listAgentInstances(),
    collaborationMessages: readers.listCollaborationMessages(),
    contextCheckpoints: readers.listContextCheckpoints(),
    interactionProfiles: readers.listInteractionProfiles(),
    syncState: readers.getSyncState(),
  };
}

function boundedLimit(value: number | undefined, fallback: number, maximum: number): number {
  return Math.max(1, Math.min(maximum, Math.floor(value ?? fallback)));
}

const ACTIVE_RUN_STATUSES = new Set(["queued", "running", "waiting_approval", "waiting_handoff"]);

export function buildRuntimeStatusSnapshot(
  readers: RuntimeStatusReaders,
  conversationId: string,
  options: RuntimeStatusOptions = {},
): RuntimeStatusSnapshot {
  const runLimit = boundedLimit(options.runLimit, 20, 50);
  const inputLimit = boundedLimit(options.inputLimit, 200, 500);
  const stepLimit = boundedLimit(options.stepLimit, 100, 300);
  const eventLimit = boundedLimit(options.eventLimit, 100, 300);
  const instanceLimit = boundedLimit(options.instanceLimit, 100, 300);
  const latestRuns = readers.listRuntimeRunsForConversation(conversationId, runLimit);
  const requestedRun = options.runId
    ? (latestRuns.find((run) => run.id === options.runId) ??
      readers.getRuntimeRunForConversation(conversationId, options.runId))
    : null;
  const runtimeRuns = requestedRun
    ? [
        requestedRun,
        ...latestRuns.filter((run) => run.id !== requestedRun.id).slice(0, runLimit - 1),
      ].sort((a, b) => b.started_at - a.started_at)
    : latestRuns;
  const selectedRun =
    requestedRun ??
    runtimeRuns.find((run) => ACTIVE_RUN_STATUSES.has(run.status)) ??
    runtimeRuns[0] ??
    null;
  const runId = selectedRun?.id;

  return {
    runtimeRuns,
    runtimeSteps: runId ? readers.listRuntimeStepsForRun(runId, stepLimit) : [],
    conversationAgentStates: [readers.getConversationAgentState(conversationId)].filter(
      (state): state is ConversationAgentState => state !== null,
    ),
    agentInstances: runId ? readers.listAgentInstancesForRun(runId, instanceLimit) : [],
    agentRunInputs: runId ? readers.listAgentRunInputsForRun(runId, inputLimit) : [],
    runtimeEvents: runId ? readers.listRuntimeEventsForRun(runId, eventLimit) : [],
  };
}
