import { before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";

let catalog: typeof import("@desktop-main/lib/opencode-free-catalog");

const settings = new Map<string, string>();

mock.module(new URL("../../../../apps/desktop/src/main/lib/db.ts", import.meta.url).href, {
  namedExports: {
    getSetting: (key: string) => settings.get(key) ?? null,
    setSetting: (key: string, value: string) => {
      settings.set(key, value);
    },
  },
});

before(async () => {
  catalog = await import("@desktop-main/lib/opencode-free-catalog");
});

beforeEach(() => {
  settings.clear();
});

void describe("OpenCode Free model catalog", () => {
  void it("aborts a refresh that exceeds its timeout", async () => {
    let aborted = false;
    const fetchImpl: typeof fetch = async (_input, init) => {
      init?.signal?.addEventListener("abort", () => {
        aborted = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      throw Object.assign(new Error("fixture aborted"), { name: "AbortError" });
    };

    await assert.rejects(
      catalog.refreshOpenCodeFreeCatalog({ fetchImpl, timeoutMs: 1 }),
      /fixture aborted/,
    );
    assert.equal(aborted, true);
    assert.equal(settings.size, 0);
  });

  void it("rejects an oversized catalog response before parsing or persisting it", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      if (String(input) === catalog.MODELS_DEV_URL) {
        return new Response("{" + "x".repeat(256), { status: 200 });
      }
      return new Response(JSON.stringify({ data: [{ id: "big-pickle" }] }), { status: 200 });
    };

    await assert.rejects(
      catalog.refreshOpenCodeFreeCatalog({ fetchImpl, maxBodyBytes: 64 }),
      /response is too large/,
    );
    assert.equal(settings.size, 0);
  });
});
