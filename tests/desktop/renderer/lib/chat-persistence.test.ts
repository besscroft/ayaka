import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createSnapshotPersistenceQueue,
  mergeMessagePersistenceRequests,
  persistMessagesPatch,
} from "@renderer/lib/chat-persistence";

void describe("chat snapshot persistence queue", () => {
  void it("serializes writes and coalesces queued snapshots to the latest value", async () => {
    const persisted: number[] = [];
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const queue = createSnapshotPersistenceQueue<number>(async (snapshot) => {
      if (persisted.length === 0) await firstBlocked;
      persisted.push(snapshot);
    });

    queue.request(1);
    queue.request(2);
    queue.request(3);
    releaseFirst();
    await queue.flush();

    assert.deepEqual(persisted, [1, 3]);
  });

  void it("flushes an explicitly supplied final snapshot", async () => {
    const persisted: string[] = [];
    const queue = createSnapshotPersistenceQueue<string>(async (snapshot) => {
      persisted.push(snapshot);
    });

    await queue.flush("final");

    assert.deepEqual(persisted, ["final"]);
  });

  void it("does not write an empty hydrated snapshot", async () => {
    let callCount = 0;
    const previousWindow = globalThis.window;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        api: {
          messages: {
            applyPatch: async () => {
              callCount += 1;
              return { applied: true, revision: 1 };
            },
          },
        } as unknown as NonNullable<Window["api"]>,
      },
    });

    try {
      await persistMessagesPatch("conversation-1", { messages: [] }, new Map(), { current: 0 });
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: previousWindow,
      });
    }

    assert.equal(callCount, 0);
  });

  void it("reloads the revision and retries without deleting concurrent messages", async () => {
    const patches: Array<{ baseRevision: number; deleteIds: string[] }> = [];
    const previousWindow = globalThis.window;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        api: {
          messages: {
            applyPatch: async (patch: { baseRevision: number; deleteIds: string[] }) => {
              patches.push({ baseRevision: patch.baseRevision, deleteIds: patch.deleteIds });
              return patches.length === 1
                ? { applied: false, revision: 4 }
                : { applied: true, revision: 5 };
            },
            list: async () => ({
              revision: 4,
              messages: [
                {
                  id: "concurrent",
                  conversation_id: "conversation-1",
                  role: "assistant",
                  content:
                    '{"id":"concurrent","role":"assistant","parts":[{"type":"text","text":"saved elsewhere"}]}',
                  created_at: 1,
                },
              ],
            }),
          },
        } as unknown as NonNullable<Window["api"]>,
      },
    });

    const revision = { current: 3 };
    try {
      await persistMessagesPatch(
        "conversation-1",
        {
          messages: [{ id: "local", role: "user", parts: [{ type: "text", text: "hello" }] }],
        },
        new Map(),
        revision,
      );
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: previousWindow,
      });
    }

    assert.deepEqual(patches, [
      { baseRevision: 3, deleteIds: [] },
      { baseRevision: 4, deleteIds: [] },
    ]);
    assert.equal(revision.current, 5);
  });

  void it("coalesces explicit deletes while keeping the newest message snapshot", () => {
    const merged = mergeMessagePersistenceRequests(
      { messages: [], deleteIds: ["old-a"] },
      {
        messages: [{ id: "new", role: "user", parts: [{ type: "text", text: "new" }] }],
        deleteIds: ["old-b"],
      },
    );
    assert.deepEqual(merged.deleteIds, ["old-a", "old-b"]);
    assert.equal(merged.messages[0]?.id, "new");
  });
});
