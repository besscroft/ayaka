import { describe, expect, it } from "vite-plus/test";
import {
  compareVersions,
  handleUpdateRequest,
  type UpdateEnvironment,
} from "../../apps/docs/workers/update-api.js";

const VALID_SHA512 = `${"A".repeat(86)}==`;

function createBucket(
  manifests: Record<string, string>,
  artifacts: Record<string, number>,
): R2Bucket {
  const prefixes = Object.keys(manifests).map((key) => key.replace("latest.yml", ""));
  return {
    list: async () => ({
      objects: [],
      delimitedPrefixes: prefixes,
      truncated: false,
      cursor: undefined,
    }),
    get: async (key: string) => {
      const body = manifests[key];
      if (body === undefined) return null;
      return {
        text: async () => body,
        uploaded: new Date("2026-08-08T00:00:00.000Z"),
      } as unknown as R2ObjectBody;
    },
    head: async (key: string) => {
      const size = artifacts[key];
      return size === undefined ? null : ({ size } as R2Object);
    },
  } as unknown as R2Bucket;
}

function manifest(version: string, size: number): string {
  return [
    `version: ${version}`,
    `path: ayaka-${version}-setup.exe`,
    `sha512: ${VALID_SHA512}`,
    "releaseDate: 2026-08-08T00:00:00.000Z",
    "files:",
    `  - url: ayaka-${version}-setup.exe`,
    `    sha512: ${VALID_SHA512}`,
    `    size: ${size}`,
    "",
  ].join("\n");
}

function environment(
  manifests: Record<string, string>,
  artifacts: Record<string, number>,
): UpdateEnvironment {
  return {
    RELEASES_BUCKET: createBucket(manifests, artifacts),
    UPDATE_R2_PREFIX: "releases",
    UPDATE_CHANNEL: "stable",
    UPDATE_DOWNLOAD_ORIGIN: "https://ai-release.zzzvoid.com",
  };
}

describe("R2 update API", () => {
  it("compares stable semantic versions numerically", () => {
    expect(compareVersions("0.1.10", "0.1.2")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });

  it("selects the highest valid release and exposes download metadata", async () => {
    const env = environment(
      {
        "releases/stable/v0.1.2/latest.yml": manifest("0.1.2", 120),
        "releases/stable/v0.1.10/latest.yml": manifest("0.1.10", 240),
      },
      {
        "releases/stable/v0.1.2/ayaka-0.1.2-setup.exe": 120,
        "releases/stable/v0.1.10/ayaka-0.1.10-setup.exe": 240,
      },
    );
    const response = await handleUpdateRequest(
      new Request("https://ai.zzzvoid.com/api/releases/latest?platform=win32&arch=x64"),
      env,
    );

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({
      version: "0.1.10",
      size: 240,
      downloadUrl: "https://ai-release.zzzvoid.com/releases/stable/v0.1.10/ayaka-0.1.10-setup.exe",
    });
  });

  it("rewrites the standard manifest to the fixed download origin", async () => {
    const env = environment(
      { "releases/stable/v0.1.2/latest.yml": manifest("0.1.2", 120) },
      { "releases/stable/v0.1.2/ayaka-0.1.2-setup.exe": 120 },
    );
    const response = await handleUpdateRequest(
      new Request("https://ai.zzzvoid.com/api/updates/win32/x64/latest.yml"),
      env,
    );

    expect(response?.headers.get("content-type")).toContain("text/yaml");
    const body = await response!.text();
    expect(body).toContain(
      "path: https://ai-release.zzzvoid.com/releases/stable/v0.1.2/ayaka-0.1.2-setup.exe",
    );
    expect(body).toContain(
      "url: https://ai-release.zzzvoid.com/releases/stable/v0.1.2/ayaka-0.1.2-setup.exe",
    );
  });

  it("skips an invalid highest release and falls back to the next valid one", async () => {
    const invalidManifest = manifest("0.1.10", 240).replaceAll(VALID_SHA512, "invalid");
    const env = environment(
      {
        "releases/stable/v0.1.2/latest.yml": manifest("0.1.2", 120),
        "releases/stable/v0.1.10/latest.yml": invalidManifest,
      },
      {
        "releases/stable/v0.1.2/ayaka-0.1.2-setup.exe": 120,
        "releases/stable/v0.1.10/ayaka-0.1.10-setup.exe": 240,
      },
    );
    const response = await handleUpdateRequest(
      new Request("https://ai.zzzvoid.com/api/releases/latest?platform=win32&arch=x64"),
      env,
    );

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({ version: "0.1.2" });
  });

  it("rejects unsupported platform requests", async () => {
    const response = await handleUpdateRequest(
      new Request("https://ai.zzzvoid.com/api/releases/latest?platform=darwin&arch=arm64"),
      environment({}, {}),
    );
    expect(response?.status).toBe(400);
  });

  it("returns not found when no complete release exists", async () => {
    const response = await handleUpdateRequest(
      new Request("https://ai.zzzvoid.com/api/releases/latest?platform=win32&arch=x64"),
      environment({ "releases/stable/v0.1.2/latest.yml": manifest("0.1.2", 120) }, {}),
    );
    expect(response?.status).toBe(404);
  });

  it("rejects state-changing methods for update endpoints", async () => {
    const response = await handleUpdateRequest(
      new Request("https://ai.zzzvoid.com/api/releases/latest", {
        method: "POST",
      }),
      environment({}, {}),
    );
    expect(response?.status).toBe(405);
  });
});
