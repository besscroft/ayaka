import { describe, expect, it } from "vite-plus/test";

import {
  fetchLatestRelease,
  fetchLatestReleaseForRequest,
  LATEST_RELEASE_API,
} from "../../apps/docs/app/lib/release-client.js";

const RELEASE = {
  channel: "stable",
  version: "0.1.10",
  publishedAt: "2026-08-08T00:00:00.000Z",
  downloadUrl: "https://ai-release.zzzvoid.com/releases/stable/v0.1.10/ayaka-0.1.10-setup.exe",
  metadataUrl: "https://ai.zzzvoid.com/api/updates/win32/x64/latest.yml",
  size: 240,
  sha512: `${"A".repeat(86)}==`,
};

describe("website release client", () => {
  it("uses the compatible Windows release API and returns its installer URL", async () => {
    const originalFetch = globalThis.fetch;
    let requestUrl = "";
    globalThis.fetch = async (input) => {
      requestUrl =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return new Response(JSON.stringify(RELEASE), { status: 200 });
    };

    try {
      await expect(fetchLatestRelease()).resolves.toEqual({
        status: "available",
        release: RELEASE,
      });
      expect(requestUrl).toBe(LATEST_RELEASE_API);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("preserves the API's not-found and service-unavailable states", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(null, { status: 404 });

    try {
      await expect(fetchLatestRelease()).resolves.toEqual({
        status: "unavailable",
        reason: "not-found",
      });

      globalThis.fetch = async () => new Response(null, { status: 502 });
      await expect(fetchLatestRelease()).resolves.toEqual({
        status: "unavailable",
        reason: "service-unavailable",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("uses the same release API during SSR", async () => {
    const originalFetch = globalThis.fetch;
    let requestUrl = "";
    globalThis.fetch = async (input) => {
      requestUrl =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return new Response(JSON.stringify(RELEASE), { status: 200 });
    };

    try {
      await expect(
        fetchLatestReleaseForRequest(new Request("http://localhost:5173/")),
      ).resolves.toEqual({ status: "available", release: RELEASE });
      expect(requestUrl).toBe(`http://localhost:5173${LATEST_RELEASE_API}`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
