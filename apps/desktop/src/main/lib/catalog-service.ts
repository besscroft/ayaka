import { createHash, randomUUID } from "node:crypto";
import { app } from "electron";
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { eq } from "drizzle-orm";
import type {
  ArtifactInstallation,
  CatalogArtifactType,
  CatalogInstallInput,
  CatalogItem,
  CatalogItemDetail,
  CatalogFacets,
  CatalogMcpDetail,
  CatalogSearchInput,
  CatalogSearchResult,
  CatalogSnapshot,
  CatalogSourceKind,
  CatalogSourceState,
  JsonObject,
} from "../../shared/types";
import {
  createSkillToolAsync as createSkillTool,
  deleteSkillToolAsync as deleteSkillTool,
  getDb,
  setSkillToolEnabledAsync as setSkillToolEnabled,
  setToolServerEnabledAsync as setToolServerEnabled,
  updateSkillToolAsync as updateSkillTool,
  createToolServerAsync as createToolServer,
  setToolSecretAsync as setToolSecret,
  updateToolServerAsync as updateToolServer,
  permanentlyDeleteToolServerAsync as permanentlyDeleteToolServer,
  ensureBuiltinCatalogSources as ensureBuiltinCatalogSourcesDb,
  cacheCatalogItems,
  updateCatalogSource,
  upsertArtifactInstallation,
  updateArtifactInstallation,
  deleteArtifactInstallation,
} from "./db";
import { artifactInstallations, catalogItems, catalogSources } from "./schema";
import {
  downloadSkillsShPackage,
  MODELSCOPE_SOURCE_ID,
  searchModelScopeSkills,
  searchSkillsShSkills,
  SKILLS_SH_SOURCE_ID,
  type CatalogAdapterItem,
} from "./catalog-adapters";
import { discoverMcpServer } from "./mcp-manager";
import { closeMcpClient } from "./mcp-manager";
import {
  getMcpSoServerDetail,
  MCP_SO_ORIGIN,
  MCP_SO_SOURCE_ID,
  searchMcpSoServers,
} from "./mcp-so-adapter";
import {
  inspectSkillArchive,
  inspectSkillFiles,
  type InspectedSkillArchive,
} from "./catalog-safety";

const MODELSCOPE_SKILLS_SOURCE: typeof catalogSources.$inferInsert = {
  id: MODELSCOPE_SOURCE_ID,
  name: "ModelScope Skills",
  kind: "modelscope-skills",
  url: "https://www.modelscope.cn/skills",
  enabled: 1,
  builtin: 1,
  config_json: "{}",
  last_synced_at: null,
  last_error: null,
  created_at: 0,
  updated_at: 0,
};
const SKILLS_SH_SOURCE: typeof catalogSources.$inferInsert = {
  id: SKILLS_SH_SOURCE_ID,
  name: "skills.sh",
  kind: "skills-sh",
  url: "https://skills.sh",
  enabled: 1,
  builtin: 1,
  config_json: "{}",
  last_synced_at: null,
  last_error: null,
  created_at: 0,
  updated_at: 0,
};
const MCP_SO_SOURCE: typeof catalogSources.$inferInsert = {
  id: MCP_SO_SOURCE_ID,
  name: "MCP.so",
  kind: "mcp-so",
  url: `${MCP_SO_ORIGIN}/zh/servers`,
  enabled: 1,
  builtin: 1,
  config_json: "{}",
  last_synced_at: null,
  last_error: null,
  created_at: 0,
  updated_at: 0,
};

export async function ensureBuiltinCatalogSources(now = Date.now()): Promise<void> {
  await ensureBuiltinCatalogSourcesDb(
    [MODELSCOPE_SKILLS_SOURCE, SKILLS_SH_SOURCE, MCP_SO_SOURCE],
    now,
  );
}

export async function getCatalogSnapshot(): Promise<CatalogSnapshot> {
  await ensureBuiltinCatalogSources();
  return { installations: listArtifactInstallations() };
}

export async function searchCatalogSkills(
  input: CatalogSearchInput = {},
): Promise<CatalogSearchResult> {
  if (input.artifactType === "mcp") throw new Error("Use the MCP catalog search for MCP items.");
  await ensureBuiltinCatalogSources();
  const page = normalizeInteger(input.page, 1, 1, 1_000);
  const pageSize = normalizeInteger(input.pageSize, 48, 1, 100);
  const source =
    input.source === "skills-sh" || input.source === "modelscope-skills" ? input.source : "all";
  const query = input.query?.trim() ?? "";
  const requested: CatalogSourceKind[] =
    source === "all"
      ? query.length === 1
        ? ["modelscope-skills"]
        : ["skills-sh", "modelscope-skills"]
      : [source];
  const settled = await Promise.allSettled(
    requested.map(async (kind) => {
      const result =
        kind === "skills-sh"
          ? await searchSkillsShSkills({ ...input, page, pageSize })
          : await searchModelScopeSkills({ ...input, page, pageSize });
      const items = result.items;
      const hasMore =
        kind === "skills-sh"
          ? (result as Awaited<ReturnType<typeof searchSkillsShSkills>>).hasMore
          : page * pageSize < (result as Awaited<ReturnType<typeof searchModelScopeSkills>>).total;
      await cacheSourceItems(sourceIdForKind(kind), items);
      await setSourceSuccess(sourceIdForKind(kind));
      return {
        kind,
        items: catalogItemsInOrder(
          sourceIdForKind(kind),
          items.map((item) => item.externalId),
        ),
        hasMore,
      };
    }),
  );
  const lists: CatalogItem[][] = [];
  const states: CatalogSourceState[] = [];
  for (const [index, result] of settled.entries()) {
    const kind = requested[index]!;
    if (result.status === "fulfilled") {
      lists.push(result.value.items);
      states.push({ source: kind, status: "online", hasMore: result.value.hasMore });
      continue;
    }
    const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
    await setSourceError(sourceIdForKind(kind), message);
    const cached = searchCachedCatalogItems(sourceIdForKind(kind), query, page, pageSize);
    if (cached.length > 0) {
      lists.push(cached);
      states.push({
        source: kind,
        status: "cache",
        hasMore: cached.length === pageSize,
        error: message,
      });
    } else {
      states.push({ source: kind, status: "error", hasMore: false, error: message });
    }
  }
  const items = mergeCatalogItems(lists);
  if (items.length === 0 && states.every((state) => state.status === "error")) {
    throw new Error(
      states
        .map((state) => state.error)
        .filter(Boolean)
        .join(" "),
    );
  }
  return {
    items,
    page,
    pageSize,
    hasMore: states.some((state) => state.hasMore),
    sources: states,
  };
}

export async function searchCatalogMcp(
  input: CatalogSearchInput = {},
): Promise<CatalogSearchResult> {
  await ensureBuiltinCatalogSources();
  const page = normalizeInteger(input.page, 1, 1, 1_000);
  const pageSize = normalizeInteger(input.pageSize, 24, 1, 60);
  const query = input.query?.trim() ?? "";
  try {
    const result = await searchMcpSoServers({ ...input, artifactType: "mcp", page, pageSize });
    await cacheSourceItems(MCP_SO_SOURCE_ID, result.items, "mcp");
    await setSourceSuccess(MCP_SO_SOURCE_ID);
    const onlineItems = catalogItemsInOrder(
      MCP_SO_SOURCE_ID,
      result.items.map((item) => item.externalId),
    );
    const cachedMatches = query
      ? searchCachedCatalogItems(MCP_SO_SOURCE_ID, query, 1, 60, input).filter(
          (item) => !onlineItems.some((onlineItem) => onlineItem.id === item.id),
        )
      : [];
    const items = [...onlineItems, ...cachedMatches].slice(0, pageSize);
    return {
      items,
      page,
      pageSize,
      hasMore: result.hasMore,
      sources: [{ source: "mcp-so", status: "online", hasMore: result.hasMore }],
      facets: result.facets,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await setSourceError(MCP_SO_SOURCE_ID, message);
    const cached = searchCachedCatalogItems(MCP_SO_SOURCE_ID, query, page, pageSize, input);
    if (cached.length === 0) throw error;
    return {
      items: cached,
      page,
      pageSize,
      hasMore: cached.length === pageSize,
      sources: [
        { source: "mcp-so", status: "cache", hasMore: cached.length === pageSize, error: message },
      ],
      facets: cachedMcpFacets(),
    };
  }
}

function searchCachedCatalogItems(
  sourceId: string,
  query: string,
  page: number,
  pageSize: number,
  input: CatalogSearchInput = {},
): CatalogItem[] {
  const normalizedQuery = query.toLowerCase();
  const rows = getDb()
    .select()
    .from(catalogItems)
    .all()
    .filter((row) => row.source_id === sourceId)
    .filter((row) => !input.category || parseJson(row.detail_json).category === input.category)
    .filter((row) => !input.tag || Boolean(parseJson(row.detail_json)[input.tag]))
    .filter(
      (row) =>
        !normalizedQuery ||
        `${row.name} ${row.description} ${row.external_id}`.toLowerCase().includes(normalizedQuery),
    );
  const offset = (page - 1) * pageSize;
  return rows.slice(offset, offset + pageSize).map((row) => toCatalogItem(row));
}

export function listArtifactInstallations(): ArtifactInstallation[] {
  return getDb().select().from(artifactInstallations).all().map(toInstallation);
}

export async function installCatalogItem(
  input: CatalogInstallInput,
): Promise<ArtifactInstallation> {
  const item = getDb().select().from(catalogItems).where(eq(catalogItems.id, input.itemId)).get();
  if (!item) throw new Error("Catalog item does not exist. Sync its source and try again.");
  if (item.artifact_type === "mcp") return await installMcpItem(item, input);
  return await installSkillItem(item, input);
}

export async function getCatalogItemDetail(itemId: string): Promise<CatalogItemDetail> {
  const item = getDb().select().from(catalogItems).where(eq(catalogItems.id, itemId)).get();
  if (!item) throw new Error("Catalog item does not exist.");
  if (item.artifact_type === "mcp") {
    try {
      const result = await getMcpSoServerDetail(item.external_id);
      await cacheSourceItems(MCP_SO_SOURCE_ID, [result.item], "mcp");
      const hash = result.item.contentHash ?? item.content_hash ?? "";
      return {
        itemId,
        artifactType: "mcp",
        markdown: "",
        files: [],
        totalBytes: 0,
        contentHash: hash,
        safetyChecks: ["mcp-so-origin", "configuration-shape", "secret-redaction"],
        mcp: result.detail,
      };
    } catch (error) {
      const cached = catalogMcpDetail(parseJson(item.detail_json));
      if (cached) {
        return {
          itemId,
          artifactType: "mcp",
          markdown: "",
          files: [],
          totalBytes: 0,
          contentHash: item.content_hash ?? "",
          safetyChecks: ["cached-mcp-so-detail", "configuration-shape", "secret-redaction"],
          mcp: cached,
        };
      }
      throw error;
    }
  }
  const inspected = await loadSkillPackage(item);
  const contentHash = skillPackageHash(inspected);
  return {
    itemId,
    artifactType: "skill",
    markdown: inspected.markdown,
    files: Object.entries(inspected.files).map(([path, data]) => ({ path, size: data.byteLength })),
    totalBytes: inspected.totalBytes,
    contentHash,
    safetyChecks: ["frontmatter", "path-traversal", "file-count", "package-size"],
  };
}

export async function setArtifactInstallationEnabled(
  id: string,
  enabled: boolean,
): Promise<ArtifactInstallation> {
  const row = requireInstallation(id);
  try {
    if (row.artifact_type === "skill") {
      if (!row.skill_id) throw new Error("Installed skill record is missing.");
      await setSkillToolEnabled(row.skill_id, enabled);
    } else {
      if (!row.tool_server_id) throw new Error("Installed MCP server record is missing.");
      if (enabled) {
        const discovery = await discoverMcpServer(row.tool_server_id);
        if (discovery.server.status === "error") throw new Error(discovery.message);
      }
      await setToolServerEnabled(row.tool_server_id, enabled);
    }
  } catch (error) {
    await updateArtifactInstallation(id, {
      status: "error",
      last_error: String(error).slice(0, 2_000),
      updated_at: Date.now(),
    });
    throw error;
  }
  await updateArtifactInstallation(id, {
    status: enabled ? "enabled" : "disabled",
    safety_json: JSON.stringify({
      ...parseJson(row.safety_json),
      ...(enabled ? { reviewed: true, reviewedAt: Date.now() } : {}),
    }),
    last_error: null,
    updated_at: Date.now(),
  });
  return toInstallation(requireInstallation(id));
}

export async function uninstallArtifact(id: string): Promise<boolean> {
  const row = requireInstallation(id);
  if (row.skill_id) await deleteSkillTool(row.skill_id);
  if (row.tool_server_id) await permanentlyDeleteToolServer(row.tool_server_id);
  if (row.install_path && existsSync(row.install_path))
    rmSync(row.install_path, { recursive: true, force: true });
  return deleteArtifactInstallation(id);
}

async function installSkillItem(
  item: typeof catalogItems.$inferSelect,
  input: CatalogInstallInput,
): Promise<ArtifactInstallation> {
  if (!item.install_url) throw new Error("Skill item does not provide an install URL.");
  const inspected = await loadSkillPackage(item);
  const installationId = existingInstallationId(item.id) ?? randomUUID();
  const target = join(app.getPath("userData"), "catalog", "skills", installationId);
  atomicWriteSkill(target, inspected.files);
  const existing = getDb()
    .select()
    .from(artifactInstallations)
    .where(eq(artifactInstallations.id, installationId))
    .get();
  const skill = existing?.skill_id
    ? await updateSkillTool(existing.skill_id, {
        name: inspected.name,
        description: inspected.description,
        instructions: inspected.markdown,
        enabled: false,
        config: {
          installationId,
          installPath: target,
          sourceItemId: item.id,
        },
      })
    : await createSkillTool({
        name: inspected.name,
        description: inspected.description,
        instructions: inspected.markdown,
        category: "catalog",
        enabled: false,
        auto_use: false,
        requires_approval: true,
        tags: ["catalog", "installed"],
        config: {
          installationId,
          installPath: target,
          sourceItemId: item.id,
        },
      });
  const now = Date.now();
  const hash = skillPackageHash(inspected);
  const row: typeof artifactInstallations.$inferInsert = {
    id: installationId,
    item_id: item.id,
    source_id: item.source_id,
    artifact_type: "skill",
    name: inspected.name,
    version: item.version,
    content_hash: item.content_hash ?? hash,
    install_path: target,
    status: "disabled",
    safety_json: JSON.stringify({
      reviewed: false,
      packageSha256: hash,
      fileCount: Object.keys(inspected.files).length,
      totalBytes: inspected.totalBytes,
      checks: [
        "frontmatter",
        "path-traversal",
        "file-count",
        "archive-size",
        "no-symlink-materialization",
      ],
    }),
    config_json: JSON.stringify(input.config ?? {}),
    tool_server_id: null,
    skill_id: skill.id,
    last_error: null,
    installed_at: existing?.installed_at ?? now,
    updated_at: now,
  };
  await upsertInstallation(row);
  if (input.enable) return await setArtifactInstallationEnabled(installationId, true);
  return toInstallation(requireInstallation(installationId));
}

async function installMcpItem(
  item: typeof catalogItems.$inferSelect,
  input: CatalogInstallInput,
): Promise<ArtifactInstallation> {
  const detail = catalogMcpDetail(parseJson(item.detail_json));
  if (!detail || detail.parseStatus === "unsupported") {
    throw new Error("This MCP item does not provide a supported standard configuration.");
  }
  const existingId = existingInstallationId(item.id);
  const existing = existingId
    ? getDb()
        .select()
        .from(artifactInstallations)
        .where(eq(artifactInstallations.id, existingId))
        .get()
    : null;
  const serverInput = {
    name: item.name,
    description: item.description,
    transport: detail.config.transport,
    enabled: false,
    auto_use: false,
    requires_approval: true,
    command: detail.config.command,
    args: detail.config.args,
    url: detail.config.url,
    headers: detail.config.headers,
    env: detail.config.env,
    timeout_seconds: 60,
  } as const;
  let server;
  if (existing?.tool_server_id) {
    await closeMcpClient(existing.tool_server_id);
    server = await updateToolServer(existing.tool_server_id, serverInput);
  } else {
    server = await createToolServer(serverInput);
  }
  for (const [key, value] of Object.entries(input.secrets ?? {})) {
    await setToolSecret({ ownerType: "server", ownerId: server.id, key, label: key, value });
  }
  const now = Date.now();
  const row: typeof artifactInstallations.$inferInsert = {
    id: existingId ?? randomUUID(),
    item_id: item.id,
    source_id: item.source_id,
    artifact_type: "mcp",
    name: item.name,
    version: item.version,
    content_hash: item.content_hash,
    install_path: null,
    status: "disabled",
    safety_json: JSON.stringify({
      reviewed: false,
      source: "mcp.so",
      parseStatus: detail.parseStatus,
      warnings: detail.warnings,
      secretKeys: detail.config.secretKeys,
    }),
    config_json: JSON.stringify(input.config ?? {}),
    tool_server_id: server.id,
    skill_id: null,
    last_error: null,
    installed_at: existing?.installed_at ?? now,
    updated_at: now,
  };
  await upsertInstallation(row);
  if (input.enable) return await setArtifactInstallationEnabled(row.id, true);
  return toInstallation(requireInstallation(row.id));
}

async function loadSkillPackage(
  item: typeof catalogItems.$inferSelect,
): Promise<InspectedSkillArchive> {
  if (item.source_id === SKILLS_SH_SOURCE_ID) {
    const pkg = await downloadSkillsShPackage(item.external_id);
    return inspectSkillFiles(pkg.files);
  }
  if (!item.install_url) throw new Error("Skill item does not provide an install URL.");
  return inspectSkillArchive(await downloadSkillArchive(item.install_url));
}

function skillPackageHash(inspected: InspectedSkillArchive): string {
  const hash = createHash("sha256");
  for (const [path, data] of Object.entries(inspected.files).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    hash.update(path);
    hash.update(data);
  }
  return hash.digest("hex");
}

async function downloadSkillArchive(urlValue: string): Promise<Uint8Array> {
  const url = new URL(urlValue);
  if (url.protocol !== "https:") throw new Error("Skill downloads must use HTTPS.");
  if (!["modelscope.cn", "www.modelscope.cn"].includes(url.hostname)) {
    throw new Error("Skill archive host is not the ModelScope marketplace.");
  }
  if (!/^\/skills\/[^/]+\/[^/]+\/archive\/zip\/master$/.test(url.pathname)) {
    throw new Error("Skill archive URL does not match the ModelScope download protocol.");
  }
  const response = await fetch(url, { redirect: "follow" });
  const resolved = new URL(response.url || url.href);
  if (
    resolved.protocol !== "https:" ||
    !["modelscope.cn", "www.modelscope.cn"].includes(resolved.hostname)
  ) {
    throw new Error("Skill archive redirected to an untrusted origin.");
  }
  if (!response.ok) throw new Error(`Skill download returned HTTP ${response.status}.`);
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > 5 * 1024 * 1024) throw new Error("Skill archive exceeds 5 MB.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 5 * 1024 * 1024) throw new Error("Skill archive exceeds 5 MB.");
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error("ModelScope returned non-ZIP content instead of a Skill archive.");
  }
  return bytes;
}

function atomicWriteSkill(target: string, files: Record<string, Uint8Array>): void {
  const parent = dirname(target);
  mkdirSync(parent, { recursive: true });
  const temporary = `${target}.tmp-${randomUUID()}`;
  const rollback = `${target}.rollback-${randomUUID()}`;
  mkdirSync(temporary, { recursive: true });
  try {
    for (const [path, data] of Object.entries(files)) {
      const destination = resolve(temporary, path);
      if (relative(temporary, destination).startsWith(".."))
        throw new Error("Skill path escaped staging.");
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, data, { flag: "wx" });
    }
    if (existsSync(target)) renameSync(target, rollback);
    renameSync(temporary, target);
    if (existsSync(rollback)) rmSync(rollback, { recursive: true, force: true });
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true });
    if (!existsSync(target) && existsSync(rollback)) renameSync(rollback, target);
    throw error;
  }
}

async function upsertInstallation(row: typeof artifactInstallations.$inferInsert): Promise<void> {
  await upsertArtifactInstallation(row);
}

function existingInstallationId(itemId: string): string | null {
  return (
    getDb()
      .select({ id: artifactInstallations.id })
      .from(artifactInstallations)
      .where(eq(artifactInstallations.item_id, itemId))
      .get()?.id ?? null
  );
}

function requireInstallation(id: string): typeof artifactInstallations.$inferSelect {
  const row = getDb()
    .select()
    .from(artifactInstallations)
    .where(eq(artifactInstallations.id, id))
    .get();
  if (!row) throw new Error("Artifact installation does not exist.");
  return row;
}

function toCatalogItem(
  row: typeof catalogItems.$inferSelect,
  installation?: typeof artifactInstallations.$inferSelect,
): CatalogItem {
  const detail = parseJson(row.detail_json);
  const canonicalKey = typeof detail.canonicalKey === "string" ? detail.canonicalKey : null;
  const exactInstallation =
    installation ??
    getDb()
      .select()
      .from(artifactInstallations)
      .all()
      .find((value) => value.item_id === row.id);
  const installedByCanonical = canonicalKey
    ? getDb()
        .select()
        .from(artifactInstallations)
        .all()
        .some((value) => {
          if (!value.item_id) return false;
          const sourceItem = getDb()
            .select()
            .from(catalogItems)
            .where(eq(catalogItems.id, value.item_id))
            .get();
          const sourceDetail = sourceItem ? parseJson(sourceItem.detail_json) : {};
          return sourceDetail.canonicalKey === canonicalKey;
        })
    : false;
  const sourceKind = sourceKindForId(row.source_id);
  return {
    id: row.id,
    sourceId: row.source_id,
    sourceKind,
    sourceLabel:
      sourceKind === "skills-sh" ? "skills.sh" : sourceKind === "mcp-so" ? "MCP.so" : "ModelScope",
    artifactType: row.artifact_type,
    externalId: row.external_id,
    canonicalKey,
    name: row.name,
    description: row.description,
    version: row.version,
    installUrl: row.install_url,
    catalogUrl:
      typeof detail.skillUrl === "string"
        ? detail.skillUrl
        : typeof detail.catalogUrl === "string"
          ? detail.catalogUrl
          : null,
    metrics: {
      ...(typeof detail.installs === "number" ? { installs: detail.installs } : {}),
      ...(typeof detail.downloads === "number" ? { downloads: detail.downloads } : {}),
    },
    detail,
    contentHash: row.content_hash,
    cachedAt: row.cached_at,
    installed: !!exactInstallation || installedByCanonical,
    updateAvailable:
      !!exactInstallation &&
      (row.version && exactInstallation.version
        ? row.version !== exactInstallation.version
        : !!row.content_hash && exactInstallation.content_hash !== row.content_hash),
  };
}

function toInstallation(row: typeof artifactInstallations.$inferSelect): ArtifactInstallation {
  return {
    id: row.id,
    itemId: row.item_id,
    sourceId: row.source_id,
    artifactType: row.artifact_type,
    name: row.name,
    version: row.version,
    contentHash: row.content_hash,
    installPath: row.install_path,
    status: row.status,
    safety: parseJson(row.safety_json),
    config: parseJson(row.config_json),
    toolServerId: row.tool_server_id,
    skillId: row.skill_id,
    lastError: row.last_error,
    installedAt: row.installed_at,
    updatedAt: row.updated_at,
  };
}

function catalogItemId(sourceId: string, externalId: string): string {
  return `catalog-item-${createHash("sha256").update(`${sourceId}:${externalId}`).digest("hex").slice(0, 32)}`;
}

function parseJson(value: string): JsonObject {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as JsonObject)
      : {};
  } catch {
    return {};
  }
}

function catalogItemsInOrder(sourceId: string, externalIds: string[]): CatalogItem[] {
  if (externalIds.length === 0) return [];
  const rows = getDb()
    .select()
    .from(catalogItems)
    .all()
    .filter((row) => row.source_id === sourceId);
  const installations = getDb().select().from(artifactInstallations).all();
  const installationByItem = new Map(
    installations.filter((item) => item.item_id).map((item) => [item.item_id!, item]),
  );
  const byExternalId = new Map(rows.map((row) => [row.external_id, row]));
  return externalIds.flatMap((externalId) => {
    const row = byExternalId.get(externalId);
    return row ? [toCatalogItem(row, installationByItem.get(row.id))] : [];
  });
}

async function cacheSourceItems(
  sourceId: string,
  items: CatalogAdapterItem[],
  artifactType: CatalogArtifactType = "skill",
): Promise<void> {
  const now = Date.now();
  await cacheCatalogItems(
    items.map((item) => ({
      id: catalogItemId(sourceId, item.externalId),
      source_id: sourceId,
      artifact_type: artifactType,
      external_id: item.externalId,
      name: item.name.slice(0, 200),
      description: item.description.slice(0, 2_000),
      version: item.version ?? null,
      install_url: item.installUrl,
      detail_json: JSON.stringify(item.detail),
      content_hash: item.contentHash ?? null,
      cached_at: now,
      updated_at: now,
    })),
  );
}

async function setSourceSuccess(sourceId: string): Promise<void> {
  const now = Date.now();
  await updateCatalogSource(sourceId, { last_synced_at: now, last_error: null, updated_at: now });
}

async function setSourceError(sourceId: string, message: string): Promise<void> {
  await updateCatalogSource(sourceId, {
    last_error: message.slice(0, 2_000),
    updated_at: Date.now(),
  });
}

export function mergeCatalogItems(lists: CatalogItem[][]): CatalogItem[] {
  const result: CatalogItem[] = [];
  const seen = new Map<string, number>();
  const max = Math.max(0, ...lists.map((items) => items.length));
  for (let index = 0; index < max; index++) {
    for (const list of lists) {
      const item = list[index];
      if (!item) continue;
      const key = item.canonicalKey ?? `${item.sourceId}:${item.externalId}`;
      const previousIndex = seen.get(key);
      if (previousIndex === undefined) {
        seen.set(key, result.length);
        result.push(item);
      } else if (item.sourceKind === "skills-sh") {
        result[previousIndex] = {
          ...item,
          installed: item.installed || result[previousIndex]!.installed,
        };
      }
    }
  }
  return result;
}

function sourceIdForKind(kind: CatalogSourceKind): string {
  if (kind === "skills-sh") return SKILLS_SH_SOURCE_ID;
  if (kind === "mcp-so") return MCP_SO_SOURCE_ID;
  return MODELSCOPE_SOURCE_ID;
}

function sourceKindForId(sourceId: string): CatalogSourceKind {
  if (sourceId === SKILLS_SH_SOURCE_ID) return "skills-sh";
  if (sourceId === MCP_SO_SOURCE_ID) return "mcp-so";
  return "modelscope-skills";
}

function cachedMcpFacets(): CatalogFacets {
  const categories = new Map<string, { id: string; label: string; count: number }>();
  getDb()
    .select()
    .from(catalogItems)
    .all()
    .filter((row) => row.source_id === MCP_SO_SOURCE_ID)
    .forEach((row) => {
      const detail = parseJson(row.detail_json);
      const category = typeof detail.category === "string" ? detail.category : "";
      if (!category) return;
      const current = categories.get(category);
      categories.set(category, { id: category, label: category, count: (current?.count ?? 0) + 1 });
    });
  return {
    categories: [...categories.values()].sort((a, b) => b.count - a.count).slice(0, 40),
    tags: [
      { id: "featured", count: countCachedMcpTag("featured") },
      { id: "verified", count: countCachedMcpTag("verified") },
    ],
  };
}

function countCachedMcpTag(tag: "featured" | "verified"): number {
  return getDb()
    .select()
    .from(catalogItems)
    .all()
    .filter((row) => row.source_id === MCP_SO_SOURCE_ID && Boolean(parseJson(row.detail_json)[tag]))
    .length;
}

function catalogMcpDetail(value: JsonObject): CatalogMcpDetail | null {
  const raw = value.mcp;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const detail = raw as Partial<CatalogMcpDetail>;
  const config = detail.config;
  if (!config || typeof config !== "object" || Array.isArray(config)) return null;
  if (config.transport !== "stdio" && config.transport !== "http" && config.transport !== "sse") {
    return null;
  }
  if (!Array.isArray(config.args) || !config.headers || !config.env) return null;
  return detail as CatalogMcpDetail;
}

function normalizeInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return typeof value === "number" && Number.isInteger(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}
