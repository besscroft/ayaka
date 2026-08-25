import type { ReleaseMetadata } from "../../workers/update-api";

export type ReleasePageData =
  | { status: "available"; release: ReleaseMetadata }
  | { status: "unavailable"; reason: "not-found" | "service-unavailable" };

export const LATEST_RELEASE_API = "/api/releases/latest?platform=win32&arch=x64";

function isReleaseMetadata(value: unknown): value is ReleaseMetadata {
  if (!value || typeof value !== "object") return false;

  const release = value as Partial<ReleaseMetadata>;
  return (
    typeof release.channel === "string" &&
    typeof release.version === "string" &&
    (typeof release.publishedAt === "string" || release.publishedAt === null) &&
    typeof release.downloadUrl === "string" &&
    typeof release.metadataUrl === "string" &&
    typeof release.size === "number" &&
    Number.isFinite(release.size) &&
    release.size > 0 &&
    typeof release.sha512 === "string"
  );
}

async function readLatestReleaseResponse(response: Response): Promise<ReleasePageData> {
  if (response.status === 404) {
    return { status: "unavailable", reason: "not-found" };
  }
  if (!response.ok) {
    return { status: "unavailable", reason: "service-unavailable" };
  }

  const payload: unknown = await response.json();
  if (!isReleaseMetadata(payload)) {
    return { status: "unavailable", reason: "service-unavailable" };
  }

  return { status: "available", release: payload };
}

export async function fetchLatestRelease(signal?: AbortSignal): Promise<ReleasePageData> {
  const response = await fetch(LATEST_RELEASE_API, {
    headers: { accept: "application/json" },
    signal,
  });
  return readLatestReleaseResponse(response);
}

export async function fetchLatestReleaseForRequest(request: Request): Promise<ReleasePageData> {
  try {
    const response = await fetch(new URL(LATEST_RELEASE_API, request.url), {
      headers: { accept: "application/json" },
    });
    return await readLatestReleaseResponse(response);
  } catch {
    return { status: "unavailable", reason: "service-unavailable" };
  }
}
