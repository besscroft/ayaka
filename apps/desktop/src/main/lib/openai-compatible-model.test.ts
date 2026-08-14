import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MockLanguageModelV4 } from "ai/test";
import { openAICompatibleImageMiddleware } from "./openai-compatible-model";

void describe("OpenAI-compatible image middleware", () => {
  void it("turns inline image data into a complete data URL", async () => {
    const model = new MockLanguageModelV4({});
    const params = {
      prompt: [
        {
          role: "user" as const,
          content: [
            {
              type: "file" as const,
              mediaType: "image/png",
              data: { type: "data" as const, data: "AA==" },
            },
          ],
        },
      ],
    } as Parameters<typeof model.doGenerate>[0];

    const transformed = await openAICompatibleImageMiddleware.transformParams?.({
      params,
      type: "generate",
      model,
    });
    const part = transformed?.prompt[0]?.content[0] as
      | { type?: string; data?: { type?: string; url?: URL } }
      | undefined;
    assert.equal(part?.type, "file");
    assert.equal(
      part?.data?.type === "url" && part.data.url?.toString(),
      "data:image/png;base64,AA==",
    );
  });

  void it("base64-encodes binary image data", async () => {
    const model = new MockLanguageModelV4({});
    const params = {
      prompt: [
        {
          role: "user" as const,
          content: [
            {
              type: "file" as const,
              mediaType: "image/jpeg",
              data: { type: "data" as const, data: new Uint8Array([255, 216]) },
            },
          ],
        },
      ],
    } as Parameters<typeof model.doGenerate>[0];
    const transformed = await openAICompatibleImageMiddleware.transformParams?.({
      params,
      type: "stream",
      model,
    });
    const part = transformed?.prompt[0]?.content[0] as
      | { data?: { type?: string; url?: URL } }
      | undefined;
    assert.equal(
      part?.data?.type === "url" && part.data.url?.toString(),
      "data:image/jpeg;base64,/9g=",
    );
  });
});
