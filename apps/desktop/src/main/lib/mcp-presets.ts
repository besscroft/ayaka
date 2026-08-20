import { createHash } from "node:crypto";
import type {
  CatalogFacet,
  CatalogFacets,
  CatalogMcpConfig,
  CatalogMcpDetail,
  CatalogSearchInput,
  CatalogSort,
  JsonObject,
  McpPresetDefinition,
} from "../../shared/types";
import type { CatalogAdapterItem } from "./catalog-adapters";

export const MCP_PRESET_SOURCE_ID = "catalog-builtin-mcp";
export const MCP_PRESET_SOURCE_URL = "builtin://mcp-presets";
export const MCP_PRESET_SOURCE_NAME = "Ayaka built-in MCP presets";

/**
 * Add reviewed MCP definitions here. Keep this list empty until a preset has
 * been deliberately selected, configured, and tested for the shipped client.
 */
export const MCP_PRESETS: McpPresetDefinition[] = [];

export interface McpPresetSearchResult {
  items: CatalogAdapterItem[];
  hasMore: boolean;
  facets: CatalogFacets;
}

for (const preset of MCP_PRESETS) validateMcpPresetDefinition(preset);

export function validateMcpPresetDefinition(preset: McpPresetDefinition): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/.test(preset.id)) {
    throw new Error(`Invalid MCP preset id: ${preset.id}`);
  }
  if (!preset.name.trim()) throw new Error(`MCP preset ${preset.id} needs a name.`);
  if (!preset.description.trim()) throw new Error(`MCP preset ${preset.id} needs a description.`);
  if (!preset.version?.trim()) throw new Error(`MCP preset ${preset.id} needs a version.`);
  if (!isTransport(preset.transport)) {
    throw new Error(`MCP preset ${preset.id} has an unsupported transport.`);
  }

  const args = preset.args ?? [];
  if (!Array.isArray(args) || !args.every((value) => typeof value === "string")) {
    throw new Error(`MCP preset ${preset.id} args must contain only strings.`);
  }
  const headers = validateStringRecord(preset.headers, `MCP preset ${preset.id} headers`);
  const env = validateStringRecord(preset.env, `MCP preset ${preset.id} environment`);
  const secretKeys = preset.secretKeys ?? [];
  if (
    secretKeys.some((key) => !/^[A-Za-z_][A-Za-z0-9_.-]{0,119}$/.test(key)) ||
    new Set(secretKeys).size !== secretKeys.length
  ) {
    throw new Error(`MCP preset ${preset.id} has invalid or duplicate secret keys.`);
  }
  for (const [key, value] of [...Object.entries(headers), ...Object.entries(env)]) {
    const secretReference = value.match(/^\$secret:([A-Za-z_][A-Za-z0-9_.-]{0,119})$/)?.[1];
    if (secretReference && !secretKeys.includes(secretReference)) {
      throw new Error(`MCP preset ${preset.id} references undeclared secret ${key}.`);
    }
    if (
      !secretReference &&
      /api[-_ ]?key|authorization|credential|password|secret|token/i.test(key)
    ) {
      throw new Error(`MCP preset ${preset.id} must reference secret ${key} with $secret:NAME.`);
    }
  }

  if (preset.transport === "stdio") {
    if (!preset.command?.trim()) throw new Error(`MCP preset ${preset.id} needs a command.`);
    if (preset.url) throw new Error(`stdio MCP preset ${preset.id} cannot define a URL.`);
  } else {
    if (preset.command?.trim())
      throw new Error(`Remote MCP preset ${preset.id} cannot define a command.`);
    if (!preset.url || !isAllowedMcpUrl(preset.url)) {
      throw new Error(`MCP preset ${preset.id} needs an HTTPS or loopback HTTP URL.`);
    }
  }
}

export function listMcpPresetItems(): CatalogAdapterItem[] {
  return MCP_PRESETS.map(toMcpPresetCatalogItem);
}

export function searchMcpPresets(input: CatalogSearchInput = {}): McpPresetSearchResult {
  return searchMcpPresetDefinitions(MCP_PRESETS, input);
}

export function searchMcpPresetDefinitions(
  definitions: readonly McpPresetDefinition[],
  input: CatalogSearchInput = {},
): McpPresetSearchResult {
  definitions.forEach(validateMcpPresetDefinition);
  const page = clampInteger(input.page, 1, 1, 1_000);
  const pageSize = clampInteger(input.pageSize, 24, 1, 100);
  const query = input.query?.trim().toLocaleLowerCase() ?? "";
  const allItems = definitions.map(toMcpPresetCatalogItem);
  const filtered = allItems
    .filter((item) => {
      const detail = item.detail.mcp as CatalogMcpDetail;
      const matchesQuery =
        !query ||
        `${item.name} ${item.description} ${item.externalId} ${detail.category ?? ""} ${detail.tags.join(" ")}`
          .toLocaleLowerCase()
          .includes(query);
      const matchesCategory = !input.category || detail.category === input.category;
      const matchesTag = !input.tag || Boolean(detail[input.tag]);
      return matchesQuery && matchesCategory && matchesTag;
    })
    .sort((left, right) => sortPresetItems(left, right, input.sort));
  const offset = (page - 1) * pageSize;
  return {
    items: filtered.slice(offset, offset + pageSize),
    hasMore: offset + pageSize < filtered.length,
    facets: buildMcpPresetFacets(allItems),
  };
}

export function toMcpPresetCatalogItem(preset: McpPresetDefinition): CatalogAdapterItem {
  const detail = toCatalogDetail(preset);
  const itemDetail: JsonObject = {
    provider: "ayaka",
    kind: "builtin-mcp",
    category: detail.category,
    featured: detail.featured,
    verified: detail.verified,
    tags: detail.tags,
    ...(detail.repositoryUrl ? { repositoryUrl: detail.repositoryUrl } : {}),
    ...(detail.docsUrl ? { docsUrl: detail.docsUrl } : {}),
    mcp: detail,
  };
  return {
    externalId: preset.id,
    artifactType: "mcp",
    name: preset.name.trim(),
    description: preset.description.trim(),
    version: preset.version,
    installUrl: null,
    contentHash: hashJson({
      name: preset.name.trim(),
      description: preset.description.trim(),
      version: preset.version,
      detail: itemDetail,
    }),
    detail: itemDetail,
  };
}

function toCatalogDetail(preset: McpPresetDefinition): CatalogMcpDetail {
  const headers = { ...preset.headers };
  const env = { ...preset.env };
  const config: CatalogMcpConfig = {
    transport: preset.transport,
    command: preset.command?.trim() || null,
    args: [...(preset.args ?? [])],
    url: preset.url?.trim() || null,
    headers,
    env,
    secretKeys: [...(preset.secretKeys ?? [])],
  };
  return {
    author: preset.author?.trim() || "Ayaka",
    repositoryUrl: preset.repositoryUrl ?? null,
    homepageUrl: preset.homepageUrl ?? null,
    docsUrl: preset.docsUrl ?? null,
    tags: [...(preset.tags ?? [])],
    category: preset.category?.trim() || null,
    featured: preset.featured ?? false,
    verified: preset.verified ?? true,
    config,
    tools: [...(preset.tools ?? [])],
    parseStatus: "ready",
    warnings: [...(preset.warnings ?? [])],
  };
}

function buildMcpPresetFacets(items: CatalogAdapterItem[]): CatalogFacets {
  const categoryCounts = new Map<string, number>();
  let featured = 0;
  let verified = 0;
  for (const item of items) {
    const detail = item.detail.mcp as CatalogMcpDetail;
    if (detail.category)
      categoryCounts.set(detail.category, (categoryCounts.get(detail.category) ?? 0) + 1);
    if (detail.featured) featured += 1;
    if (detail.verified) verified += 1;
  }
  const categories: CatalogFacet[] = [...categoryCounts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, count]) => ({ id, label: id, count }));
  return {
    categories,
    tags: [
      { id: "featured", count: featured },
      { id: "verified", count: verified },
    ],
  };
}

function sortPresetItems(
  left: CatalogAdapterItem,
  right: CatalogAdapterItem,
  sort: CatalogSort | undefined,
): number {
  const leftDetail = left.detail.mcp as CatalogMcpDetail;
  const rightDetail = right.detail.mcp as CatalogMcpDetail;
  if (sort === "featured") {
    const featuredDelta = Number(rightDetail.featured) - Number(leftDetail.featured);
    if (featuredDelta !== 0) return featuredDelta;
  }
  if (sort === "latest") {
    const versionDelta = (right.version ?? "").localeCompare(left.version ?? "", undefined, {
      numeric: true,
    });
    if (versionDelta !== 0) return versionDelta;
  }
  return left.name.localeCompare(right.name);
}

function validateStringRecord(
  value: Record<string, string> | undefined,
  label: string,
): Record<string, string> {
  const record = value ?? {};
  if (Object.keys(record).some((key) => !key.trim() || typeof record[key] !== "string")) {
    throw new Error(`${label} must contain non-empty keys and string values.`);
  }
  return record;
}

function isTransport(value: string): value is "stdio" | "http" | "sse" {
  return value === "stdio" || value === "http" || value === "sse";
}

function isAllowedMcpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return true;
    if (url.protocol !== "http:") return false;
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function clampInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === "number" && Number.isInteger(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}
