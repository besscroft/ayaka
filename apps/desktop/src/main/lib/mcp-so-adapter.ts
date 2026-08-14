import { createHash } from "node:crypto";
import { load, type CheerioAPI } from "cheerio";
import type {
  CatalogFacet,
  CatalogMcpConfig,
  CatalogMcpDetail,
  CatalogMcpToolSummary,
  CatalogSearchInput,
  CatalogTagFilter,
  JsonObject,
} from "../../shared/types";
import type { CatalogAdapterItem } from "./catalog-adapters";

export const MCP_SO_SOURCE_ID = "catalog-mcp-so";
export const MCP_SO_ORIGIN = "https://mcp.so";
const MCP_SO_ORIGINS = new Set(["https://mcp.so", "https://www.mcp.so"]);

export interface McpSoSearchResult {
  items: CatalogAdapterItem[];
  hasMore: boolean;
  facets: { categories: CatalogFacet[]; tags: Array<{ id: CatalogTagFilter; count: number }> };
}

export interface McpSoDetailResult {
  item: CatalogAdapterItem;
  detail: CatalogMcpDetail;
}

export async function searchMcpSoServers(
  input: CatalogSearchInput = {},
): Promise<McpSoSearchResult> {
  const page = clampInteger(input.page, 1, 1, 1_000);
  const pageSize = clampInteger(input.pageSize, 24, 1, 60);
  const query = input.query?.trim() ?? "";
  const urls = query
    ? [buildUrl("/zh/search", { q: query, page })]
    : [
        buildUrl("/zh/servers", {
          page,
          sort: input.sort === "name" ? "name" : "star",
          ...tagQuery(input.tag),
          category: input.category,
        }),
        buildUrl("/zh/remote-servers", {
          page,
          sort: input.sort === "name" ? "name" : "star",
          ...tagQuery(input.tag),
          category: input.category,
        }),
      ];
  const pages = await Promise.all(urls.map(fetchMcpSoPage));
  const merged = mergeAdapterItems(pages.flatMap((pageResult) => pageResult.items));
  const queryFiltered = filterMcpSoItems(merged, query);
  const filtered = input.category
    ? queryFiltered.filter((item) => item.detail.category === input.category)
    : queryFiltered;
  const sorted = sortItems(filtered, input.sort);
  return {
    items: sorted.slice(0, pageSize),
    hasMore: !query && pages.some((pageResult) => pageResult.hasMore),
    facets: mergeFacets(pages.map((pageResult) => pageResult.facets)),
  };
}

export function filterMcpSoItems(items: CatalogAdapterItem[], query: string): CatalogAdapterItem[] {
  const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return items;
  return items.filter((item) => {
    const name = item.name.toLocaleLowerCase();
    return terms.every((term) => name.includes(term));
  });
}

export async function getMcpSoServerDetail(externalId: string): Promise<McpSoDetailResult> {
  const url = buildMcpSoDetailUrl(externalId);
  const html = await fetchMcpSoHtml(url);
  return parseMcpSoDetailHtml(html, externalId, url);
}

export function buildMcpSoDetailUrl(externalId: string): string {
  const { slug } = parseExternalId(externalId);
  return buildUrl(`/zh/servers/${slug}`);
}

export function parseMcpSoListHtml(
  html: string,
  kind: "server" | "remote" = "server",
  requestedTag?: CatalogTagFilter,
): McpSoSearchResult {
  const $ = load(html);
  const items: CatalogAdapterItem[] = [];
  const seen = new Set<string>();
  $("a[href]").each((_index, element) => {
    const card = $(element);
    const heading = card.find("h3").first().text().trim();
    const href = card.attr("href") ?? "";
    if (
      !heading ||
      !href ||
      !(/\/servers\//.test(href) || /\/remote-servers\//.test(href)) ||
      card.find("h3").length !== 1
    )
      return;
    const slug = href.split("/").filter(Boolean).pop() ?? "";
    if (!slug) return;
    const itemKind = /\/remote-servers\//.test(href) ? "remote" : kind;
    const externalId = `${itemKind}:${slug}`;
    if (seen.has(externalId)) return;
    seen.add(externalId);
    const paragraphs = card
      .find("p")
      .toArray()
      .map((node) => $(node).text().trim())
      .filter(Boolean);
    const author = paragraphs[0] ?? "";
    const description = paragraphs.slice(1).join(" ").slice(0, 2_000);
    const category = extractCategory($, card);
    const markup = $.html(element);
    const featured = requestedTag === "featured" || /lucide-star|featured|精选/i.test(markup);
    const verified = requestedTag === "verified" || /badge-check|verified|验证/i.test(markup);
    const catalogUrl = absoluteUrl(href);
    const detail: JsonObject = {
      provider: "mcp.so",
      kind: itemKind,
      slug,
      author,
      category,
      featured,
      verified,
      catalogUrl,
      tags: extractTags($, card),
      sourceUrl: catalogUrl,
    };
    items.push({
      externalId,
      artifactType: "mcp",
      name: heading,
      description,
      version: undefined,
      installUrl: catalogUrl,
      contentHash: hashJson(detail),
      detail,
    });
  });
  const categories = extractCategoryFacets($);
  return {
    items,
    hasMore: hasNextPage($),
    facets: {
      categories,
      tags: [
        { id: "featured", count: countFacet($, "featured") },
        { id: "verified", count: countFacet($, "verified") },
      ],
    },
  };
}

export function parseMcpSoDetailHtml(
  html: string,
  externalId: string,
  catalogUrl: string,
): McpSoDetailResult {
  const $ = load(html);
  const parsedId = parseExternalId(externalId);
  const title = $("main h1").first().text().trim() || parsedId.slug;
  const paragraphs = $("main p")
    .toArray()
    .map((node) => $(node).text().trim())
    .filter(Boolean);
  const author = paragraphs.find((value) => value.startsWith("@"))?.replace(/^@/, "") ?? "";
  const links = collectExternalLinks($);
  const codeBlocks = $("main code")
    .toArray()
    .map((node) => $(node).text().trim())
    .filter(Boolean);
  const configResult = parseMcpConfig(codeBlocks, parsedId.kind === "remote");
  const tags = $("main a[href*='/tags/']")
    .toArray()
    .map((node) => $(node).text().trim().replace(/^#/, ""))
    .filter(Boolean);
  const category = extractCategoryFromDetail($);
  const tools = extractTools($);
  const featured =
    /精选|lucide-star|featured/i.test($("main").text()) || /精选|featured/i.test($.html("main"));
  const verified =
    /验证|badge-check|verified/i.test($("main").text()) ||
    /badge-check|verified/i.test($.html("main"));
  const detail: CatalogMcpDetail = {
    author,
    repositoryUrl: links.repositoryUrl,
    homepageUrl: links.homepageUrl,
    docsUrl: links.docsUrl,
    tags,
    category,
    featured,
    verified,
    config: configResult.config,
    tools,
    parseStatus: configResult.parseStatus,
    warnings: configResult.warnings,
  };
  const itemDetail: JsonObject = {
    provider: "mcp.so",
    kind: parsedId.kind,
    slug: parsedId.slug,
    author,
    category,
    featured,
    verified,
    catalogUrl,
    repositoryUrl: links.repositoryUrl,
    homepageUrl: links.homepageUrl,
    docsUrl: links.docsUrl,
    tags,
    mcp: detail,
  };
  const item: CatalogAdapterItem = {
    externalId,
    artifactType: "mcp",
    name: title,
    description: paragraphs.find((value) => !value.startsWith("@")) ?? "",
    version: undefined,
    installUrl: catalogUrl,
    contentHash: hashJson(itemDetail),
    detail: itemDetail,
  };
  return { item, detail };
}

async function fetchMcpSoPage(url: string): Promise<McpSoSearchResult> {
  const html = await fetchMcpSoHtml(url);
  const kind = new URL(url).pathname.startsWith("/zh/remote-servers") ? "remote" : "server";
  const tag = new URL(url).searchParams.get("tag");
  return parseMcpSoListHtml(html, kind, tag === "featured" || tag === "verified" ? tag : undefined);
}

async function fetchMcpSoHtml(urlValue: string): Promise<string> {
  const url = new URL(urlValue);
  assertMcpSoOrigin(url);
  const response = await fetch(url, {
    headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "Ayaka/1.0" },
    redirect: "follow",
  });
  const resolved = new URL(response.url || url.href);
  assertMcpSoOrigin(resolved);
  if (!response.ok) throw new Error(`mcp.so returned HTTP ${response.status}.`);
  const html = await response.text();
  if (html.length > 8 * 1024 * 1024) throw new Error("mcp.so page exceeds 8 MB.");
  return html;
}

function parseMcpConfig(
  codeBlocks: string[],
  remote: boolean,
): {
  config: CatalogMcpConfig;
  parseStatus: CatalogMcpDetail["parseStatus"];
  warnings: string[];
} {
  const warnings: string[] = [];
  const empty: CatalogMcpConfig = {
    transport: remote ? "http" : "stdio",
    command: null,
    args: [],
    url: null,
    headers: {},
    env: {},
    secretKeys: [],
  };
  for (const code of codeBlocks) {
    const trimmed = code.trim();
    if (trimmed.startsWith("{") && trimmed.includes("mcpServers")) {
      try {
        const root = JSON.parse(trimmed) as unknown;
        const servers = asRecord(asRecord(root).mcpServers);
        const first = Object.values(servers)[0];
        const record = asRecord(first);
        const parsed = normalizeConfig(record);
        if (parsed)
          return { config: parsed.config, parseStatus: parsed.status, warnings: parsed.warnings };
      } catch {
        warnings.push("The standard MCP JSON configuration is invalid.");
      }
    }
    const remoteMatch =
      trimmed.match(/--transport\s+(http|sse)\s+(https:\/\/\S+)/i) ??
      trimmed.match(/(https:\/\/[^\s"'<>]+)/i);
    if (remoteMatch?.[2] || remoteMatch?.[1]?.startsWith("https://")) {
      const url = remoteMatch[2] ?? remoteMatch[1];
      if (url) {
        const transport =
          /--transport\s+sse/i.test(trimmed) || /\/sse(?:\/|$)/i.test(url) ? "sse" : "http";
        return {
          config: { ...empty, transport, url: cleanUrl(url) },
          parseStatus: "ready",
          warnings,
        };
      }
    }
  }
  warnings.push(
    remote
      ? "No standard remote MCP connection URL was found."
      : "No standard MCP JSON configuration was found.",
  );
  return { config: empty, parseStatus: "unsupported", warnings };
}

function normalizeConfig(record: Record<string, unknown>): {
  config: CatalogMcpConfig;
  status: CatalogMcpDetail["parseStatus"];
  warnings: string[];
} | null {
  const warnings: string[] = [];
  const transportValue = typeof record.transport === "string" ? record.transport.toLowerCase() : "";
  const rawUrl = typeof record.url === "string" ? record.url : null;
  if (transportValue && !["stdio", "http", "sse", "streamable-http"].includes(transportValue)) {
    warnings.push("Unknown MCP transport was normalized for review.");
  }
  const transport = rawUrl
    ? transportValue === "sse" || /\/sse(?:\/|$)/i.test(rawUrl)
      ? "sse"
      : "http"
    : "stdio";
  const command = typeof record.command === "string" ? record.command.trim() : null;
  const args = Array.isArray(record.args) ? record.args.map(String) : [];
  if (transport === "stdio" && !command) return null;
  if (transport !== "stdio" && !rawUrl) return null;
  const envResult = sanitizeRecord(record.env);
  const headersResult = sanitizeRecord(record.headers);
  warnings.push(...envResult.warnings, ...headersResult.warnings);
  if (rawUrl) {
    try {
      const url = new URL(rawUrl);
      if (url.protocol !== "https:") warnings.push("Remote MCP URL is not HTTPS.");
    } catch {
      warnings.push("Remote MCP URL is invalid.");
    }
  }
  return {
    config: {
      transport,
      command,
      args,
      url: rawUrl ? cleanUrl(rawUrl) : null,
      headers: headersResult.values,
      env: envResult.values,
      secretKeys: [...new Set([...envResult.secretKeys, ...headersResult.secretKeys])],
    },
    status: warnings.some((warning) => /invalid|not HTTPS|unknown/i.test(warning))
      ? "partial"
      : "ready",
    warnings,
  };
}

function sanitizeRecord(value: unknown): {
  values: Record<string, string>;
  secretKeys: string[];
  warnings: string[];
} {
  const values: Record<string, string> = {};
  const secretKeys: string[] = [];
  const warnings: string[] = [];
  for (const [key, raw] of Object.entries(asRecord(value))) {
    const normalizedKey = key.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 80);
    if (!normalizedKey) continue;
    const valueText = typeof raw === "string" ? raw : String(raw);
    if (/token|key|secret|password|credential|authorization|auth/i.test(key)) {
      values[normalizedKey] = `$secret:${normalizedKey}`;
      secretKeys.push(normalizedKey);
    } else {
      values[normalizedKey] = valueText.slice(0, 2_000);
    }
  }
  if (Object.keys(values).length > 80) warnings.push("Some configuration fields were omitted.");
  return { values, secretKeys, warnings };
}

function extractTools($: CheerioAPI): CatalogMcpToolSummary[] {
  const tools: CatalogMcpToolSummary[] = [];
  const toolsHeading = $("h2")
    .filter((_index, element) => /工具|tools/i.test($(element).text()))
    .first();
  const container = toolsHeading.length > 0 ? toolsHeading.parent() : $("main");
  container.find("h3").each((_index, element) => {
    const name = $(element).text().trim();
    if (!name || name.length > 120 || /更多 MCP|FAQ|常见问题/i.test(name)) return;
    const description = $(element).nextAll("p").first().text().trim().slice(0, 1_000);
    if (name !== "工具" && !tools.some((tool) => tool.name === name))
      tools.push({ name, description });
  });
  return tools.slice(0, 500);
}

function collectExternalLinks($: CheerioAPI): {
  repositoryUrl: string | null;
  homepageUrl: string | null;
  docsUrl: string | null;
} {
  let repositoryUrl: string | null = null;
  let homepageUrl: string | null = null;
  let docsUrl: string | null = null;
  $("main a[href]").each((_index, element) => {
    const href = $(element).attr("href") ?? "";
    if (!/^https:\/\//i.test(href)) return;
    const label = $(element).text().toLowerCase();
    if (
      (!repositoryUrl && /代码仓库|repository|github/.test(label)) ||
      (!repositoryUrl && /github\.com/.test(href))
    )
      repositoryUrl = href;
    else if (!homepageUrl && /主页|homepage|website/.test(label)) homepageUrl = href;
    else if (!docsUrl && /文档|docs|documentation/.test(label)) docsUrl = href;
  });
  return { repositoryUrl, homepageUrl, docsUrl };
}

function extractCategory($: CheerioAPI, card: ReturnType<CheerioAPI>): string | null {
  const values = card
    .find("span")
    .toArray()
    .map((node) => $(node).text().trim())
    .filter(Boolean);
  return values.find((value) => value.length <= 40 && !/^\d/.test(value)) ?? null;
}

function extractCategoryFromDetail($: CheerioAPI): string | null {
  const categoryLink = $("main a[href*='/categories/'], main a[href*='category=']").first();
  return categoryLink.length > 0 ? categoryLink.text().trim() : null;
}

function extractTags($: CheerioAPI, card: ReturnType<CheerioAPI>): string[] {
  return card
    .find("a[href*='/tags/']")
    .toArray()
    .map((node) => $(node).text().trim().replace(/^#/, ""))
    .filter(Boolean)
    .slice(0, 30);
}

function extractCategoryFacets($: CheerioAPI): CatalogFacet[] {
  const facets: CatalogFacet[] = [];
  $("a[href*='category=']").each((_index, element) => {
    const link = $(element);
    const href = link.attr("href") ?? "";
    const id = new URL(href, MCP_SO_ORIGIN).searchParams.get("category") ?? "";
    const label = link.find("span").first().text().trim() || link.text().trim();
    const countText =
      link.find(".tabular-nums").text().trim() || link.text().match(/\d[\d,.K]*$/)?.[0] || "0";
    if (id && label && !facets.some((facet) => facet.id === id))
      facets.push({ id, label, count: parseMetric(countText) });
  });
  return facets.slice(0, 40);
}

function countFacet($: CheerioAPI, tag: CatalogTagFilter): number {
  const links = $(`a[href*="tag=${tag}"]`);
  return links.length > 0 ? parseMetric(links.first().text()) : 0;
}

function hasNextPage($: CheerioAPI): boolean {
  return $("a[href*='page=']").length > 0;
}

function mergeAdapterItems(items: CatalogAdapterItem[]): CatalogAdapterItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.externalId)) return false;
    seen.add(item.externalId);
    return true;
  });
}

function mergeFacets(
  facets: Array<{
    categories: CatalogFacet[];
    tags: Array<{ id: CatalogTagFilter; count: number }>;
  }>,
): { categories: CatalogFacet[]; tags: Array<{ id: CatalogTagFilter; count: number }> } {
  const categories = new Map<string, CatalogFacet>();
  const tags = new Map<CatalogTagFilter, number>();
  for (const facet of facets) {
    for (const category of facet.categories)
      categories.set(category.id, {
        ...category,
        count: Math.max(categories.get(category.id)?.count ?? 0, category.count),
      });
    for (const tag of facet.tags) tags.set(tag.id, Math.max(tags.get(tag.id) ?? 0, tag.count));
  }
  return {
    categories: [...categories.values()],
    tags: [
      { id: "featured", count: tags.get("featured") ?? 0 },
      { id: "verified", count: tags.get("verified") ?? 0 },
    ],
  };
}

function sortItems(
  items: CatalogAdapterItem[],
  sort: CatalogSearchInput["sort"],
): CatalogAdapterItem[] {
  return [...items].sort((a, b) => {
    const aDetail = a.detail;
    const bDetail = b.detail;
    if (sort !== "name") {
      const featured = Number(Boolean(bDetail.featured)) - Number(Boolean(aDetail.featured));
      if (featured !== 0) return featured;
      const verified = Number(Boolean(bDetail.verified)) - Number(Boolean(aDetail.verified));
      if (verified !== 0) return verified;
    }
    return a.name.localeCompare(b.name);
  });
}

function tagQuery(tag?: CatalogTagFilter): Record<string, string | undefined> {
  return tag ? { tag } : {};
}

function parseExternalId(value: string): { kind: "server" | "remote"; slug: string } {
  const [kind, ...parts] = value.split(":");
  const slug = parts.join(":").trim();
  if ((kind !== "server" && kind !== "remote") || !/^[a-z0-9][a-z0-9-]*$/i.test(slug))
    throw new Error("Invalid mcp.so server identifier.");
  return { kind, slug };
}

function buildUrl(
  pathname: string,
  params: Record<string, string | number | undefined> = {},
): string {
  const url = new URL(pathname, MCP_SO_ORIGIN);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  });
  return url.href;
}

function absoluteUrl(value: string): string {
  const url = new URL(value, MCP_SO_ORIGIN);
  assertMcpSoOrigin(url);
  return url.href;
}

function cleanUrl(value: string): string {
  return value.replace(/[),.;]+$/, "");
}

function assertMcpSoOrigin(url: URL): void {
  if (url.protocol !== "https:" || !MCP_SO_ORIGINS.has(url.origin))
    throw new Error("mcp.so request redirected to an untrusted origin.");
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseMetric(value: string): number {
  const clean = value.replace(/,/g, "").trim().toUpperCase();
  const multiplier = clean.endsWith("K") ? 1_000 : 1;
  const numeric = Number.parseFloat(clean.replace(/K$/, ""));
  return Number.isFinite(numeric) ? Math.round(numeric * multiplier) : 0;
}

function clampInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === "number" && Number.isInteger(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}
