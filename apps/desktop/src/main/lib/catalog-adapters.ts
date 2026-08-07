import { createHash } from "node:crypto";
import type { CatalogArtifactType, CatalogSearchInput, JsonObject } from "../../shared/types";

export interface CatalogAdapterItem {
  externalId: string;
  artifactType: CatalogArtifactType;
  name: string;
  description: string;
  version?: string;
  installUrl: string;
  contentHash?: string;
  detail: JsonObject;
}

export interface SkillsShSearchResult {
  items: CatalogAdapterItem[];
  hasMore: boolean;
  source: "skills-sh";
}

export interface SkillPackageFile {
  path: string;
  contents: string;
}

export interface SkillPackage {
  files: SkillPackageFile[];
  hash: string;
}

export interface ModelScopeSkillsResult {
  items: CatalogAdapterItem[];
  total: number;
  page: number;
  pageSize: number;
}

const MODELSCOPE_ORIGIN = "https://www.modelscope.cn";
const MODELSCOPE_SKILLS_API = `${MODELSCOPE_ORIGIN}/api/v1/dolphin/skills`;
const SKILLS_SH_ORIGIN = "https://skills.sh";
const SKILLS_SH_HOME_URL = `${SKILLS_SH_ORIGIN}/`;
const SKILLS_SH_SEARCH_API = `${SKILLS_SH_ORIGIN}/api/search`;
const SKILLS_SH_PAGE_ORIGINS = new Set(["https://skills.sh", "https://www.skills.sh"]);

export const SKILLS_SH_SOURCE_ID = "catalog-skills-sh";
export const MODELSCOPE_SOURCE_ID = "catalog-modelscope-skills";

export async function searchModelScopeSkills(
  input: CatalogSearchInput = {},
): Promise<ModelScopeSkillsResult> {
  const page = clampInteger(input.page, 1, 1, 1_000);
  const pageSize = clampInteger(input.pageSize, 48, 1, 100);
  const response = await fetch(MODELSCOPE_SKILLS_API, {
    method: "PUT",
    headers: {
      Accept: "application/json, text/plain;q=0.9",
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) VoidAI/1.0",
      Origin: MODELSCOPE_ORIGIN,
      Referer: `${MODELSCOPE_ORIGIN}/skills`,
    },
    body: JSON.stringify({
      PageSize: pageSize,
      PageNumber: page,
      Query: input.query?.trim() ?? "",
      Sort: "Default",
      Criterion: [],
      WithTopCollection: false,
    }),
    redirect: "follow",
  });
  const resolved = new URL(response.url || MODELSCOPE_SKILLS_API);
  if (
    resolved.protocol !== "https:" ||
    !["modelscope.cn", "www.modelscope.cn"].includes(resolved.hostname)
  ) {
    throw new Error(`ModelScope Skills redirected to an untrusted origin: ${resolved.origin}`);
  }
  if (!response.ok) throw new Error(`ModelScope Skills returned HTTP ${response.status}.`);
  const text = await response.text();
  if (text.includes("aliyun_waf_aa") || !text.trimStart().startsWith("{")) {
    throw new Error("ModelScope Skills returned browser verification instead of catalog data.");
  }
  return parseModelScopeSkillsData(JSON.parse(text), page, pageSize);
}

export async function searchSkillsShSkills(
  input: CatalogSearchInput = {},
): Promise<SkillsShSearchResult> {
  const query = input.query?.trim() ?? "";
  const page = clampInteger(input.page, 1, 1, 1_000);
  const pageSize = clampInteger(input.pageSize, 40, 1, 100);

  if (query.length === 0) {
    const response = await fetch(SKILLS_SH_HOME_URL, {
      headers: { Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
    });
    const resolved = new URL(response.url || SKILLS_SH_HOME_URL);
    if (resolved.protocol !== "https:" || !SKILLS_SH_PAGE_ORIGINS.has(resolved.origin)) {
      throw new Error(`skills.sh catalogue redirected to an untrusted origin: ${resolved.origin}`);
    }
    if (!response.ok) throw new Error(`skills.sh catalogue returned HTTP ${response.status}.`);
    const items = parseSkillsShLeaderboardHtml(await response.text());
    const offset = (page - 1) * pageSize;
    return {
      items: items.slice(offset, offset + pageSize),
      hasMore: page * pageSize < items.length,
      source: "skills-sh",
    };
  }
  if (query.length < 2) return { items: [], hasMore: false, source: "skills-sh" };

  const limit = Math.min(200, page * pageSize);
  const url = new URL(SKILLS_SH_SEARCH_API);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(limit));
  const response = await fetch(url, { redirect: "follow" });
  const resolved = new URL(response.url || url.href);
  if (resolved.protocol !== "https:" || resolved.origin !== SKILLS_SH_ORIGIN) {
    throw new Error(`skills.sh search redirected to an untrusted origin: ${resolved.origin}`);
  }
  if (!response.ok) throw new Error(`skills.sh search returned HTTP ${response.status}.`);
  const payload = (await response.json()) as unknown;
  const root = asRecord(payload);
  const rawItems = Array.isArray(payload) ? payload : firstArray(root.skills, root.items);
  const items = parseSkillsShItems(rawItems);
  return {
    items: items.slice((page - 1) * pageSize, page * pageSize),
    hasMore: items.length >= limit && limit < 200,
    source: "skills-sh",
  };
}

export function parseSkillsShLeaderboardHtml(html: string): CatalogAdapterItem[] {
  const arrays: unknown[][] = [];
  const nextData = extractNextData(html);
  if (nextData) arrays.push(nextData);

  for (const script of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)) {
    const content = script[1] ?? "";
    let searchFrom = 0;
    while (true) {
      const pushStart = content.indexOf("self.__next_f.push(", searchFrom);
      if (pushStart < 0) break;
      const arrayStart = content.indexOf("[", pushStart);
      if (arrayStart < 0) break;
      const encodedCall = extractBalancedJson(content, arrayStart);
      searchFrom = encodedCall ? encodedCall.end : arrayStart + 1;
      if (!encodedCall) continue;

      try {
        const call = JSON.parse(encodedCall.value) as unknown;
        const flightChunk = Array.isArray(call) && typeof call[1] === "string" ? call[1] : "";
        const initialSkills = extractJsonArrayAfterMarker(flightChunk, '"initialSkills"');
        if (initialSkills) arrays.push(initialSkills);
      } catch {
        // A malformed RSC chunk should not prevent the remaining page from loading.
      }
    }
  }

  const parsed = parseSkillsShItems(arrays.flatMap((items) => items));
  return parsed.length > 0 ? parsed : parseEmbeddedSkills(html);
}

export async function downloadSkillsShPackage(externalId: string): Promise<SkillPackage> {
  const parts = externalId.split("/");
  if (parts.length < 3) throw new Error("Invalid skills.sh skill identifier.");
  const [owner, repo, ...skillParts] = parts;
  const skill = skillParts.join("/");
  if (
    !owner ||
    !repo ||
    !skill ||
    !/^[A-Za-z0-9_.-]+$/.test(owner) ||
    !/^[A-Za-z0-9_.:-]+$/.test(repo)
  ) {
    throw new Error("Invalid skills.sh skill identifier.");
  }
  const url = new URL(
    `/api/download/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${skill
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`,
    SKILLS_SH_ORIGIN,
  );
  const response = await fetch(url, { redirect: "follow" });
  const resolved = new URL(response.url || url.href);
  if (resolved.protocol !== "https:" || resolved.origin !== SKILLS_SH_ORIGIN) {
    throw new Error(`skills.sh download redirected to an untrusted origin: ${resolved.origin}`);
  }
  if (!response.ok) throw new Error(`skills.sh download returned HTTP ${response.status}.`);
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > 20 * 1024 * 1024) throw new Error("Skill package exceeds 20 MB.");
  const payload = asRecord(await response.json());
  const files = firstArray(payload.files)
    .map((value) => {
      const item = asRecord(value);
      const path = stringValue(item.path);
      const contents = typeof item.contents === "string" ? item.contents : "";
      return path && contents ? { path, contents } : null;
    })
    .filter((value): value is SkillPackageFile => value !== null);
  if (files.length === 0) throw new Error("skills.sh returned an empty package.");
  const hash = stringValue(payload.hash);
  return { files, hash: hash || createHash("sha256").update(JSON.stringify(files)).digest("hex") };
}

export function parseModelScopeSkillsData(
  value: unknown,
  page = 1,
  pageSize = 48,
): ModelScopeSkillsResult {
  const root = asRecord(value);
  const code = numberValue(root.Code ?? root.code);
  if (code !== undefined && code !== 200) {
    throw new Error(
      stringValue(root.Message ?? root.message) || `ModelScope Skills returned ${code}.`,
    );
  }
  const data = asRecord(root.Data ?? root.data);
  const rawItems = firstArray(data.SkillList, data.skillList, data.Skills, data.skills);
  const items = rawItems
    .map((value) => asRecord(asRecord(value).Skill ?? value))
    .map(modelScopeSkillItem)
    .filter((item): item is CatalogAdapterItem => item !== null);
  return {
    items,
    total: numberValue(data.TotalCount ?? data.totalCount) ?? items.length,
    page,
    pageSize,
  };
}

function modelScopeSkillItem(item: Record<string, unknown>): CatalogAdapterItem | null {
  const path = stringValue(item.Path ?? item.path).replace(/^\/+|\/+$/g, "");
  const repositoryName = stringValue(item.Name ?? item.name);
  if (!path || !repositoryName || path.includes("..") || repositoryName.includes("/")) return null;
  const externalId = `${path}/${repositoryName}`;
  const modified = numberValue(item.GmtModify ?? item.gmtModify ?? item.RepoModify);
  const version = modified === undefined ? undefined : String(modified);
  const category = asRecord(item.L1 ?? item.l1);
  const displayName = stringValue(item.DisplayName ?? item.displayName) || repositoryName;
  const encodedId = externalId
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return {
    externalId,
    artifactType: "skill",
    name: displayName,
    description: stringValue(item.Description ?? item.description),
    version,
    installUrl: `${MODELSCOPE_ORIGIN}/skills/${encodedId}/archive/zip/master`,
    contentHash: createHash("sha256")
      .update(`${externalId}:${version ?? "unknown"}`)
      .digest("hex"),
    detail: {
      provider: "modelscope",
      skillId: externalId,
      repositoryName,
      owner: stringValue(item.Owner ?? item.owner),
      developer: stringValue(item.SourceDeveloper ?? item.sourceDeveloper),
      category: stringValue(category.ChineseName ?? category.Name ?? category.name),
      license: stringValue(item.License ?? item.license),
      sourceUrl: stringValue(item.SourceURL ?? item.SourceUrl ?? item.sourceUrl),
      avatarUrl: stringValue(item.SourceAvatar ?? item.sourceAvatar),
      visits: numberValue(item.Visits ?? item.visits) ?? 0,
      downloads: numberValue(item.DownloadCount ?? item.downloadCount) ?? 0,
      tags: Array.isArray(item.Tags) ? item.Tags.map(String) : [],
      catalogUrl: `${MODELSCOPE_ORIGIN}/skills/${encodedId}`,
      modifiedAt: modified ?? 0,
      canonicalKey: canonicalGithubKey(
        stringValue(item.SourceURL ?? item.SourceUrl ?? item.sourceUrl),
        repositoryName,
      ),
    },
  };
}

function skillsShItem(item: Record<string, unknown>): CatalogAdapterItem | null {
  const source = stringValue(item.source);
  const skillId = stringValue(item.skillId ?? item.skill_id);
  const suppliedId = stringValue(item.id);
  const prefix = source ? `${source}/` : "";
  if (suppliedId && (!prefix || !suppliedId.startsWith(prefix))) return null;
  const slug = suppliedId ? suppliedId.slice(prefix.length) : skillId;
  const id = source && slug ? `${source}/${slug}` : "";
  const name = stringValue(item.name) || skillId || slug;
  if (!id || !name || !source || !slug) return null;
  const encoded = id.split("/").map(encodeURIComponent).join("/");
  return {
    externalId: id,
    artifactType: "skill",
    name,
    description: stringValue(item.description),
    version: undefined,
    installUrl: `${SKILLS_SH_ORIGIN}/api/download/${encoded}`,
    detail: {
      provider: "skills.sh",
      source,
      slug,
      skillUrl: `${SKILLS_SH_ORIGIN}/${encoded}`,
      sourceUrl: `https://github.com/${source}`,
      installs: numberValue(item.installs) ?? 0,
      canonicalKey: `github:${source.toLowerCase()}#${slug.toLowerCase()}`,
    },
  };
}

function parseSkillsShItems(values: unknown[]): CatalogAdapterItem[] {
  const seen = new Set<string>();
  const items: CatalogAdapterItem[] = [];
  for (const value of values) {
    const item = skillsShItem(asRecord(value));
    if (!item || seen.has(item.externalId)) continue;
    seen.add(item.externalId);
    items.push(item);
  }
  return items;
}

function extractNextData(html: string): unknown[] | null {
  const match = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match?.[1]) return null;
  try {
    const root = asRecord(JSON.parse(match[1]));
    const pageProps = asRecord(asRecord(root.props).pageProps);
    return firstArray(pageProps.initialSkills, pageProps.skills, pageProps.items);
  } catch {
    return null;
  }
}

function extractJsonArrayAfterMarker(text: string, marker: string): unknown[] | null {
  const markerStart = text.indexOf(marker);
  if (markerStart < 0) return null;
  const arrayStart = text.indexOf("[", markerStart + marker.length);
  if (arrayStart < 0) return null;
  const extracted = extractBalancedJson(text, arrayStart);
  if (!extracted) return null;
  try {
    const value = JSON.parse(extracted.value) as unknown;
    return Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function extractBalancedJson(text: string, start: number): { value: string; end: number } | null {
  const opening = text[start];
  if (opening !== "[") return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index++) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "[") depth++;
    else if (character === "]") {
      depth--;
      if (depth === 0) return { value: text.slice(start, index + 1), end: index + 1 };
    }
  }
  return null;
}

function parseEmbeddedSkills(html: string): CatalogAdapterItem[] {
  const items: CatalogAdapterItem[] = [];
  const patterns = [
    /"source"\s*:\s*"([^"]+)"[\s\S]{0,400}?"(?:skillId|skill_id)"\s*:\s*"([^"]+)"[\s\S]{0,300}?"name"\s*:\s*"([^"]*)"[\s\S]{0,200}?"installs"\s*:\s*(\d+)/g,
    /\\"source\\"\s*:\s*\\"([^"\\]+)\\"[\s\S]{0,400}?\\"(?:skillId|skill_id)\\"\s*:\s*\\"([^"\\]+)\\"[\s\S]{0,300}?\\"name\\"\s*:\s*\\"([^"\\]*)\\"[\s\S]{0,200}?\\"installs\\"\s*:\s*(\d+)/g,
  ];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const item = skillsShItem({
        source: match[1],
        skillId: match[2],
        name: match[3],
        installs: Number(match[4]),
      });
      if (item) items.push(item);
    }
    if (items.length > 0) break;
  }
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.externalId)) return false;
    seen.add(item.externalId);
    return true;
  });
}

function canonicalGithubKey(sourceUrl: string, skill: string): string | null {
  try {
    const url = new URL(sourceUrl);
    if (url.hostname !== "github.com") return null;
    const [owner, repo] = url.pathname.split("/").filter(Boolean);
    return owner && repo
      ? `github:${owner.toLowerCase()}/${repo.toLowerCase()}#${skill.toLowerCase()}`
      : null;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function firstArray(...values: unknown[]): unknown[] {
  return values.find(Array.isArray) ?? [];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function clampInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === "number" && Number.isInteger(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}
