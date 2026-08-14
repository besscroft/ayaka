import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AgentCoordinator } from "@desktop-main/lib/agent-coordinator";
import {
  AI_SDK_BACKEND_CAPABILITIES,
  OPENAI_RESPONSES_MULTI_AGENT_CAPABILITIES,
  canUseHostedMultiAgent,
} from "@desktop-main/lib/agent-execution-backend";

void describe("AgentCoordinator", () => {
  void it("creates stable hierarchical paths and respects the tree-wide concurrency limit", async () => {
    let active = 0;
    let maximum = 0;
    const releases: Array<() => void> = [];
    const coordinator = new AgentCoordinator({ runId: "run-1", maxConcurrentSubagents: 2 });
    const execute = async (): Promise<string> => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return "done";
    };

    const a = coordinator.spawnAgent({
      agentId: "researcher",
      parentPath: "/root",
      taskName: "Research",
      message: "a",
      execute,
    });
    const b = coordinator.spawnAgent({
      agentId: "researcher",
      parentPath: "/root",
      taskName: "Research",
      message: "b",
      execute,
    });
    const c = coordinator.spawnAgent({
      agentId: "reviewer",
      parentPath: a.agent_path,
      taskName: "Tests",
      message: "c",
      execute,
    });

    assert.equal(a.agent_path, "/root/research");
    assert.equal(b.agent_path, "/root/research-2");
    assert.equal(c.agent_path, "/root/research/tests");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(maximum, 2);
    releases.shift()?.();
    releases.shift()?.();
    await new Promise((resolve) => setImmediate(resolve));
    releases.shift()?.();
    await Promise.all([
      coordinator.waitAgent(a.agent_path),
      coordinator.waitAgent(b.agent_path),
      coordinator.waitAgent(c.agent_path),
    ]);
    assert.equal(maximum, 2);
  });

  void it("queues mailbox messages, runs follow-ups, and transfers ownership", async () => {
    const seen: string[] = [];
    const coordinator = new AgentCoordinator({ runId: "run-2" });
    const instance = coordinator.spawnAgent({
      agentId: "operator",
      parentPath: "/root",
      taskName: "Operator",
      message: "first",
      execute: async ({ message, mailbox }) => {
        seen.push(message, ...mailbox.map((item) => item.content));
        return `result:${message}`;
      },
    });
    assert.equal(await coordinator.waitAgent(instance.agent_path), "result:first");
    coordinator.sendMessage("/root", instance.agent_path, "note");
    assert.equal(await coordinator.followupTask(instance.agent_path, "second"), "result:second");
    coordinator.transferOwnership(instance.agent_path);
    assert.equal(coordinator.currentOwnerPath(), instance.agent_path);
    assert.ok(seen.includes("note"));
    assert.equal(coordinator.listAgents()[0]?.turn_count, 2);
  });

  void it("interrupts one branch without removing its record", async () => {
    const coordinator = new AgentCoordinator({ runId: "run-3" });
    const instance = coordinator.spawnAgent({
      agentId: "slow",
      parentPath: "/root",
      taskName: "Slow",
      message: "wait",
      execute: async ({ abortSignal }) =>
        await new Promise<string>((_resolve, reject) => {
          abortSignal.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    });
    const waiting = coordinator.waitAgent(instance.agent_path).catch((error: unknown) => error);
    coordinator.interruptAgent(instance.agent_path);
    const error = await waiting;
    assert.equal(error instanceof DOMException, true);
    assert.equal(coordinator.listAgents()[0]?.status, "interrupted");
  });
});

void describe("AgentExecutionBackend capabilities", () => {
  void it("only allows hosted collaboration when tool policies are compatible", () => {
    assert.equal(
      canUseHostedMultiAgent({
        capabilities: AI_SDK_BACKEND_CAPABILITIES,
        toolPolicySignatures: ["a"],
      }),
      false,
    );
    assert.equal(
      canUseHostedMultiAgent({
        capabilities: OPENAI_RESPONSES_MULTI_AGENT_CAPABILITIES,
        toolPolicySignatures: ["same", "same"],
      }),
      true,
    );
    assert.equal(
      canUseHostedMultiAgent({
        capabilities: OPENAI_RESPONSES_MULTI_AGENT_CAPABILITIES,
        toolPolicySignatures: ["root", "child"],
      }),
      false,
    );
  });
});
