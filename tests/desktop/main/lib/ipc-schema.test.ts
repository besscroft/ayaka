import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { IpcValidationError, parseIpcInput } from "@shared/ipc-schema";

void describe("shared IPC schemas", () => {
  void it("parses message batches with a typed structural envelope", () => {
    const input = parseIpcInput("messages:saveBatch", [
      {
        id: "schema-message",
        conversation_id: "schema-conversation",
        role: "user",
        content: "{}",
        created_at: 1,
      },
    ]);
    assert.equal(input[0]?.conversation_id, "schema-conversation");
  });

  void it("rejects malformed queue lifecycle inputs before IPC handlers run", () => {
    assert.throws(
      () => parseIpcInput("runtime:cancelRun", { runId: "" }),
      (error: unknown) => error instanceof IpcValidationError && error.code === "invalid_ipc_input",
    );
    assert.throws(() =>
      parseIpcInput("messages:saveBatch", [
        {
          id: "missing-content",
          conversation_id: "schema-conversation",
          role: "user",
          created_at: 1,
        },
      ]),
    );
  });

  void it("rejects unknown fields and limits on scoped runtime status", () => {
    const input = parseIpcInput("agents:runtimeStatus", {
      conversationId: "schema-conversation",
      options: { runLimit: 1, stepLimit: 10 },
    });
    assert.equal(input.options?.runLimit, 1);

    assert.throws(() =>
      parseIpcInput("agents:runtimeStatus", {
        conversationId: "schema-conversation",
        unexpected: true,
      }),
    );
    assert.throws(() =>
      parseIpcInput("agents:runtimeStatus", {
        conversationId: "schema-conversation",
        options: { eventLimit: 301 },
      }),
    );
  });
});
