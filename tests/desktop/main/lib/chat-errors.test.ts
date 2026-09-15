import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chatErrorResponse,
  classifyChatError,
  redactChatDiagnostic,
} from "@desktop-main/lib/chat-errors";

void describe("chat error classification", () => {
  void it("classifies provider status codes into safe retry behavior", () => {
    const rateLimited = classifyChatError(
      Object.assign(new Error("provider throttled"), { status: 429 }),
    );
    assert.equal(rateLimited.code, "rate_limited");
    assert.equal(rateLimited.retryable, true);
    assert.equal(rateLimited.status, 429);

    const unauthorized = classifyChatError(
      Object.assign(new Error("invalid credentials"), { status: 401 }),
    );
    assert.equal(unauthorized.code, "unauthorized");
    assert.equal(unauthorized.retryable, false);
    assert.equal(unauthorized.error.includes("credentials"), false);
  });

  void it("recognizes configuration, network, and abort failures", () => {
    assert.equal(
      classifyChatError(new Error("OpenAI API key is not configured.")).code,
      "configuration",
    );
    assert.equal(classifyChatError(new TypeError("Failed to fetch")).code, "network");

    const controller = new AbortController();
    controller.abort("user_cancelled");
    assert.equal(
      classifyChatError(new DOMException("Aborted", "AbortError"), {
        abortSignal: controller.signal,
      }).code,
      "cancelled",
    );
  });

  void it("classifies unavailable local commands explicitly", () => {
    const classification = classifyChatError(
      Object.assign(new Error("Command not found: pwd"), { code: "command_not_found" }),
    );
    assert.equal(classification.code, "command_not_found");
    assert.equal(classification.retryable, false);
    assert.equal(classification.status, 400);

    const wrapped = classifyChatError({
      name: "AI_ToolExecutionError",
      message: "Tool execution failed",
      cause: Object.assign(new Error("Command not found: pwd"), { code: "command_not_found" }),
    });
    assert.equal(wrapped.code, "command_not_found");
  });

  void it("preserves provider retryability through an AI SDK RetryError wrapper", () => {
    const retryError = {
      name: "AI_RetryError",
      message: "Failed after 3 attempts.",
      errors: [
        {
          name: "AI_APICallError",
          message: "Service Unavailable",
          statusCode: 503,
          responseBody: '{"code":"SERVICE_BUSY","message":"Service busy"}',
        },
      ],
    };

    const classification = classifyChatError(retryError, { phase: "stream" });
    assert.equal(classification.code, "provider");
    assert.equal(classification.retryable, true);
    assert.equal(classification.status, 503);
  });

  void it("redacts secrets and truncates persisted diagnostics", () => {
    const diagnostic = redactChatDiagnostic(
      "Authorization: Bearer secret-token api_key=sk-abcdefghijklmnopqrstuvwxyz",
    );
    assert.equal(diagnostic.includes("secret-token"), false);
    assert.equal(diagnostic.includes("sk-abcdefghijklmnopqrstuvwxyz"), false);
    assert.equal(diagnostic.includes("[redacted]"), true);
    assert.equal(redactChatDiagnostic("x".repeat(2_100)).length, 2_000);
  });

  void it("builds public responses without diagnostic text", () => {
    assert.deepEqual(chatErrorResponse("missing_model"), {
      error: "No available model is selected. Choose or configure a model first.",
      code: "missing_model",
      retryable: false,
    });
  });
});
