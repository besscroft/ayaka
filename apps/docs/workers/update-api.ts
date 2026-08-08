import YAML from "yaml";

const PLATFORM = "win32";
const ARCH = "x64";
const MANIFEST_NAME = "latest.yml";
const VERSION_PATTERN = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

interface ReleaseManifestFile {
  url?: unknown;
  sha512?: unknown;
  size?: unknown;
}

interface ReleaseManifest {
  version?: unknown;
  path?: unknown;
  sha512?: unknown;
  releaseDate?: unknown;
  files?: unknown;
}

interface ReleaseCandidate {
  version: string;
  prefix: string;
}

export interface ReleaseMetadata {
  channel: string;
  version: string;
  publishedAt: string | null;
  downloadUrl: string;
  metadataUrl: string;
  size: number;
  sha512: string;
}

export interface UpdateEnvironment {
  RELEASES_BUCKET: R2Bucket;
  UPDATE_R2_PREFIX?: string;
  UPDATE_CHANNEL?: string;
  UPDATE_DOWNLOAD_ORIGIN?: string;
}

class UpdateApiError extends Error {
  constructor(
    readonly status: 400 | 404 | 502,
    message: string,
  ) {
    super(message);
  }
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=60, s-maxage=300",
    },
  });
}

function errorResponse(error: unknown): Response {
  if (error instanceof UpdateApiError) {
    return jsonResponse({ error: error.message }, error.status);
  }
  console.error("[updates] unexpected error", error);
  return jsonResponse({ error: "Update service unavailable." }, 502);
}

function config(env: UpdateEnvironment): {
  prefix: string;
  channel: string;
  downloadOrigin: string;
} {
  const prefix = (env.UPDATE_R2_PREFIX || "releases").replace(/^\/+|\/+$/g, "");
  const channel = env.UPDATE_CHANNEL || "stable";
  const downloadOrigin = (env.UPDATE_DOWNLOAD_ORIGIN || "https://ai-release.zzzvoid.com").replace(
    /\/+$/,
    "",
  );
  try {
    new URL(downloadOrigin);
  } catch {
    throw new UpdateApiError(502, "Update download origin is invalid.");
  }
  return { prefix, channel, downloadOrigin };
}

function parseVersion(value: string): [number, number, number] | null {
  const match = VERSION_PATTERN.exec(value);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return 0;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function versionFromPrefix(prefix: string, rootPrefix: string): ReleaseCandidate | null {
  const remainder = prefix.slice(rootPrefix.length).replace(/\/$/, "");
  const version = remainder.startsWith("v") ? remainder.slice(1) : remainder;
  if (!parseVersion(version)) return null;
  return { version, prefix };
}

async function listCandidates(bucket: R2Bucket, rootPrefix: string): Promise<ReleaseCandidate[]> {
  const candidates: ReleaseCandidate[] = [];
  let cursor: string | undefined;
  do {
    const result = await bucket.list({
      prefix: rootPrefix,
      delimiter: "/",
      cursor,
      limit: 1000,
    });
    for (const prefix of result.delimitedPrefixes) {
      const candidate = versionFromPrefix(prefix, rootPrefix);
      if (candidate) candidates.push(candidate);
    }
    cursor = result.truncated ? result.cursor : undefined;
  } while (cursor);
  return candidates.sort((left, right) => compareVersions(right.version, left.version));
}

function safeArtifactName(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  if (value.includes("/") || value.includes("\\") || value === "." || value === "..") {
    return null;
  }
  if (!value.toLowerCase().endsWith(".exe")) return null;
  return value;
}

function manifestFile(manifest: ReleaseManifest): ReleaseManifestFile | null {
  if (!Array.isArray(manifest.files)) return null;
  const first = manifest.files[0];
  return first && typeof first === "object" ? (first as ReleaseManifestFile) : null;
}

function readManifest(
  text: string,
  candidate: ReleaseCandidate,
): {
  manifest: ReleaseManifest;
  artifactName: string;
  sha512: string;
  size: number;
} {
  let parsed: unknown;
  try {
    parsed = YAML.parse(text);
  } catch {
    throw new UpdateApiError(502, "The latest update manifest is invalid.");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new UpdateApiError(502, "The latest update manifest is invalid.");
  }

  const manifest = parsed as ReleaseManifest;
  if (manifest.version !== candidate.version) {
    throw new UpdateApiError(502, "The update manifest version does not match its directory.");
  }
  const file = manifestFile(manifest);
  const artifactName = safeArtifactName(manifest.path) ?? safeArtifactName(file?.url);
  if (!artifactName) {
    throw new UpdateApiError(502, "The update manifest does not contain a safe installer path.");
  }
  const sha512 = typeof manifest.sha512 === "string" ? manifest.sha512 : file?.sha512;
  const size = typeof file?.size === "number" ? file.size : 0;
  if (typeof sha512 !== "string" || sha512.length === 0) {
    throw new UpdateApiError(502, "The update manifest does not contain a checksum.");
  }
  return { manifest, artifactName, sha512, size };
}

function publicUrl(origin: string, key: string): string {
  const path = key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${origin}/${path}`;
}

async function resolveLatestRelease(
  env: UpdateEnvironment,
  request: Request,
): Promise<{ metadata: ReleaseMetadata; manifest: ReleaseManifest }> {
  const { prefix, channel, downloadOrigin } = config(env);
  const rootPrefix = `${prefix}/${channel}/`;
  const candidates = await listCandidates(env.RELEASES_BUCKET, rootPrefix);
  for (const candidate of candidates) {
    const manifestKey = `${candidate.prefix}${MANIFEST_NAME}`;
    const manifestObject = await env.RELEASES_BUCKET.get(manifestKey);
    if (!manifestObject) continue;
    const { manifest, artifactName, sha512, size } = readManifest(
      await manifestObject.text(),
      candidate,
    );
    const artifactKey = `${candidate.prefix}${artifactName}`;
    const artifactObject = await env.RELEASES_BUCKET.head(artifactKey);
    if (!artifactObject) continue;
    const metadataUrl = new URL("/api/updates/win32/x64/latest.yml", request.url).toString();
    const downloadUrl = publicUrl(downloadOrigin, artifactKey);
    const publishedAt =
      typeof manifest.releaseDate === "string"
        ? manifest.releaseDate
        : (manifestObject.uploaded?.toISOString() ?? null);
    return {
      metadata: {
        channel,
        version: candidate.version,
        publishedAt,
        downloadUrl,
        metadataUrl,
        size: size || artifactObject.size,
        sha512,
      },
      manifest,
    };
  }
  throw new UpdateApiError(404, "No valid Windows release is available.");
}

function rewriteManifest(manifest: ReleaseManifest, downloadUrl: string): string {
  const rewritten: ReleaseManifest = {
    ...manifest,
    path: downloadUrl,
  };
  if (Array.isArray(manifest.files)) {
    rewritten.files = manifest.files.map((file) => {
      if (!file || typeof file !== "object") return file;
      return { ...(file as ReleaseManifestFile), url: downloadUrl };
    });
  }
  return YAML.stringify(rewritten);
}

export async function handleUpdateRequest(
  request: Request,
  env: UpdateEnvironment,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method !== "GET" && request.method !== "HEAD") {
    if (url.pathname.startsWith("/api/releases/") || url.pathname.startsWith("/api/updates/")) {
      return jsonResponse({ error: "Method not allowed." }, 405);
    }
    return null;
  }

  try {
    if (url.pathname === "/api/releases/latest") {
      if (url.searchParams.get("platform") !== PLATFORM || url.searchParams.get("arch") !== ARCH) {
        throw new UpdateApiError(400, "Only win32/x64 releases are supported.");
      }
      const { metadata } = await resolveLatestRelease(env, request);
      return jsonResponse(metadata);
    }

    if (url.pathname === "/api/updates/win32/x64/latest.yml") {
      const { metadata, manifest } = await resolveLatestRelease(env, request);
      return new Response(rewriteManifest(manifest, metadata.downloadUrl), {
        headers: {
          "content-type": "text/yaml; charset=utf-8",
          "cache-control": "public, max-age=60, s-maxage=300",
        },
      });
    }
  } catch (error) {
    return errorResponse(error);
  }
  return null;
}

export { compareVersions, parseVersion, readManifest, safeArtifactName };
