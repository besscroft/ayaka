import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { convertToModelMessages } from "ai";
import {
  generatedUIComponentCount,
  generatedUICatalog,
  generatedUICatalogPrompt,
} from "../../../../apps/desktop/src/shared/generated-ui/catalog";
import {
  canonicalizeGeneratedUISpecMessage,
  createGeneratedUIStateStore,
  isGeneratedUISpecPart,
} from "../../../../apps/desktop/src/shared/generated-ui/message";
import { pipeGeneratedUIStream } from "../../../../apps/desktop/src/main/lib/generated-ui-stream";

async function readStream(stream: ReadableStream<unknown>): Promise<unknown[]> {
  const reader = stream.getReader();
  const chunks: unknown[] = [];
  for (;;) {
    const result = await reader.read();
    if (result.done) return chunks;
    chunks.push(result.value);
  }
}

function streamFrom(chunks: unknown[]): ReadableStream<unknown> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

void describe("generated UI integration", () => {
  void it("builds an inline catalog prompt with the full shadcn vocabulary", () => {
    assert.match(generatedUICatalogPrompt, /text \+ JSONL/i);
    assert.match(generatedUICatalogPrompt, /Card/);
    assert.match(generatedUICatalogPrompt, /Button/);
    assert.equal(generatedUIComponentCount, 36);
    assert.deepEqual(generatedUICatalog.actionNames, []);
  });

  void it("converts JSONL patch lines to data-spec without losing prose", async () => {
    const chunks = await readStream(
      pipeGeneratedUIStream(
        streamFrom([
          { type: "text-start", id: "text-1" },
          { type: "text-delta", id: "text-1", delta: "Here is a card.\n" },
          {
            type: "text-delta",
            id: "text-1",
            delta: '{"op":"add","path":"/root","value":"card"}\n',
          },
          {
            type: "text-delta",
            id: "text-1",
            delta:
              '{"op":"add","path":"/elements/card","value":{"type":"Card","props":{"title":"Hello"}}}\n',
          },
          { type: "text-delta", id: "text-1", delta: "Done." },
          { type: "text-end", id: "text-1" },
        ]),
      ),
    );
    assert.ok(chunks.some((chunk) => (chunk as { type?: string }).type === "data-spec"));
    assert.ok(chunks.some((chunk) => (chunk as { type?: string }).type === "text-delta"));
  });

  void it("keeps text-only streams free of generated UI parts", async () => {
    const chunks = await readStream(
      pipeGeneratedUIStream(
        streamFrom([
          { type: "text-start", id: "text-1" },
          { type: "text-delta", id: "text-1", delta: "Just text." },
          { type: "text-end", id: "text-1" },
        ]),
      ),
    );
    assert.equal(
      chunks.some((chunk) => (chunk as { type?: string }).type === "data-spec"),
      false,
    );
  });

  void it("filters data-spec from model messages", async () => {
    const converted = await convertToModelMessages(
      [
        {
          role: "assistant",
          parts: [
            { type: "text", text: "Visible answer" },
            {
              type: "data-spec",
              data: {
                type: "flat",
                spec: { root: "card", elements: {}, state: {} },
              },
            },
          ],
        },
      ],
      { convertDataPart: () => undefined },
    );
    assert.deepEqual(converted, [
      {
        role: "assistant",
        content: [{ type: "text", text: "Visible answer" }],
      },
    ]);
  });

  void it("canonicalizes streamed parts and preserves the first data-part position", () => {
    const message = {
      id: "assistant-1",
      role: "assistant" as const,
      parts: [
        { type: "text" as const, text: "Before" },
        {
          type: "data-spec" as const,
          data: {
            type: "patch" as const,
            patch: { op: "add" as const, path: "/root", value: "card" },
          },
        },
        {
          type: "data-spec" as const,
          data: {
            type: "patch" as const,
            patch: { op: "add" as const, path: "/state/name", value: "Ayaka" },
          },
        },
        { type: "text" as const, text: "After" },
      ],
    };
    const next = canonicalizeGeneratedUISpecMessage(message, {
      root: "card",
      elements: { card: { type: "Card", props: {}, children: [] } },
      state: { name: "Ayaka" },
    });
    assert.deepEqual(
      next.parts.map((part) => part.type),
      ["text", "data-spec", "text"],
    );
    assert.deepEqual((next.parts[1] as { data: { type: string; spec: unknown } }).data, {
      type: "flat",
      spec: {
        root: "card",
        elements: { card: { type: "Card", props: {}, children: [] } },
        state: { name: "Ayaka" },
      },
    });
  });

  void it("keeps generated UI state stores isolated and observable", () => {
    const snapshots: Array<Record<string, unknown>> = [];
    const store = createGeneratedUIStateStore({ form: { name: "" } }, (state) => {
      snapshots.push(state);
    });
    store.set("/form/name", "Ayaka");
    assert.equal(store.get("/form/name"), "Ayaka");
    assert.deepEqual(snapshots.at(-1), { form: { name: "Ayaka" } });

    const otherStore = createGeneratedUIStateStore({ form: { name: "Other" } }, () => undefined);
    assert.equal(otherStore.get("/form/name"), "Other");
  });

  void it("rejects malformed data-spec parts without throwing", () => {
    assert.equal(isGeneratedUISpecPart({ type: "data-spec", data: null }), false);
    assert.equal(isGeneratedUISpecPart({ type: "data-spec", data: { type: "unknown" } }), false);
  });
});
