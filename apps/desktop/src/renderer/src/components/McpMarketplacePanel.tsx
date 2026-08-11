import { useCallback, useEffect, useRef, useState } from "react";
import {
  Button,
  Card,
  Chip,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "./ui";
import { api } from "../lib/api";
import { useT } from "../lib/i18n";
import { notify } from "../lib/toast";
import { cn } from "../lib/utils";
import type {
  ArtifactInstallation,
  CatalogItem,
  CatalogItemDetail,
  CatalogMcpDetail,
  CatalogSearchResult,
  CatalogSort,
  CatalogTagFilter,
} from "@shared/types";
import {
  IconCheck,
  IconClose,
  IconGlobe,
  IconInfo,
  IconLink,
  IconPlus,
  IconRefresh,
  IconSearch,
} from "./icons";
import { EmptyTools, ReadStat } from "./ToolsPanel";

export interface McpMarketplacePanelProps {
  onInstalled: (
    installation: ArtifactInstallation,
    item: CatalogItem,
    savedSecretKeys: string[],
  ) => void;
}

type TagFilter = "all" | CatalogTagFilter;

export function McpMarketplacePanel({ onInstalled }: McpMarketplacePanelProps): React.JSX.Element {
  const { t, f, locale } = useT();
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<CatalogSort>("featured");
  const [tag, setTag] = useState<TagFilter>("all");
  const [category, setCategory] = useState("");
  const [result, setResult] = useState<CatalogSearchResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [detailItem, setDetailItem] = useState<CatalogItem | null>(null);
  const [detail, setDetail] = useState<CatalogItemDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const loadingMoreRef = useRef(false);
  const hasMoreRef = useRef(false);
  const requestIdRef = useRef(0);

  const loadPage = useCallback(
    async (nextPage: number, append: boolean, manual = false): Promise<void> => {
      if (append && (loadingMoreRef.current || !hasMoreRef.current)) return;
      const requestId = ++requestIdRef.current;
      if (append) {
        loadingMoreRef.current = true;
        setLoadingMore(true);
        setLoadMoreError(null);
      } else {
        loadingMoreRef.current = false;
        hasMoreRef.current = false;
        setLoading(true);
        setLoadingMore(false);
        setLoadMoreError(null);
      }
      if (manual) setRefreshing(true);
      try {
        const next = await api.catalog.search({
          artifactType: "mcp",
          page: nextPage,
          pageSize: 36,
          ...(query.trim() ? { query: query.trim() } : {}),
          sort,
          ...(tag !== "all" ? { tag } : {}),
          ...(category ? { category } : {}),
        });
        if (requestId !== requestIdRef.current) return;
        setResult(next);
        setItems((current) => {
          if (!append) return next.items;
          const byId = new Map(current.map((item) => [item.id, item]));
          next.items.forEach((item) => byId.set(item.id, item));
          return [...byId.values()];
        });
        setPage(next.page);
        hasMoreRef.current = next.hasMore;
        setHasMore(next.hasMore);
        setError(null);
      } catch (reason) {
        if (requestId !== requestIdRef.current) return;
        const message = reason instanceof Error ? reason.message : String(reason);
        if (append) setLoadMoreError(message);
        setError(message);
        if (!append) notify.error(t("catalog.mcp.loadFailed"), reason, locale);
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
          if (append) {
            loadingMoreRef.current = false;
            setLoadingMore(false);
          }
          if (manual) setRefreshing(false);
        }
      }
    },
    [category, locale, query, sort, t, tag],
  );

  useEffect(() => {
    requestIdRef.current += 1;
    setItems([]);
    setResult(null);
    setPage(0);
    hasMoreRef.current = false;
    setHasMore(false);
    setError(null);
    setLoadMoreError(null);
    setLoading(true);
    const timer = window.setTimeout(() => void loadPage(1, false), 220);
    return () => window.clearTimeout(timer);
  }, [category, loadPage, query, sort, tag]);

  useEffect(() => {
    const sentinel = loadMoreRef.current;
    const scrollContainer = scrollContainerRef.current;
    if (!sentinel || !scrollContainer || loading || loadingMore || !hasMore || loadMoreError)
      return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void loadPage(page + 1, true);
      },
      { root: scrollContainer, rootMargin: "0px 0px 320px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadMoreError, loadPage, loading, loadingMore, page]);

  const openDetail = (item: CatalogItem): void => {
    setDetailItem(item);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    void api.catalog
      .detail(item.id)
      .then(setDetail)
      .catch((reason) => setDetailError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setDetailLoading(false));
  };

  const install = async (item: CatalogItem, secrets: Record<string, string>): Promise<void> => {
    setBusyId(item.id);
    try {
      const itemForReview =
        detail?.itemId === item.id && detail.mcp
          ? { ...item, detail: { ...item.detail, mcp: detail.mcp } }
          : item;
      const installation = await api.catalog.install({
        itemId: item.id,
        enable: false,
        ...(Object.keys(secrets).length > 0 ? { secrets } : {}),
      });
      setItems((current) =>
        current.map((currentItem) =>
          currentItem.id === item.id
            ? { ...currentItem, installed: true, updateAvailable: false }
            : currentItem,
        ),
      );
      setDetailItem(null);
      notify.success(t("catalog.mcp.installedDisabled"));
      onInstalled(installation, itemForReview, Object.keys(secrets));
    } catch (reason) {
      notify.error(t("catalog.installFailed"), reason, locale);
    } finally {
      setBusyId(null);
    }
  };

  const source = result?.sources.find((value) => value.source === "mcp-so");
  const categories = result?.facets?.categories ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
      <div className="flex shrink-0 flex-col gap-3">
        <div className="flex flex-col gap-2 lg:flex-row">
          <label className="relative min-w-0 flex-1">
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder={t("catalog.mcp.search")}
              aria-label={t("catalog.mcp.search")}
            />
          </label>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <select
              className="h-10 min-w-0 rounded-md border border-border bg-background px-3 text-sm"
              value={tag}
              onChange={(event) => setTag(event.currentTarget.value as TagFilter)}
              aria-label={t("catalog.mcp.tag")}
            >
              <option value="all">{t("catalog.mcp.allTags")}</option>
              <option value="featured">{t("catalog.mcp.featured")}</option>
              <option value="verified">{t("catalog.mcp.verified")}</option>
            </select>
            <select
              className="h-10 min-w-0 rounded-md border border-border bg-background px-3 text-sm"
              value={sort}
              onChange={(event) => setSort(event.currentTarget.value as CatalogSort)}
              aria-label={t("catalog.mcp.sort")}
            >
              <option value="featured">{t("catalog.mcp.sortFeatured")}</option>
              <option value="latest">{t("catalog.mcp.sortLatest")}</option>
              <option value="name">{t("catalog.mcp.sortName")}</option>
            </select>
            <Button
              isIconOnly
              size="md"
              variant="secondary"
              onPress={() => void loadPage(1, false, true)}
              isDisabled={refreshing}
              aria-label={t("main.refresh")}
              title={t("main.refresh")}
            >
              <IconRefresh className={cn("size-4", refreshing && "animate-spin")} />
            </Button>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_220px]">
          <div className="flex min-w-0 items-center justify-between gap-3 text-xs text-muted-foreground">
            <span className="truncate">
              {source?.status === "cache"
                ? t("catalog.mcp.cacheState")
                : t("catalog.mcp.sourceState")}
            </span>
            <span className="shrink-0">
              {t("catalog.loaded", { count: f.number(items.length) })}
            </span>
          </div>
          <select
            className="h-9 min-w-0 rounded-md border border-border bg-background px-3 text-xs"
            value={category}
            onChange={(event) => setCategory(event.currentTarget.value)}
            aria-label={t("catalog.mcp.category")}
          >
            <option value="">{t("catalog.mcp.allCategories")}</option>
            {categories.map((facet) => (
              <option key={facet.id} value={facet.id}>
                {facet.label} ({f.number(facet.count)})
              </option>
            ))}
          </select>
        </div>
      </div>

      {source?.error ? (
        <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          {source.status === "cache" ? t("catalog.mcp.cacheWarning") : t("catalog.sourceWarning")}{" "}
          {source.error}
        </p>
      ) : null}
      {error && !source?.error ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-danger/30 px-3 py-2 text-sm text-danger">
          <span className="break-words">{error}</span>
          <Button size="sm" variant="secondary" onPress={() => void loadPage(1, false, true)}>
            {t("catalog.retry")}
          </Button>
        </div>
      ) : null}

      <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-y-auto" aria-busy={loading}>
        {loading && items.length === 0 ? (
          <McpMarketplaceSkeleton />
        ) : items.length === 0 ? (
          <EmptyTools message={t("catalog.mcp.empty")} />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => (
              <McpMarketplaceCard
                key={item.id}
                item={item}
                busy={busyId !== null}
                onDetail={openDetail}
              />
            ))}
          </div>
        )}
        {items.length > 0 && hasMore ? (
          <div ref={loadMoreRef} className="flex min-h-12 items-center justify-center py-3">
            {loadingMore ? (
              <span className="text-xs text-muted-foreground">{t("catalog.mcp.loadingMore")}</span>
            ) : null}
          </div>
        ) : null}
      </div>

      <McpMarketplaceDetailModal
        item={detailItem}
        detail={detail}
        loading={detailLoading}
        error={detailError}
        busy={detailItem !== null && busyId === detailItem.id}
        onClose={() => setDetailItem(null)}
        onRetry={() => (detailItem ? openDetail(detailItem) : undefined)}
        onInstall={(item, secrets) => void install(item, secrets)}
      />
    </div>
  );
}

function McpMarketplaceSkeleton(): React.JSX.Element {
  return (
    <div className="grid animate-pulse gap-3 md:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
      {[0, 1, 2, 3, 4, 5].map((id) => (
        <Card key={id} className="rounded-md">
          <Card.Header className="flex flex-col gap-3">
            <div className="flex gap-3">
              <div className="size-9 rounded-full bg-muted" />
              <div className="min-w-0 flex flex-1 flex-col gap-2">
                <div className="h-4 w-3/5 rounded bg-muted" />
                <div className="h-3 w-4/5 rounded bg-muted" />
              </div>
            </div>
            <div className="h-8 rounded bg-muted" />
          </Card.Header>
          <Card.Footer>
            <div className="h-8 rounded bg-muted" />
          </Card.Footer>
        </Card>
      ))}
    </div>
  );
}

function McpMarketplaceCard({
  item,
  busy,
  onDetail,
}: {
  item: CatalogItem;
  busy: boolean;
  onDetail: (item: CatalogItem) => void;
}): React.JSX.Element {
  const { t } = useT();
  const detail = item.detail.mcp as unknown as CatalogMcpDetail | undefined;
  return (
    <Card className="flex h-full flex-col rounded-md">
      <Card.Header>
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <IconGlobe className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <Card.Title className="truncate">{item.name}</Card.Title>
            <Card.Description className="line-clamp-2">
              {item.description || t("tools.mcp.noDescription")}
            </Card.Description>
          </div>
        </div>
        <div className="mt-3 flex min-h-5 flex-wrap gap-1.5">
          {detail?.featured ? (
            <Chip size="sm" color="accent">
              {t("catalog.mcp.featured")}
            </Chip>
          ) : null}
          {detail?.verified ? (
            <Chip size="sm" color="success">
              {t("catalog.mcp.verified")}
            </Chip>
          ) : null}
          {detail?.category ? (
            <Chip size="sm" variant="secondary">
              {detail.category}
            </Chip>
          ) : null}
        </div>
      </Card.Header>
      <Card.Footer className="mt-auto">
        <div className="flex w-full items-center justify-between gap-2">
          <Button size="sm" variant="tertiary" onPress={() => onDetail(item)} isDisabled={busy}>
            <IconInfo className="size-4" />
            {t("catalog.details")}
          </Button>
          <Button size="sm" variant="primary" onPress={() => onDetail(item)} isDisabled={busy}>
            {item.installed && !item.updateAvailable ? (
              <IconCheck className="size-4" />
            ) : (
              <IconPlus className="size-4" />
            )}
            {item.installed && !item.updateAvailable
              ? t("catalog.installed")
              : t("catalog.mcp.reviewInstall")}
          </Button>
        </div>
      </Card.Footer>
    </Card>
  );
}

function McpMarketplaceDetailModal({
  item,
  detail,
  loading,
  error,
  busy,
  onClose,
  onRetry,
  onInstall,
}: {
  item: CatalogItem | null;
  detail: CatalogItemDetail | null;
  loading: boolean;
  error: string | null;
  busy: boolean;
  onClose: () => void;
  onRetry: () => void;
  onInstall: (item: CatalogItem, secrets: Record<string, string>) => void;
}): React.JSX.Element {
  const { t, f } = useT();
  const secretRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const itemDetail = item?.detail.mcp as unknown as CatalogMcpDetail | undefined;
  const mcp = detail?.mcp ?? itemDetail;
  const metric = item?.metrics.installs ?? item?.metrics.downloads ?? 0;
  const secretKeys = mcp?.config.secretKeys ?? [];

  useEffect(() => {
    secretRefs.current = {};
  }, [item?.id]);

  return (
    <Dialog open={item !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-h-[90vh] w-[min(820px,calc(100vw-24px))] max-w-none">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle>{item?.name}</DialogTitle>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {item?.sourceLabel} / {item?.externalId}
              </p>
            </div>
            <Button
              isIconOnly
              size="sm"
              variant="tertiary"
              onPress={onClose}
              aria-label={t("common.close")}
            >
              <IconClose className="size-4" />
            </Button>
          </div>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-4">
          {item ? (
            <div className="grid gap-2 sm:grid-cols-4">
              <ReadStat label={t("catalog.mcp.author")} value={mcp?.author || "-"} />
              <ReadStat label={t("catalog.transport")} value={mcp?.config.transport || "-"} />
              <ReadStat
                label={t("catalog.mcp.tools")}
                value={mcp ? f.number(mcp.tools.length) : "-"}
              />
              <ReadStat
                label={t("catalog.installs")}
                value={metric ? f.compactNumber(metric) : "-"}
              />
            </div>
          ) : null}
          {item?.description ? (
            <p className="text-sm text-muted-foreground">{item.description}</p>
          ) : null}
          {loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t("catalog.detailLoading")}
            </p>
          ) : null}
          {error ? (
            <div className="flex flex-col gap-2">
              <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
              <Button size="sm" variant="secondary" onPress={onRetry}>
                {t("catalog.retry")}
              </Button>
            </div>
          ) : null}
          {mcp ? (
            <>
              <div className="flex flex-wrap gap-1.5">
                {mcp.featured ? (
                  <Chip size="sm" color="accent">
                    {t("catalog.mcp.featured")}
                  </Chip>
                ) : null}
                {mcp.verified ? (
                  <Chip size="sm" color="success">
                    {t("catalog.mcp.verified")}
                  </Chip>
                ) : null}
                {mcp.category ? (
                  <Chip size="sm" variant="secondary">
                    {mcp.category}
                  </Chip>
                ) : null}
                {mcp.tags.map((value) => (
                  <Chip key={value} size="sm" variant="secondary">
                    {value}
                  </Chip>
                ))}
              </div>
              {mcp.warnings.length > 0 ? (
                <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                  <p className="font-medium">{t("catalog.mcp.warnings")}</p>
                  <ul className="mt-1 list-disc pl-4 [&>li+li]:mt-1">
                    {mcp.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {secretKeys.length > 0 ? (
                <div className="flex flex-col gap-2 rounded-md border border-border p-3">
                  <div>
                    <p className="text-sm font-medium">{t("catalog.secrets")}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("catalog.mcp.secretsHint")}
                    </p>
                  </div>
                  {secretKeys.map((key) => (
                    <label key={key} className="grid gap-1.5 text-xs font-medium">
                      <span>{key}</span>
                      <Input
                        type="password"
                        placeholder="$secret:{key}"
                        ref={(node) => {
                          secretRefs.current[key] = node;
                        }}
                      />
                    </label>
                  ))}
                </div>
              ) : null}
              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium">{t("catalog.mcp.configuration")}</p>
                <pre className="max-h-52 overflow-auto rounded-md border border-border bg-muted/30 p-3 font-mono text-[11px] text-muted-foreground">
                  {JSON.stringify(mcp.config, null, 2)}
                </pre>
              </div>
              {mcp.tools.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-medium">{t("catalog.mcp.toolSummary")}</p>
                  <div className="max-h-44 flex flex-col gap-1 overflow-y-auto rounded-md border border-border p-2">
                    {mcp.tools.map((tool) => (
                      <div
                        key={tool.name}
                        className="rounded px-2 py-1.5 text-xs hover:bg-muted/50"
                      >
                        <p className="font-medium">{tool.name}</p>
                        {tool.description ? (
                          <p className="mt-0.5 text-muted-foreground">{tool.description}</p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
          {item?.catalogUrl ? (
            <a
              className="inline-flex items-center gap-1 text-xs text-accent underline underline-offset-2"
              href={item.catalogUrl}
              target="_blank"
              rel="noreferrer"
            >
              <IconLink className="size-3.5" />
              {t("catalog.openSource")}
            </a>
          ) : null}
          {mcp?.repositoryUrl ? (
            <a
              className="ml-3 inline-flex items-center gap-1 text-xs text-accent underline underline-offset-2"
              href={mcp.repositoryUrl}
              target="_blank"
              rel="noreferrer"
            >
              <IconLink className="size-3.5" />
              {t("catalog.mcp.repository")}
            </a>
          ) : null}
        </div>
        <DialogFooter className="flex justify-end gap-2">
          <Button variant="tertiary" onPress={onClose}>
            {t("common.cancel")}
          </Button>
          {item ? (
            <Button
              variant="primary"
              isPending={busy}
              isDisabled={
                !mcp ||
                mcp.parseStatus === "unsupported" ||
                (item.installed && !item.updateAvailable)
              }
              onPress={() =>
                onInstall(
                  item,
                  Object.fromEntries(
                    secretKeys
                      .map((key) => [key, secretRefs.current[key]?.value.trim() ?? ""] as const)
                      .filter(([, value]) => value),
                  ),
                )
              }
            >
              <IconPlus className="size-4" />
              {item.installed ? t("catalog.updateDisabled") : t("catalog.mcp.installReview")}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
