import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UIMessage } from "ai";
import { readScreenshotPath, sanitizeBrowserScreenshotMessage } from "@shared/browser-message";

void describe("browser screenshot message references", () => {
  void it("replaces screenshot bytes with a workspace URL", () => {
    const message = {
      id: "assistant-1",
      role: "assistant",
      parts: [
        {
          type: "tool-browser_screenshot",
          toolCallId: "call-1",
          state: "output-available",
          output: {
            type: "content",
            value: [
              {
                type: "text",
                text: JSON.stringify({
                  screenshot: {
                    path: "browser/screenshots/shot.png",
                    filename: "shot.png",
                  },
                }),
              },
              {
                type: "file",
                data: { type: "data", data: new Uint8Array([1, 2, 3]) },
                mediaType: "image/png",
                filename: "shot.png",
              },
            ],
          },
        },
      ],
    } as unknown as UIMessage;

    const sanitized = sanitizeBrowserScreenshotMessage(message);
    const output = (
      sanitized.parts[0] as unknown as {
        output: { value: Array<Record<string, unknown>> };
      }
    ).output;
    assert.equal(readScreenshotPath(output), "browser/screenshots/shot.png");
    assert.deepEqual(output.value[1]?.data, {
      type: "url",
      url: "workspace://browser/screenshots/shot.png",
    });
  });

  void it("rejects paths outside the browser screenshot directory", () => {
    assert.equal(
      readScreenshotPath({
        type: "content",
        value: [
          {
            type: "text",
            text: JSON.stringify({ screenshot: { path: "../secrets.txt" } }),
          },
        ],
      }),
      null,
    );
  });

  void it("redacts browser input text before persistence", () => {
    const message = {
      id: "assistant-2",
      role: "assistant",
      parts: [
        {
          type: "tool-browser_type",
          toolCallId: "call-2",
          state: "input-available",
          input: { ref: "e1", text: "a password", submit: true },
        },
      ],
    } as unknown as UIMessage;

    const sanitized = sanitizeBrowserScreenshotMessage(message);
    assert.deepEqual((sanitized.parts[0] as unknown as { input: unknown }).input, {
      ref: "e1",
      text: "[redacted]",
      submit: true,
    });
  });
});
