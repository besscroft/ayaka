import { useCallback, useEffect, useRef, useState } from "react";
import type { BrowserSessionSnapshot } from "@shared/types";
import { api } from "../lib/api";
import { useT } from "../lib/i18n";
import { Button } from "./ui";
import {
  IconArrowLeft,
  IconArrowRight,
  IconCamera,
  IconClose,
  IconPlus,
  IconRefresh,
} from "./icons";

const OPEN_WORKSPACE_PANEL_EVENT = "ayaka:open-workspace-panel";

export function BrowserPane({
  conversationId,
  visible,
}: {
  conversationId: string;
  visible: boolean;
}): React.JSX.Element {
  const { t } = useT();
  const [browser, setBrowser] = useState<BrowserSessionSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const activeTab = browser?.tabs.find((tab) => tab.id === browser.activeTabId) ?? browser?.tabs[0];

  const load = useCallback(async () => {
    try {
      setError(null);
      setBrowser(await api.browser.getSession(conversationId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [conversationId]);

  // 仅在面板真正展示时才拉取/创建浏览器会话：会话创建会顺带 prepare 工作区并
  // 落库会话记录，不能在点开新会话（尚未发送消息）时就触发。
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void api.browser.getSession(conversationId).then(
      (session) => {
        if (!cancelled) setBrowser(session);
      },
      (reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [conversationId, visible]);

  useEffect(() => {
    const offUpdated = api.browser.onUpdated((event) => {
      if (event.conversationId !== conversationId) return;
      setBrowser(event.session);
    });
    const offFocus = api.browser.onFocusRequested((event) => {
      if (event.conversationId !== conversationId) return;
      window.dispatchEvent(
        new CustomEvent(OPEN_WORKSPACE_PANEL_EVENT, { detail: { tab: "browser" } }),
      );
      void load();
    });
    return () => {
      offUpdated();
      offFocus();
    };
  }, [conversationId, load]);

  useEffect(() => {
    if (!browser?.latestScreenshot?.path) {
      return;
    }
    let objectUrl: string | null = null;
    void api.browser
      .readScreenshot({ conversationId, path: browser.latestScreenshot.path })
      .then((data) => {
        objectUrl = URL.createObjectURL(new Blob([data], { type: "image/png" }));
        setScreenshotUrl(objectUrl);
      })
      .catch(() => setScreenshotUrl(null));
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [browser?.latestScreenshot?.path, conversationId]);

  useEffect(() => {
    if (!visible || !browser?.activeTabId || !hostRef.current) return;
    const sendBounds = (): void => {
      const rect = hostRef.current?.getBoundingClientRect();
      if (!rect) return;
      void api.browser
        .setBounds({
          conversationId,
          tabId: browser.activeTabId!,
          bounds: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
        })
        .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
    };
    sendBounds();
    const observer = new ResizeObserver(sendBounds);
    observer.observe(hostRef.current);
    window.addEventListener("resize", sendBounds);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", sendBounds);
      void api.browser
        .setVisible({ conversationId, tabId: browser.activeTabId!, visible: false })
        .catch(() => undefined);
    };
  }, [browser?.activeTabId, conversationId, visible]);

  useEffect(() => {
    if (!browser?.activeTabId) return;
    void api.browser
      .setVisible({ conversationId, tabId: browser.activeTabId, visible })
      .catch(() => undefined);
  }, [browser?.activeTabId, conversationId, visible]);

  const run = (operation: () => Promise<BrowserSessionSnapshot>): void => {
    void operation()
      .then((next) => {
        setBrowser(next);
        setError(null);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  };

  const capture = (): void => {
    void api.browser
      .capture({ conversationId, tabId: activeTab?.id })
      .then((result) => {
        setBrowser((current) =>
          current ? { ...current, latestScreenshot: result.screenshot } : current,
        );
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  };

  return (
    <div
      data-slot="browser-pane"
      className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-background"
      aria-label={t("browser.title")}
    >
      <header className="flex min-w-0 shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
        <Button
          size="icon"
          variant="ghost"
          aria-label={t("browser.back")}
          title={t("browser.back")}
          isDisabled={!activeTab?.can_go_back}
          onPress={() =>
            run(() =>
              api.browser.navigate({ conversationId, tabId: activeTab?.id, action: "back" }),
            )
          }
        >
          <IconArrowLeft className="size-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label={t("browser.forward")}
          title={t("browser.forward")}
          isDisabled={!activeTab?.can_go_forward}
          onPress={() =>
            run(() =>
              api.browser.navigate({ conversationId, tabId: activeTab?.id, action: "forward" }),
            )
          }
        >
          <IconArrowRight className="size-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label={t("browser.reload")}
          title={t("browser.reload")}
          onPress={() =>
            run(() =>
              api.browser.navigate({ conversationId, tabId: activeTab?.id, action: "reload" }),
            )
          }
        >
          <IconRefresh className="size-3.5" />
        </Button>
        <BrowserAddressBar
          key={`${activeTab?.id ?? "empty"}:${activeTab?.url ?? ""}`}
          initialUrl={activeTab?.url}
          onNavigate={(url) =>
            run(() =>
              api.browser.navigate({ conversationId, tabId: activeTab?.id, action: "open", url }),
            )
          }
        />
        <Button
          size="icon"
          variant="ghost"
          aria-label={t("browser.screenshot")}
          title={t("browser.screenshot")}
          onPress={capture}
        >
          <IconCamera className="size-3.5" />
        </Button>
      </header>

      <div className="flex min-w-0 shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-2 py-1">
        {browser?.tabs.map((tab) => (
          <div
            key={tab.id}
            className={`group flex min-w-0 max-w-44 items-center gap-1 rounded-md px-2 py-1 text-[11px] ${tab.id === browser.activeTabId ? "bg-accent/15 text-foreground" : "text-foreground/60 hover:bg-muted"}`}
          >
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left"
              title={tab.title}
              onClick={() => run(() => api.browser.selectTab({ conversationId, tabId: tab.id }))}
            >
              {tab.title || t("browser.newTab")}
            </button>
            <button
              type="button"
              className="rounded p-0.5 opacity-60 hover:bg-background hover:opacity-100"
              aria-label={t("browser.closeTab")}
              title={t("browser.closeTab")}
              onClick={() => run(() => api.browser.closeTab({ conversationId, tabId: tab.id }))}
            >
              <IconClose className="size-3" />
            </button>
          </div>
        ))}
        <Button
          size="icon"
          variant="ghost"
          className="shrink-0"
          aria-label={t("browser.newTab")}
          title={t("browser.newTab")}
          onPress={() => run(() => api.browser.createTab({ conversationId }))}
        >
          <IconPlus className="size-3.5" />
        </Button>
      </div>

      {error ? (
        <p
          className="shrink-0 border-b border-danger/20 bg-danger/5 px-3 py-1.5 text-[10px] text-danger"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      <div ref={hostRef} className="relative min-h-0 flex-1 bg-white" />
      {screenshotUrl ? (
        <button
          type="button"
          className="absolute bottom-3 right-3 z-10 overflow-hidden rounded-md border border-border bg-background shadow-lg"
          aria-label={t("browser.openScreenshot")}
          title={t("browser.openScreenshot")}
          onClick={() => window.open(screenshotUrl, "_blank", "noopener,noreferrer")}
        >
          <img
            src={screenshotUrl}
            alt={t("browser.screenshot")}
            className="h-20 w-28 object-cover"
          />
        </button>
      ) : null}
    </div>
  );
}

function BrowserAddressBar({
  initialUrl,
  onNavigate,
}: {
  initialUrl?: string;
  onNavigate: (url: string) => void;
}): React.JSX.Element {
  const { t } = useT();
  const [address, setAddress] = useState(initialUrl === "about:blank" ? "" : (initialUrl ?? ""));

  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const raw = address.trim();
    if (!raw) return;
    onNavigate(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  };

  return (
    <form className="min-w-0 flex-1" onSubmit={submit}>
      <input
        className="h-7 w-full rounded-md border border-border bg-muted/35 px-2 text-xs outline-none focus:border-accent"
        aria-label={t("browser.address")}
        value={address}
        onChange={(event) => setAddress(event.target.value)}
        placeholder={t("browser.addressPlaceholder")}
      />
    </form>
  );
}
