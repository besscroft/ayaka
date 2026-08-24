import { useCallback, useEffect, useRef, useState } from "react";
import type { SandboxArtifact, SandboxPreview } from "@shared/types";
import { api } from "../lib/api";
import { useT } from "../lib/i18n";
import { getGeneratedAppPreviewMode, protectGeneratedHtml } from "../lib/generated-tool-ui";
import { Button } from "./ui";
import {
  IconBookOpen,
  IconClose,
  IconCode,
  IconEye,
  IconFolderOpen,
  IconGlobe,
  IconRefresh,
  IconMaximize,
} from "./icons";

interface GeneratedAppPaneProps {
  conversationId: string;
  visible: boolean;
  requestedArtifactId?: string | null;
  onRequestOpen?: (artifactId?: string) => void;
  onSummaryChange?: (summary: GeneratedAppSummary) => void;
}

export interface GeneratedAppSummary {
  artifactCount: number;
  pendingAuthorization: number;
  runningPreviews: number;
  failedPreviews: number;
}

const MAX_HTML_EXECUTABLE_BYTES = 256 * 1024;

export function GeneratedAppPane({
  conversationId,
  visible,
  requestedArtifactId,
  onRequestOpen,
  onSummaryChange,
}: GeneratedAppPaneProps): React.JSX.Element {
  const { t, f } = useT();
  const [artifacts, setArtifacts] = useState<SandboxArtifact[]>([]);
  const [previews, setPreviews] = useState<SandboxPreview[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sourceMode, setSourceMode] = useState(false);
  const [source, setSource] = useState<string | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [resourceUrl, setResourceUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const hostRef = useRef<HTMLDivElement>(null);

  const selected = artifacts.find((artifact) => artifact.id === selectedId) ?? artifacts[0] ?? null;
  const selectedPreview = previews.find((preview) => preview.artifact_id === selected?.id) ?? null;
  const executableTooLarge =
    (selected?.kind === "html" && (selected.size_bytes ?? 0) > MAX_HTML_EXECUTABLE_BYTES) || false;
  const previewMode = getGeneratedAppPreviewMode({
    kind: selected?.kind,
    authorized: selected?.authorized,
    sourceMode,
    previewStatus: selectedPreview?.status,
    sizeBytes: selected?.size_bytes ?? undefined,
    maxHtmlBytes: MAX_HTML_EXECUTABLE_BYTES,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextArtifacts, nextPreviews] = await Promise.all([
        api.sandboxArtifacts.list(conversationId),
        api.sandboxPreviews.list(conversationId),
      ]);
      const previewable = nextArtifacts.filter(
        (artifact) => artifact.kind === "html" || artifact.kind === "static",
      );
      setArtifacts(previewable);
      setPreviews(nextPreviews);
      setSelectedId((current) =>
        current && previewable.some((artifact) => artifact.id === current)
          ? current
          : (previewable[0]?.id ?? null),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    setArtifacts([]);
    setPreviews([]);
    setSelectedId(null);
    setSource(null);
    setResourceUrl(null);
    setRefreshNonce(0);
    void load();
  }, [conversationId, load]);

  useEffect(() => {
    if (requestedArtifactId && artifacts.some((artifact) => artifact.id === requestedArtifactId)) {
      setSelectedId(requestedArtifactId);
    }
  }, [artifacts, requestedArtifactId]);

  useEffect(() => {
    const offArtifact = api.sandboxArtifacts.onUpdated((artifact) => {
      if (artifact.conversationId !== conversationId) return;
      if (artifact.kind === "preview") return;
      const wasKnown = artifacts.some((item) => item.id === artifact.id);
      if (wasKnown) {
        setArtifacts((current) => {
          const next = current.filter((item) => item.id !== artifact.id);
          return [artifact, ...next];
        });
      } else {
        void load();
      }
      if (artifact.kind === "html" || artifact.kind === "static") {
        setSelectedId(artifact.id);
        if (!wasKnown) onRequestOpen?.(artifact.id);
      }
    });
    const offPreview = api.sandboxPreviews.onUpdated((preview) => {
      if (preview.conversation_id !== conversationId) return;
      setPreviews((current) => {
        const next = current.filter((item) => item.id !== preview.id);
        return [preview, ...next];
      });
    });
    return () => {
      offArtifact();
      offPreview();
    };
  }, [artifacts, conversationId, load, onRequestOpen]);

  useEffect(() => {
    onSummaryChange?.({
      artifactCount: artifacts.length,
      pendingAuthorization: artifacts.filter((artifact) => !artifact.authorized).length,
      runningPreviews: previews.filter((preview) => preview.status === "running").length,
      failedPreviews: previews.filter((preview) => preview.status === "failed").length,
    });
  }, [artifacts, onSummaryChange, previews]);

  useEffect(() => {
    return () => {
      void api.sandboxPreviews
        .list(conversationId)
        .then((items) =>
          Promise.all(
            items.map((item) =>
              api.sandboxPreviews.close({ conversationId, previewId: item.id }).catch(() => false),
            ),
          ),
        );
    };
  }, [conversationId]);

  useEffect(() => {
    setSource(null);
    setSourceError(null);
    setResourceUrl(null);
    setSourceMode(false);
    if (!selected || !selected.authorized) return;
    if (selected.kind === "html") {
      void api.sandboxArtifacts
        .read({ conversationId, artifactId: selected.id })
        .then((value) => setSource(protectGeneratedHtml(value.text)))
        .catch((reason) =>
          setSourceError(reason instanceof Error ? reason.message : String(reason)),
        );
    } else if (selected.kind === "static") {
      void api.sandboxArtifacts
        .resourceUrl({ conversationId, artifactId: selected.id })
        .then(setResourceUrl)
        .catch((reason) =>
          setSourceError(reason instanceof Error ? reason.message : String(reason)),
        );
    }
  }, [conversationId, selected]);

  useEffect(() => {
    if (
      !visible ||
      sourceMode ||
      !selectedPreview ||
      selectedPreview.status !== "running" ||
      !hostRef.current
    )
      return;
    const sendBounds = (): void => {
      const rect = hostRef.current?.getBoundingClientRect();
      if (!rect) return;
      void api.sandboxPreviews.setBounds({
        conversationId,
        previewId: selectedPreview.id,
        bounds: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      });
    };
    sendBounds();
    const observer = new ResizeObserver(sendBounds);
    observer.observe(hostRef.current);
    window.addEventListener("resize", sendBounds);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", sendBounds);
    };
  }, [conversationId, selectedPreview, sourceMode, visible]);

  useEffect(() => {
    if (!selectedPreview) return;
    void api.sandboxPreviews
      .setVisible({
        conversationId,
        previewId: selectedPreview.id,
        visible,
      })
      .catch(() => undefined);
    return () => {
      void api.sandboxPreviews
        .setVisible({
          conversationId,
          previewId: selectedPreview.id,
          visible: false,
        })
        .catch(() => undefined);
    };
  }, [conversationId, selectedPreview, visible]);

  const authorize = async (): Promise<void> => {
    if (!selected) return;
    try {
      const next = await api.sandboxArtifacts.authorize({
        conversationId,
        artifactId: selected.id,
      });
      setArtifacts((current) => current.map((item) => (item.id === next.id ? next : item)));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const revoke = async (): Promise<void> => {
    if (!selected) return;
    if (selectedPreview) {
      await api.sandboxPreviews
        .close({ conversationId, previewId: selectedPreview.id })
        .catch(() => undefined);
    }
    await api.sandboxArtifacts
      .revoke({ conversationId, artifactId: selected.id })
      .catch(() => undefined);
    setSource(null);
    setResourceUrl(null);
    setSourceMode(false);
    await load();
  };

  const closePreview = async (): Promise<void> => {
    const items = await api.sandboxPreviews.list(conversationId).catch(() => []);
    await Promise.all(
      items.map((item) =>
        api.sandboxPreviews.close({ conversationId, previewId: item.id }).catch(() => false),
      ),
    );
  };

  const refresh = (): void => {
    setRefreshNonce((value) => value + 1);
    void load();
  };

  return (
    <div
      data-slot="generated-app-pane"
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-background"
      aria-label={t("generatedApp.title")}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <IconEye className="size-3.5 text-primary" />
        <h2 className="min-w-0 flex-1 truncate text-xs font-semibold">{t("generatedApp.title")}</h2>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("generatedApp.refresh")}
          onPress={refresh}
        >
          <IconRefresh className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("generatedApp.close")}
          onPress={() => void closePreview()}
        >
          <IconClose className="size-3.5" />
        </Button>
      </header>
      {artifacts.length > 1 ? (
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-2 py-1.5">
          {artifacts.map((artifact) => (
            <button
              key={artifact.id}
              type="button"
              className={`max-w-44 truncate rounded px-2 py-1 text-[10px] ${
                artifact.id === selected?.id
                  ? "bg-primary/15 text-primary"
                  : "text-foreground/55 hover:bg-muted"
              }`}
              onClick={() => setSelectedId(artifact.id)}
            >
              {artifact.path}
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col">
        {loading ? (
          <p className="p-4 text-xs text-foreground/50">{t("generatedApp.loading")}</p>
        ) : null}
        {error ? (
          <p className="p-4 text-xs text-danger" role="alert">
            {error}
          </p>
        ) : null}
        {!loading && !error && !selected ? <EmptyPane /> : null}
        {selected ? (
          <>
            <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
              {selected.kind === "static" ? (
                <IconFolderOpen className="size-3.5" />
              ) : (
                <IconBookOpen className="size-3.5" />
              )}
              <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-foreground/65">
                {selected.path}
              </span>
              <span className="shrink-0 text-[10px] text-foreground/40">
                {f.bytes(selected.size_bytes ?? 0)}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
              {!selected.authorized ? (
                <Button size="sm" variant="primary" onPress={() => void authorize()}>
                  {t("generatedApp.authorize")}
                </Button>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant={sourceMode ? "secondary" : "primary"}
                    onPress={() => setSourceMode(false)}
                  >
                    <IconEye className="size-3" /> {t("generatedApp.preview")}
                  </Button>
                  {selected.kind === "html" ? (
                    <Button
                      size="sm"
                      variant={sourceMode ? "primary" : "secondary"}
                      onPress={() => setSourceMode(true)}
                    >
                      <IconCode className="size-3" /> {t("generatedApp.source")}
                    </Button>
                  ) : null}
                  {selectedPreview ? (
                    selectedPreview.status === "running" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onPress={() =>
                          void api.sandboxPreviews.stop({
                            conversationId,
                            previewId: selectedPreview.id,
                          })
                        }
                      >
                        <IconMaximize className="size-3" /> {t("generatedApp.stop")}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onPress={() =>
                          void api.sandboxPreviews.restart({
                            conversationId,
                            previewId: selectedPreview.id,
                          })
                        }
                      >
                        <IconRefresh className="size-3" /> {t("generatedApp.restart")}
                      </Button>
                    )
                  ) : null}
                  <Button size="sm" variant="ghost" onPress={() => void revoke()}>
                    {t("generatedApp.revoke")}
                  </Button>
                </>
              )}
            </div>
            {previewMode === "authorization" ? (
              <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-foreground/55">
                {t("generatedApp.authorizationRequired")}
              </div>
            ) : previewMode === "source" ? (
              <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-3 font-mono text-[11px] leading-relaxed text-foreground/75">
                {sourceError ?? source ?? t("generatedApp.sourceLoading")}
              </pre>
            ) : previewMode === "localhost" ? (
              <div
                ref={hostRef}
                className="min-h-0 flex-1 bg-background p-4 text-xs text-foreground/55"
              />
            ) : previewMode === "html" ? (
              <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden bg-white">
                {source ? (
                  <iframe
                    key={`${selected.id}:${refreshNonce}`}
                    title={selected.path}
                    className="size-full border-0"
                    sandbox="allow-scripts"
                    srcDoc={source}
                  />
                ) : null}
              </div>
            ) : previewMode === "static" ? (
              <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden bg-white">
                {resourceUrl ? (
                  <iframe
                    key={`${resourceUrl}:${refreshNonce}`}
                    title={selected.path}
                    className="size-full border-0"
                    sandbox="allow-scripts"
                    src={resourceUrl}
                  />
                ) : null}
              </div>
            ) : selected.kind === "preview" && selectedPreview ? (
              <div
                ref={hostRef}
                className="min-h-0 flex-1 bg-background p-4 text-xs text-foreground/55"
              >
                {selectedPreview.status === "running"
                  ? null
                  : t(`generatedApp.status.${selectedPreview.status}`)}
              </div>
            ) : null}
            {selected.kind === "html" && executableTooLarge ? (
              <p className="shrink-0 border-t border-warning/30 bg-warning/10 px-3 py-2 text-[10px] text-warning">
                {t("generatedApp.tooLarge")}
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

function EmptyPane(): React.JSX.Element {
  const { t } = useT();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-xs text-foreground/45">
      <IconGlobe className="size-5" />
      <p>{t("generatedApp.empty")}</p>
    </div>
  );
}
