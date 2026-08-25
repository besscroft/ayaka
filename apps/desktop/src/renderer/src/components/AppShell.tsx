import { useEffect, useMemo, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import runningConversationIconUrl from "@ayaka/assets/emotions/bloub-cercle-neutre-bleu-anime.svg";
import { Button } from "./ui";
import { api } from "../lib/api";
import { notify } from "../lib/toast";
import { useT, type TranslationKey } from "../lib/i18n";
import { getRunningConversationIds } from "../lib/agent-runtime-status";
import {
  IconMessage,
  IconPlus,
  IconSettings,
  IconTrash,
  IconCpu,
  IconDatabase,
  IconGlobe,
  IconWrench,
  IconSearch,
  IconClose,
  IconClock,
  IconSparkles,
} from "./icons";
import type { Conversation } from "@shared/types";
import type { MainSection } from "./MainPanelView";
import { ConfirmDialog } from "./ConfirmDialog";
import { WindowTitleBar } from "./WindowTitleBar";

export type AppView = "chat" | MainSection;

interface AppShellProps {
  activeView: AppView;
  activeConversationId: string | null;
  onSelectView: (view: AppView) => void;
  onSelectConversation: (id: string) => void;
  onCreateConversation: () => void;
  onDeleteConversation: (id: string) => void;
  onOpenSettings: () => void;
  children: ReactNode;
}

const primaryNav: { id: AppView; labelKey: TranslationKey; Icon: typeof IconMessage }[] = [
  { id: "chat", labelKey: "shell.nav.conversations", Icon: IconMessage },
  { id: "agents", labelKey: "main.title.agents", Icon: IconCpu },
  // Agent Loop status and controls are shown in the chat header.
  { id: "tools", labelKey: "main.title.tools", Icon: IconWrench },
  { id: "mcp", labelKey: "main.title.mcp", Icon: IconGlobe },
  { id: "skills", labelKey: "skills.title", Icon: IconSparkles },
  { id: "automations", labelKey: "automation.title", Icon: IconClock },
  { id: "memory", labelKey: "main.title.memory", Icon: IconDatabase },
];

export function AppShell({
  activeView,
  activeConversationId,
  onSelectView,
  onSelectConversation,
  onCreateConversation,
  onDeleteConversation,
  onOpenSettings,
  children,
}: AppShellProps): React.JSX.Element {
  const { t, locale } = useT();
  const reduceMotion = useReducedMotion();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [pendingDelete, setPendingDelete] = useState<Conversation | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const [runningConversationIds, setRunningConversationIds] = useState<Set<string>>(
    () => new Set(),
  );

  const refresh = (): void => {
    void api.conversations.list().then(setConversations);
  };

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    refresh();
  }, [activeConversationId]);

  useEffect(() => {
    let cancelled = false;
    const refreshRuntime = (): void => {
      void api.agents
        .runtimeSnapshot()
        .then((snapshot) => {
          if (cancelled) return;
          const next = getRunningConversationIds(snapshot.runtimeRuns);
          setRunningConversationIds((current) => {
            if (current.size === next.size && [...next].every((id) => current.has(id))) {
              return current;
            }
            return next;
          });
        })
        .catch((error) => {
          if (!cancelled) console.error("[app-shell] failed to refresh runtime state:", error);
        });
    };

    refreshRuntime();
    const intervalId = window.setInterval(refreshRuntime, 1_200);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  // 鐩戝惉鑷姩/鎵嬪姩閲嶅懡鍚嶏細浼樺厛鐢ㄤ簨浠舵惡甯︾�?title 鐩存帴鏇存柊鏈�?state�?
  // 鑻ユ病鏈?title锛堜緥濡傛潵鑷叾浠栨笭閬擄級锛屽垯闄嶇骇涓哄叏�?refresh�?
  useEffect(() => {
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent<{ id: string; title?: string }>).detail;
      if (detail?.id && typeof detail.title === "string" && detail.title.length > 0) {
        setConversations((prev) =>
          prev.map((c) => (c.id === detail.id ? { ...c, title: detail.title as string } : c)),
        );
      } else {
        refresh();
      }
    };
    window.addEventListener("ayaka:conversation-renamed", handler);
    return () => window.removeEventListener("ayaka:conversation-renamed", handler);
  }, []);

  const confirmDeleteConversation = (): void => {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    void notify
      .promise(
        api.conversations.delete(id),
        {
          loading: t("toast.conversation.deleting"),
          success: t("toast.conversation.deleted"),
          error: t("toast.conversation.deleteFailed"),
        },
        locale,
      )
      .then(() => {
        refresh();
        onDeleteConversation(id);
      })
      .catch(() => undefined);
    setPendingDelete(null);
  };

  /**
   * 杩囨�?+ 鍒嗙粍锛堟寜 updated_at 鍊掑簭锛?
   *
   * 鍒嗙粍绛栫暐�?
   *  - 浠婂ぉ锛歶pdated_at 涓庝粖澶╁湪鍚屼竴澶?
   *  - 鏄ㄥぉ锛氱浉�?1 澶╀笖璺ㄦ棩
   *  - 鏈懆锛? 澶╁�?   *  - 鏇存棭锛氬叾�?
   */
  const groupedConversations = useMemo<Array<{ label: string; items: Conversation[] }>>(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = q
      ? conversations.filter((c) => c.title.toLowerCase().includes(q))
      : conversations;
    if (filtered.length === 0) return [];

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const oneDay = 24 * 60 * 60 * 1000;
    const startOfYesterday = startOfToday - oneDay;
    const startOfWeek = startOfToday - 7 * oneDay;

    const groups: Record<string, Conversation[]> = {};
    const labelFor = (ts: number): string => {
      if (ts >= startOfToday) return t("shell.group.today");
      if (ts >= startOfYesterday) return t("shell.group.yesterday");
      if (ts >= startOfWeek) return t("shell.group.thisWeek");
      return t("shell.group.earlier");
    };
    for (const c of filtered) {
      const ts = c.updated_at ?? c.created_at ?? 0;
      const label = labelFor(ts);
      (groups[label] ??= []).push(c);
    }

    // 鍥哄畾鍒嗙粍椤哄簭锛氫粖澶╀笌鏄ㄥぉ涓庡悓鍚屼竴澶╀笌鏈懆涓庡叾浠?
    const order = [
      t("shell.group.today"),
      t("shell.group.yesterday"),
      t("shell.group.thisWeek"),
      t("shell.group.earlier"),
    ];
    return order
      .filter((label) => groups[label]?.length)
      .map((label) => ({ label, items: groups[label] }));
  }, [conversations, searchQuery, t]);

  return (
    <div
      data-slot="app-shell"
      className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground"
    >
      <WindowTitleBar
        sidebarExpanded={sidebarExpanded}
        onToggleSidebar={() => setSidebarExpanded((expanded) => !expanded)}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <motion.aside
          initial={false}
          animate={{
            width: sidebarExpanded ? 280 : 0,
            opacity: sidebarExpanded ? 1 : 0,
          }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : {
                  type: "spring",
                  stiffness: 320,
                  damping: 34,
                  mass: 0.8,
                  opacity: { duration: 0.18, ease: "easeOut" },
                }
          }
          className="app-sidebar shrink-0 overflow-hidden bg-sidebar"
          aria-hidden={!sidebarExpanded}
          inert={!sidebarExpanded}
        >
          <div className="flex h-full w-[280px] flex-col border-r border-sidebar-border">
            <nav
              data-slot="sidebar-primary-nav"
              className="flex select-none flex-col gap-1 px-2 py-3"
              aria-label={t("shell.nav.primary")}
            >
              {primaryNav.map(({ id, labelKey, Icon }) => {
                const active = activeView === id;
                const label = t(labelKey);
                return (
                  <motion.button
                    key={id}
                    type="button"
                    whileTap={{ scale: 0.96 }}
                    transition={{ type: "tween", duration: 0.1, ease: "easeOut" }}
                    className={[
                      "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    ].join(" ")}
                    onClick={() => onSelectView(id)}
                    aria-current={active ? "page" : undefined}
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="truncate">{label}</span>
                  </motion.button>
                );
              })}
            </nav>

            <div
              data-slot="sidebar-conversations"
              className="flex min-h-0 flex-1 flex-col border-t border-sidebar-border"
            >
              <div className="flex items-center justify-between gap-2 px-3 py-3">
                <span className="select-none text-xs font-medium text-sidebar-foreground/60">
                  {t("shell.conversations")}
                </span>
                <Button
                  isIconOnly
                  size="sm"
                  variant="tertiary"
                  onPress={onCreateConversation}
                  aria-label={t("shell.newConversation")}
                >
                  <IconPlus className="size-4" />
                </Button>
              </div>

              {/* 创意：搜索框（仅在会话时显示�?*/}
              {conversations.length > 0 && (
                <div className="relative px-3 pb-2">
                  <div className="relative">
                    <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-foreground/40" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.currentTarget.value)}
                      placeholder={t("shell.searchPlaceholder")}
                      aria-label={t("shell.searchPlaceholder")}
                      className="h-8 w-full rounded-md border border-input bg-background px-3 pl-7 pr-7 text-xs text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        data-icon-only="true"
                        data-icon-tone="neutral"
                        onClick={() => setSearchQuery("")}
                        aria-label={t("common.close")}
                        className="absolute right-1.5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-foreground/40 transition hover:text-foreground"
                      >
                        <IconClose className="size-3" />
                      </button>
                    )}
                  </div>
                </div>
              )}

              <nav
                data-slot="conversation-list"
                className="min-h-0 flex-1 select-none overflow-y-auto px-2 pb-2"
                aria-label={t("shell.nav.conversations")}
              >
                {groupedConversations.length === 0 ? (
                  <p className="whitespace-pre-line px-3 py-8 text-center text-sm text-muted-foreground">
                    {searchQuery ? t("shell.noSearchResult") : t("shell.noConversation")}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-3">
                    {groupedConversations.map((group) => (
                      <li key={group.label}>
                        <p className="select-none px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-foreground/35">
                          {group.label}
                        </p>
                        <ul className="flex flex-col gap-0.5">
                          {group.items.map((conv) => {
                            const isActive =
                              conv.id === activeConversationId && activeView === "chat";
                            return (
                              <li key={conv.id}>
                                <motion.div
                                  whileTap={{ scale: 0.97 }}
                                  transition={{ type: "tween", duration: 0.1, ease: "easeOut" }}
                                  className={[
                                    "group/conv flex cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 text-sm transition",
                                    isActive
                                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                                      : "hover:bg-sidebar-accent",
                                  ].join(" ")}
                                  onClick={() => {
                                    onSelectConversation(conv.id);
                                    onSelectView("chat");
                                  }}
                                >
                                  {runningConversationIds.has(conv.id) ? (
                                    <img
                                      src={runningConversationIconUrl}
                                      alt=""
                                      aria-hidden="true"
                                      data-slot="conversation-running-icon"
                                      className="size-3.5 shrink-0 object-contain"
                                    />
                                  ) : (
                                    <IconMessage className="size-3.5 shrink-0 opacity-60" />
                                  )}
                                  <span className="flex-1 truncate text-xs">{conv.title}</span>
                                  <button
                                    type="button"
                                    data-icon-only="true"
                                    data-icon-tone="danger"
                                    className="opacity-0 transition group-hover/conv:opacity-100 hover:text-danger"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setPendingDelete(conv);
                                    }}
                                    aria-label={`${t("common.delete")} ${conv.title}`}
                                  >
                                    <IconTrash className="size-3" />
                                  </button>
                                </motion.div>
                              </li>
                            );
                          })}
                        </ul>
                      </li>
                    ))}
                  </ul>
                )}
              </nav>
            </div>

            <div className="border-t border-sidebar-border p-2">
              <Button
                variant="ghost"
                className="w-full justify-start gap-2"
                onPress={onOpenSettings}
              >
                <IconSettings className="size-4" />
                {t("shell.settings")}
              </Button>
            </div>
          </div>
        </motion.aside>

        <main data-slot="app-main" className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {children}
        </main>
      </div>

      <ConfirmDialog
        open={!!pendingDelete}
        title={t("conversation.delete.title")}
        message={t("conversation.delete.confirm", { title: pendingDelete?.title ?? "" })}
        danger
        confirmLabel={t("common.delete")}
        onConfirm={confirmDeleteConversation}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}
