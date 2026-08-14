import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  AgentInstanceRecord,
  AgentProfile,
  ChatToolSelectionRequest,
  ProviderInfo,
  RuntimeEvent,
  RuntimeRun,
  RuntimeStep,
} from "@shared/types";
import {
  buildAgentTree,
  buildAgentActivityItems,
  createAgentToolGroups,
  getAgentExpectedOutput,
  getAgentInstructions,
} from "@renderer/lib/agent-drawer-model";

const profile = (overrides: Partial<AgentProfile> = {}): AgentProfile => ({
  id: "root-agent",
  name: "Paimon",
  role: "General assistant",
  instructions: "Follow the user's task and report the next useful step.",
  persona: "",
  description: "A local-first assistant.",
  personality: "direct",
  soul_prompt: "",
  avatar: "P",
  status: "active",
  kind: "main",
  parent_agent_id: null,
  locked: 1,
  enabled: 1,
  tool_policy_json: "{}",
  handoff_config_json: "{}",
  runtime_config_json: "{}",
  model_ref: "openai/gpt-test",
  voice: null,
  created_at: 1,
  updated_at: 1,
  ...overrides,
});

const run: RuntimeRun = {
  id: "run-1",
  conversation_id: "conversation-1",
  root_agent_id: "root-agent",
  final_agent_id: "root-agent",
  origin: "chat",
  finish_reason: null,
  status: "running",
  model_ref: "openai/gpt-test",
  started_at: 1,
  finished_at: null,
  trace_id: null,
  input_summary: "Research a comparison brief",
  output_summary: null,
  error: null,
  usage_json: null,
};

function step(overrides: Partial<RuntimeStep> = {}): RuntimeStep {
  return {
    id: "step-1",
    run_id: "run-1",
    agent_id: "root-agent",
    tool_id: null,
    kind: "guardrail",
    status: "succeeded",
    title: "Input guardrails passed",
    detail_json: "{}",
    started_at: 1_000,
    finished_at: 1_001,
    error: null,
    ...overrides,
  };
}

function event(overrides: Partial<RuntimeEvent> = {}): RuntimeEvent {
  return {
    id: "event-1",
    run_id: "run-1",
    step_id: null,
    conversation_id: "conversation-1",
    agent_id: "root-agent",
    tool_id: "web_open",
    owner_type: null,
    owner_id: null,
    kind: "tool",
    status: "running",
    severity: "info",
    title: "tool.call",
    detail_json: JSON.stringify({ toolCallId: "call-1", toolName: "web_open" }),
    duration_ms: null,
    created_at: 1_010,
    event_type: "tool.call",
    agent_path: "/root",
    parent_agent_path: null,
    sequence: 1,
    ...overrides,
  };
}

function instance(overrides: Partial<AgentInstanceRecord>): AgentInstanceRecord {
  return {
    id: "instance-1",
    run_id: "run-1",
    agent_id: "researcher",
    agent_path: "/root/research",
    parent_instance_id: null,
    parent_agent_path: "/root",
    status: "running",
    task_name: "Web researcher",
    task_summary: "Collect source notes",
    turn_count: 1,
    last_message: null,
    error: null,
    started_at: 2,
    finished_at: null,
    created_at: 2,
    updated_at: 2,
    ...overrides,
  };
}

void describe("agent drawer model", () => {
  void it("keeps live tool calls running and pairs completed results", () => {
    const live = buildAgentActivityItems({
      runId: "run-1",
      activeAgentPath: "/root",
      steps: [],
      events: [event()],
      now: 1_250,
    });
    assert.equal(live[0]?.status, "running");
    assert.equal(live[0]?.durationMs, 240);

    const complete = buildAgentActivityItems({
      runId: "run-1",
      activeAgentPath: "/root",
      steps: [],
      events: [
        event(),
        event({
          id: "event-2",
          title: "tool.result",
          event_type: "tool.result",
          status: "running",
          detail_json: JSON.stringify({
            toolCallId: "call-1",
            toolName: "web_open",
            durationMs: 125,
            outcome: "success",
            phase: "progress",
          }),
          created_at: 1_135,
          sequence: 2,
        }),
      ],
      now: 1_250,
    });
    assert.equal(complete[0]?.status, "succeeded");
    assert.equal(complete[0]?.durationMs, 125);

    const failed = buildAgentActivityItems({
      runId: "run-1",
      activeAgentPath: "/root",
      steps: [],
      events: [
        event(),
        event({
          id: "event-3",
          title: "tool.result",
          event_type: "tool.result",
          status: "running",
          detail_json: JSON.stringify({
            toolCallId: "call-1",
            toolName: "web_open",
            durationMs: 80,
            outcome: "tool-error",
            phase: "progress",
          }),
          created_at: 1_090,
          sequence: 2,
        }),
      ],
      now: 1_250,
    });
    assert.equal(failed[0]?.status, "failed");
  });

  void it("keeps guardrail steps, falls back to steps, and tolerates malformed events", () => {
    const activities = buildAgentActivityItems({
      runId: "run-1",
      activeAgentPath: "/root",
      steps: [step()],
      events: [
        event({ detail_json: "{bad" }),
        event({
          id: "result-without-call-id",
          event_type: "tool.result",
          title: "tool.result",
          created_at: 1_020,
          detail_json: JSON.stringify({ toolName: "web_search", durationMs: 0 }),
        }),
      ],
      now: 1_250,
    });
    assert.equal(activities.length, 3);
    assert.equal(
      activities.some((item) => item.kind === "guardrail"),
      true,
    );
    assert.equal(
      activities.some((item) => item.title === "web_search"),
      true,
    );
    assert.equal(
      activities.some((item) => item.status === "running"),
      true,
    );
  });

  void it("builds a tree even when child instances arrive before their parent", () => {
    const tree = buildAgentTree({
      run,
      instances: [
        instance({
          id: "child",
          agent_id: "reviewer",
          agent_path: "/root/research/review",
          parent_agent_path: "/root/research",
          task_name: "Reviewer",
          created_at: 3,
        }),
        instance({ id: "research", created_at: 2 }),
        instance({
          id: "other",
          agent_id: "summarizer",
          agent_path: "/root/summarize",
          parent_agent_path: "/root",
          status: "completed",
          task_name: "Summarizer",
          created_at: 4,
        }),
      ],
      conversationState: {
        conversation_id: "conversation-1",
        active_agent_id: "reviewer",
        current_run_id: "run-1",
        current_step_id: "step-1",
        status: "running",
        summary: null,
        updated_at: 4,
      },
      currentStep: {
        id: "step-1",
        run_id: "run-1",
        agent_id: "reviewer",
        tool_id: null,
        kind: "model",
        status: "running",
        title: "Reviewing sources",
        detail_json: "{}",
        started_at: 4,
        finished_at: null,
        error: null,
      },
      profiles: [profile()],
      rootName: "Paimon",
      rootStatus: "running",
      rootSummary: "Researching",
      rootError: null,
    });

    assert.equal(tree.activePath, "/root/research/review");
    assert.equal(tree.root.children.length, 2);
    assert.equal(tree.root.children[0]?.children[0]?.name, "Reviewer");
    assert.equal(tree.root.children[0]?.expanded, true);
    assert.equal(tree.root.children[1]?.expanded, false);
    assert.equal(tree.root.children[1]?.descendantCount, 0);
  });

  void it("falls back through instructions and normalizes malformed output config", () => {
    const fallbackProfile = profile({ instructions: "", persona: "Use a concise tone." });
    assert.equal(getAgentInstructions(fallbackProfile), "Use a concise tone.");
    assert.equal(
      getAgentExpectedOutput(profile({ handoff_config_json: "{bad json" })),
      "Return concise findings, constraints, and recommended next steps.",
    );
  });

  void it("groups active and approval-required tools using chat selection", () => {
    const providers: ProviderInfo[] = [
      {
        id: "openai",
        label: "OpenAI",
        kind: "openai",
        source: "builtin",
        models: [
          {
            id: "gpt-test",
            enabled: true,
            source: "builtin",
            temperature: 0.7,
            topP: 1,
            maxOutputTokens: 4096,
            contextWindow: 32_000,
            capabilities: {
              textGeneration: true,
              vision: false,
              imageOutput: false,
              speechOutput: false,
              transcription: false,
              videoOutput: false,
              toolCalling: true,
              reasoning: false,
              embedding: false,
            },
            providerOptions: {},
          },
        ],
        helpUrl: "https://openai.com",
        hasApiKey: true,
        hasProviderApiKey: true,
      },
    ];
    const selection: ChatToolSelectionRequest = {
      mode: "manual",
      selectedToolIds: ["web_search"],
    };
    const groups = createAgentToolGroups({
      selectedModel: "openai/gpt-test",
      providers,
      tools: null,
      selection,
      policy: {
        mode: "custom",
        allowedToolIds: ["web_search"],
        requireApprovalToolIds: ["web_search"],
      },
    });
    const search = groups.flatMap((group) => group.tools).find((tool) => tool.id === "web_search");

    assert.equal(search?.active, true);
    assert.equal(search?.approvalRequired, true);
  });
});
