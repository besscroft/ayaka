import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ModelMessage, UIMessage } from "ai";
import {
  reconcileToolResults,
  removeIncompleteToolParts,
} from "@desktop-main/lib/agent-tool-results";

function result(
  toolCallId: string,
  toolName: string,
  output: unknown,
): { toolCallId: string; toolName: string; output: unknown } {
  return { toolCallId, toolName, output };
}

void describe("agent tool-result reconciliation", () => {
  void it("adds all missing results for parallel tool calls in result order", () => {
    const responseMessages: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "call-1", toolName: "web_search", input: {} },
          { type: "tool-call", toolCallId: "call-2", toolName: "current_time", input: {} },
          { type: "tool-call", toolCallId: "call-3", toolName: "web_open", input: {} },
        ],
      },
    ];

    const reconciled = reconcileToolResults(responseMessages, [
      result("call-1", "web_search", { title: "one" }),
      result("call-2", "current_time", "2026-08-13T12:00:00Z"),
      result("call-3", "web_open", { content: "three" }),
    ]);

    assert.deepEqual(reconciled[1], {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call-1",
          toolName: "web_search",
          output: { type: "json", value: { title: "one" } },
        },
        {
          type: "tool-result",
          toolCallId: "call-2",
          toolName: "current_time",
          output: { type: "text", value: "2026-08-13T12:00:00Z" },
        },
        {
          type: "tool-result",
          toolCallId: "call-3",
          toolName: "web_open",
          output: { type: "json", value: { content: "three" } },
        },
      ],
    });
  });

  void it("does not duplicate results already returned in response messages", () => {
    const responseMessages: ModelMessage[] = [
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "web_search",
            output: { type: "json", value: { title: "existing" } },
          },
        ],
      },
    ];

    const reconciled = reconcileToolResults(responseMessages, [
      result("call-1", "web_search", { title: "duplicate" }),
      result("call-2", "current_time", "now"),
    ]);

    assert.equal(reconciled.length, 2);
    assert.deepEqual((reconciled[1] as Extract<ModelMessage, { role: "tool" }>).content, [
      {
        type: "tool-result",
        toolCallId: "call-2",
        toolName: "current_time",
        output: { type: "text", value: "now" },
      },
    ]);
  });

  void it("removes incomplete persisted tool calls but keeps completed results and text", () => {
    const messages: UIMessage[] = [
      { id: "user-1", role: "user", parts: [{ type: "text", text: "Search" }] },
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          { type: "text", text: "I will search." },
          {
            type: "tool-web_search",
            toolCallId: "call-1",
            state: "input-available",
            input: { query: "one" },
          } as UIMessage["parts"][number],
          {
            type: "tool-current_time",
            toolCallId: "call-2",
            state: "output-available",
            input: {},
            output: { localDateTime: "now" },
          } as UIMessage["parts"][number],
          {
            type: "dynamic-tool",
            toolName: "web_open",
            toolCallId: "call-3",
            state: "output-error",
            errorText: "failed",
          } as UIMessage["parts"][number],
        ],
      },
    ];

    const sanitized = removeIncompleteToolParts(messages);
    assert.deepEqual(sanitized[0], messages[0]);
    assert.deepEqual(sanitized[1].parts, [
      { type: "text", text: "I will search." },
      {
        type: "tool-current_time",
        toolCallId: "call-2",
        state: "output-available",
        input: {},
        output: { localDateTime: "now" },
      },
      {
        type: "dynamic-tool",
        toolName: "web_open",
        toolCallId: "call-3",
        state: "output-error",
        errorText: "failed",
      },
    ]);
  });
});
