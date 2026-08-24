import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getChatErrorInfo,
  getChatErrorMessage,
  getErrorMessage,
  isChatErrorRetryable,
} from "@renderer/lib/errors";

void describe("chat error helpers", () => {
  void it("maps browser fetch failures to a retryable local service message", () => {
    const error = new TypeError("Failed to fetch");
    assert.equal(
      getChatErrorMessage(error, "en"),
      "Unable to connect to OpenCode Zen or the local chat service. Check your network and try again.",
    );
    assert.equal(isChatErrorRetryable(error, "en"), true);
  });

  void it("parses safe server envelopes without displaying their raw error text", () => {
    const error = new Error(
      JSON.stringify({
        error: "provider said: api_key=secret",
        code: "rate_limited",
        retryable: true,
      }),
    );
    const info = getChatErrorInfo(error, "en");
    assert.deepEqual(info, {
      code: "rate_limited",
      message:
        "The model service quota or IP limit was reached; free models can be affected too. Try again later.",
      retryable: true,
    });
    assert.equal(info.message.includes("secret"), false);
  });

  void it("classifies an unavailable model without asking for an API key", () => {
    const info = getChatErrorInfo(
      Object.assign(new Error("model not found"), { statusCode: 404 }),
      "en",
    );
    assert.equal(info.code, "model_unavailable");
    assert.equal(
      info.message,
      "The selected model may be unavailable. Refresh the model list or choose another model.",
    );
    assert.equal(info.message.toLowerCase().includes("api key"), false);
  });

  void it("hides unstructured server details behind a safe chat message", () => {
    const error = Object.assign(new Error("database locked: secret-token"), { statusCode: 500 });
    assert.equal(
      getChatErrorMessage(error, "en"),
      "The model provider could not complete the request. Try again shortly.",
    );
    assert.equal(getChatErrorMessage(error, "en").includes("database locked"), false);
  });

  void it("recognizes safe stream provider messages as retryable", () => {
    const info = getChatErrorInfo(
      new Error("The model provider could not complete the request. Try again shortly."),
      "en",
    );
    assert.equal(info.code, "provider");
    assert.equal(info.retryable, true);
  });

  void it("classifies configuration errors as non-retryable", () => {
    const info = getChatErrorInfo(new Error("Provider API key is missing"), "en");
    assert.equal(info.code, "configuration");
    assert.equal(info.retryable, false);
    assert.equal(
      info.message,
      "The selected model is not configured correctly. Check its provider settings.",
    );
  });

  void it("keeps non-chat provider validation messages localized", () => {
    assert.equal(
      getErrorMessage(new Error("Base URL must start with http:// or https://"), "en"),
      "Base URL must start with http:// or https://",
    );
    assert.equal(
      getErrorMessage(new Error("Provider options must be valid JSON"), "en"),
      "Provider Options must be a JSON object",
    );
  });
});
