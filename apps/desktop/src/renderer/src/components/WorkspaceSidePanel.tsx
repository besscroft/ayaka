import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { SettingKey } from "@shared/types";
import { useT } from "../lib/i18n";
import { api } from "../lib/api";
import {
  AgentStatusContent,
  resolveAgentPanelStatus,
  selectLatestConversationRun,
  type AgentStatusWidgetProps,
} from "./AgentStatusWidget";
import { GeneratedAppPane, type GeneratedAppSummary } from "./GeneratedAppPane";
import { BrowserPane } from "./BrowserPane";
import { Button } from "./ui";
import { IconBrain, IconEye, IconGlobe, IconPanelRightClose } from "./icons";

export type WorkspaceSidePanelTab = "runtime" | "generated-app" | "browser";

const OPEN_WORKSPACE_PANEL_EVENT = "ayaka:open-workspace-panel";
const OPEN_GENERATED_APP_EVENT = "ayaka:open-generated-app";
const DEFAULT_WORKSPACE_PANEL_WIDTH = 460;
const MIN_WORKSPACE_PANEL_WIDTH = 320;
const MAX_WORKSPACE_PANEL_WIDTH = 760;
type WorkspacePanelLayout = { open: boolean; width: number };
type WorkspacePanelOpenRequest = {
  tab?: WorkspaceSidePanelTab;
  artifactId?: string;
  automatic?: boolean;
};
const WORKSPACE_PANEL_LAYOUTS = new Map<string, WorkspacePanelLayout>();
const WORKSPACE_PANEL_LAYOUT_OVERRIDES = new Map<string, Partial<WorkspacePanelLayout>>();
let workspacePanelLayoutsLoaded = false;
let workspacePanelLayoutsLoadPromise: Promise<void> | null = null;
let workspacePanelLayoutsSavePromise = Promise.resolve();

function normalizeWorkspacePanelWidth(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_WORKSPACE_PANEL_WIDTH;
  }
  return Math.min(MAX_WORKSPACE_PANEL_WIDTH, Math.max(MIN_WORKSPACE_PANEL_WIDTH, value));
}

function getWorkspacePanelLayout(conversationId: string): WorkspacePanelLayout {
  return (
    WORKSPACE_PANEL_LAYOUTS.get(conversationId) ?? {
      open: false,
      width: DEFAULT_WORKSPACE_PANEL_WIDTH,
    }
  );
}

function applyWorkspacePanelLayout(
  conversationId: string,
  setOpen: (open: boolean) => void,
  setWidth: (width: number) => void,
): void {
  const layout = getWorkspacePanelLayout(conversationId);
  setOpen(layout.open);
  setWidth(layout.width);
}

function applyWorkspacePanelLayoutOverrides(): void {
  for (const [conversationId, patch] of WORKSPACE_PANEL_LAYOUT_OVERRIDES) {
    const current = getWorkspacePanelLayout(conversationId);
    WORKSPACE_PANEL_LAYOUTS.set(conversationId, {
      ...current,
      ...patch,
      width: normalizeWorkspacePanelWidth(patch.width ?? current.width),
    });
  }
  WORKSPACE_PANEL_LAYOUT_OVERRIDES.clear();
}

function loadWorkspacePanelLayouts(): Promise<void> {
  if (workspacePanelLayoutsLoaded) return Promise.resolve();
  if (workspacePanelLayoutsLoadPromise) return workspacePanelLayoutsLoadPromise;

  workspacePanelLayoutsLoadPromise = api.settings
    .get(SettingKey.WorkspacePanelLayouts)
    .then((raw) => {
      if (raw) {
        try {
          const parsed: unknown = JSON.parse(raw);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            for (const [conversationId, value] of Object.entries(parsed)) {
              const layout = value as Record<string, unknown>;
              if (
                value &&
                typeof value === "object" &&
                !Array.isArray(value) &&
                typeof layout.open === "boolean"
              ) {
                WORKSPACE_PANEL_LAYOUTS.set(conversationId, {
                  open: layout.open,
                  width: normalizeWorkspacePanelWidth(layout.width),
                });
              }
            }
          }
        } catch (error) {
          console.warn("[workspace-panel] failed to parse saved layouts:", error);
        }
      }
      applyWorkspacePanelLayoutOverrides();
      workspacePanelLayoutsLoaded = true;
    })
    .catch((error) => {
      // 即使设置读取失败，也不能丢掉加载期间用户已经操作的会话布局。
      applyWorkspacePanelLayoutOverrides();
      workspacePanelLayoutsLoaded = true;
      console.warn("[workspace-panel] failed to load saved layouts:", error);
    })
    .finally(() => {
      workspacePanelLayoutsLoadPromise = null;
    });

  return workspacePanelLayoutsLoadPromise;
}

function updateWorkspacePanelLayout(
  conversationId: string,
  patch: Partial<WorkspacePanelLayout>,
): void {
  const current = getWorkspacePanelLayout(conversationId);
  WORKSPACE_PANEL_LAYOUTS.set(conversationId, {
    ...current,
    ...patch,
    width: normalizeWorkspacePanelWidth(patch.width ?? current.width),
  });
  if (!workspacePanelLayoutsLoaded) {
    const override = WORKSPACE_PANEL_LAYOUT_OVERRIDES.get(conversationId) ?? {};
    WORKSPACE_PANEL_LAYOUT_OVERRIDES.set(conversationId, {
      ...override,
      ...patch,
      ...(patch.width === undefined ? {} : { width: normalizeWorkspacePanelWidth(patch.width) }),
    });
  }
}

function persistWorkspacePanelLayouts(): void {
  workspacePanelLayoutsSavePromise = workspacePanelLayoutsSavePromise
    .then(async () => {
      await loadWorkspacePanelLayouts();
      await api.settings.set(
        SettingKey.WorkspacePanelLayouts,
        JSON.stringify(Object.fromEntries(WORKSPACE_PANEL_LAYOUTS)),
      );
    })
    .catch((error) => {
      console.warn("[workspace-panel] failed to save layouts:", error);
    });
}

const WORKSPACE_PANEL_TRANSITION = {
  type: "spring",
  stiffness: 320,
  damping: 34,
  mass: 0.8,
  opacity: { duration: 0.18, ease: "easeOut" },
} as const;

export function getWorkspaceSidePanelAnimation(
  open: boolean,
  width: number,
): { width: number; opacity: number } {
  return { width: open ? width : 0, opacity: open ? 1 : 0 };
}

export function getWorkspaceSidePanelTransition(reduceMotion: boolean | null, isResizing: boolean) {
  return reduceMotion || isResizing ? { duration: 0 } : WORKSPACE_PANEL_TRANSITION;
}

export function openWorkspaceSidePanel(
  tab: WorkspaceSidePanelTab,
  artifactId?: string,
  options?: { automatic?: boolean },
): void {
  window.dispatchEvent(
    new CustomEvent(OPEN_WORKSPACE_PANEL_EVENT, {
      detail: { tab, artifactId, automatic: options?.automatic === true },
    }),
  );
}

type RuntimePanelProps = Omit<AgentStatusWidgetProps, "open" | "onOpenChange" | "embedded">;

export interface WorkspaceSidePanelProps extends RuntimePanelProps {
  conversationId: string;
}

export function WorkspaceSidePanel({
  conversationId,
  snapshot,
  profiles,
  providers,
  selectedModel,
  reasoningLevel,
  toolSelection,
  tools,
  chatStatus,
  isChatActive,
  onStop,
}: WorkspaceSidePanelProps): React.JSX.Element {
  const { t } = useT();
  const reduceMotion = useReducedMotion();
  const initialLayout = getWorkspacePanelLayout(conversationId);
  const [open, setOpen] = useState(initialLayout.open);
  const [isResizing, setIsResizing] = useState(false);
  const [activeTab, setActiveTab] = useState<WorkspaceSidePanelTab>("runtime");
  const [requestedArtifactId, setRequestedArtifactId] = useState<string | null>(null);
  const [generatedSummary, setGeneratedSummary] = useState<GeneratedAppSummary>({
    artifactCount: 0,
    runningPreviews: 0,
    failedPreviews: 0,
  });
  const [width, setWidth] = useState(initialLayout.width);
  const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const resizeHandleRef = useRef<HTMLDivElement>(null);
  const tabIds = {
    runtime: `${conversationId}-workspace-runtime-tab`,
    generatedApp: `${conversationId}-workspace-generated-app-tab`,
    browser: `${conversationId}-workspace-browser-tab`,
  };
  const panelIds = {
    runtime: `${conversationId}-workspace-runtime-panel`,
    generatedApp: `${conversationId}-workspace-generated-app-panel`,
    browser: `${conversationId}-workspace-browser-panel`,
  };

  useLayoutEffect(() => {
    // ChatView 会复用组件实例；在绘制前切换到当前会话的内存布局，避免短暂沿用上个会话。
    applyWorkspacePanelLayout(conversationId, setOpen, setWidth);
    setActiveTab("runtime");
    setRequestedArtifactId(null);
  }, [conversationId]);

  useEffect(() => {
    let cancelled = false;
    void loadWorkspacePanelLayouts().then(() => {
      if (cancelled) return;
      applyWorkspacePanelLayout(conversationId, setOpen, setWidth);
    });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  useEffect(() => {
    let cancelled = false;
    const openPanel = (detail: WorkspacePanelOpenRequest): void => {
      const tab = detail.tab ?? "generated-app";
      setActiveTab(tab);
      if (detail.artifactId) setRequestedArtifactId(detail.artifactId);
      setOpen(true);
      updateWorkspacePanelLayout(conversationId, { open: true });
      persistWorkspacePanelLayouts();
    };
    const handle = (event: Event): void => {
      const detail = (event as CustomEvent<WorkspacePanelOpenRequest>).detail ?? {};
      if (!detail.automatic) {
        openPanel(detail);
        return;
      }

      // 自动发现历史工件时，只对从未保存过布局的会话打开面板；用户明确折叠后必须尊重该选择。
      void loadWorkspacePanelLayouts().then(() => {
        if (cancelled) return;
        const savedLayout = WORKSPACE_PANEL_LAYOUTS.get(conversationId);
        if (savedLayout && !savedLayout.open) return;
        openPanel(detail);
      });
    };
    window.addEventListener(OPEN_WORKSPACE_PANEL_EVENT, handle);
    window.addEventListener(OPEN_GENERATED_APP_EVENT, handle);
    return () => {
      cancelled = true;
      window.removeEventListener(OPEN_WORKSPACE_PANEL_EVENT, handle);
      window.removeEventListener(OPEN_GENERATED_APP_EVENT, handle);
    };
  }, [conversationId]);

  useEffect(() => {
    const handle = (event: PointerEvent): void => {
      const drag = dragRef.current;
      if (!drag) return;
      const nextWidth = Math.min(
        MAX_WORKSPACE_PANEL_WIDTH,
        Math.max(MIN_WORKSPACE_PANEL_WIDTH, drag.startWidth + drag.startX - event.clientX),
      );
      setWidth(nextWidth);
      updateWorkspacePanelLayout(conversationId, { width: nextWidth });
    };
    const stop = (): void => {
      const drag = dragRef.current;
      if (drag) persistWorkspacePanelLayouts();
      if (drag && resizeHandleRef.current?.hasPointerCapture(drag.pointerId)) {
        resizeHandleRef.current.releasePointerCapture(drag.pointerId);
      }
      dragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setIsResizing(false);
    };
    window.addEventListener("pointermove", handle);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointermove", handle);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [conversationId]);

  const runtimeStatus = useMemo(() => {
    const run = selectLatestConversationRun(snapshot?.runtimeRuns ?? [], conversationId);
    const conversationState = snapshot?.conversationAgentStates.find(
      (state) => state.conversation_id === conversationId,
    );
    return resolveAgentPanelStatus({
      chatStatus,
      isChatActive,
      runStatus: run?.status,
      conversationStatus: conversationState?.status,
    });
  }, [chatStatus, conversationId, isChatActive, snapshot]);

  const handleGeneratedSummary = useCallback((summary: GeneratedAppSummary): void => {
    setGeneratedSummary(summary);
  }, []);

  const runtimeAttention = [
    "running",
    "waiting_approval",
    "waiting_handoff",
    "failed",
    "blocked",
  ].includes(runtimeStatus);
  const generatedAttention =
    generatedSummary.runningPreviews > 0 || generatedSummary.failedPreviews > 0;

  return (
    <motion.aside
      data-slot="workspace-side-panel"
      className="relative min-w-0 shrink-0 overflow-hidden border-l border-border bg-background shadow-lg will-change-[width]"
      initial={false}
      animate={getWorkspaceSidePanelAnimation(open, width)}
      transition={getWorkspaceSidePanelTransition(reduceMotion, isResizing)}
      aria-hidden={!open}
      inert={!open}
      aria-label={t("workspacePanel.title")}
    >
      <div
        ref={resizeHandleRef}
        role="separator"
        aria-orientation="vertical"
        aria-label={t("workspacePanel.resize")}
        className="absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          setIsResizing(true);
          dragRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startWidth: width,
          };
          updateWorkspacePanelLayout(conversationId, { width });
          document.body.style.cursor = "col-resize";
          document.body.style.userSelect = "none";
        }}
      />

      <div className="flex h-full min-w-0 flex-col">
        <header className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
          <div
            data-slot="tabs-list"
            className="inline-flex w-fit shrink-0 items-center gap-1 p-[3px]"
            role="tablist"
            aria-label={t("workspacePanel.tabs")}
          >
            <TabButton
              id={tabIds.runtime}
              panelId={panelIds.runtime}
              active={activeTab === "runtime"}
              icon={<IconBrain className="size-3.5" />}
              label={t("workspacePanel.runtime")}
              badge={runtimeAttention ? "!" : undefined}
              onClick={() => setActiveTab("runtime")}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight" || event.key === "End") {
                  event.preventDefault();
                  setActiveTab("generated-app");
                } else if (event.key === "ArrowLeft" || event.key === "Home") {
                  event.preventDefault();
                  setActiveTab("runtime");
                }
              }}
            />
            <TabButton
              id={tabIds.generatedApp}
              panelId={panelIds.generatedApp}
              active={activeTab === "generated-app"}
              icon={<IconEye className="size-3.5" />}
              label={t("workspacePanel.generatedApp")}
              badge={
                generatedAttention ? String(generatedSummary.runningPreviews || "!") : undefined
              }
              onClick={() => setActiveTab("generated-app")}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft" || event.key === "Home") {
                  event.preventDefault();
                  setActiveTab("runtime");
                } else if (event.key === "ArrowRight" || event.key === "End") {
                  event.preventDefault();
                  setActiveTab("browser");
                }
              }}
            />
            <TabButton
              id={tabIds.browser}
              panelId={panelIds.browser}
              active={activeTab === "browser"}
              icon={<IconGlobe className="size-3.5" />}
              label={t("workspacePanel.browser")}
              onClick={() => setActiveTab("browser")}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft" || event.key === "Home") {
                  event.preventDefault();
                  setActiveTab("generated-app");
                } else if (event.key === "ArrowRight" || event.key === "End") {
                  event.preventDefault();
                  setActiveTab("runtime");
                }
              }}
            />
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("workspacePanel.close")}
            title={t("workspacePanel.close")}
            onPress={() => {
              setOpen(false);
              updateWorkspacePanelLayout(conversationId, { open: false });
              persistWorkspacePanelLayouts();
            }}
          >
            <IconPanelRightClose className="size-4" />
          </Button>
        </header>

        <div className="min-h-0 flex-1">
          <section
            id={panelIds.runtime}
            role="tabpanel"
            aria-labelledby={tabIds.runtime}
            aria-hidden={activeTab !== "runtime"}
            hidden={activeTab !== "runtime"}
            className="h-full min-h-0"
          >
            <AgentStatusContent
              conversationId={conversationId}
              snapshot={snapshot}
              profiles={profiles}
              providers={providers}
              selectedModel={selectedModel}
              reasoningLevel={reasoningLevel}
              toolSelection={toolSelection}
              tools={tools}
              chatStatus={chatStatus}
              isChatActive={isChatActive}
              onStop={onStop}
            />
          </section>
          <section
            id={panelIds.generatedApp}
            role="tabpanel"
            aria-labelledby={tabIds.generatedApp}
            aria-hidden={activeTab !== "generated-app"}
            hidden={activeTab !== "generated-app"}
            className="flex h-full min-h-0 flex-col"
          >
            <GeneratedAppPane
              conversationId={conversationId}
              visible={open && activeTab === "generated-app"}
              requestedArtifactId={requestedArtifactId}
              onRequestOpen={(artifactId) => {
                if (artifactId) setRequestedArtifactId(artifactId);
                setActiveTab("generated-app");
                setOpen(true);
                updateWorkspacePanelLayout(conversationId, { open: true });
                persistWorkspacePanelLayouts();
              }}
              onSummaryChange={handleGeneratedSummary}
            />
          </section>
          <section
            id={panelIds.browser}
            role="tabpanel"
            aria-labelledby={tabIds.browser}
            aria-hidden={activeTab !== "browser"}
            hidden={activeTab !== "browser"}
            className="flex h-full min-h-0 flex-col"
          >
            <BrowserPane
              key={conversationId}
              conversationId={conversationId}
              visible={open && activeTab === "browser"}
            />
          </section>
        </div>
      </div>
    </motion.aside>
  );
}

function TabButton({
  id,
  panelId,
  active,
  icon,
  label,
  badge,
  onClick,
  onKeyDown,
}: {
  id: string;
  panelId: string;
  active: boolean;
  icon: React.ReactNode;
  label: string;
  badge?: string;
  onClick: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
}): React.JSX.Element {
  return (
    <button
      data-slot="tabs-trigger"
      data-active={active ? "" : undefined}
      type="button"
      id={id}
      role="tab"
      aria-selected={active}
      aria-controls={panelId}
      tabIndex={active ? 0 : -1}
      className={`relative inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
        active
          ? "bg-accent/15 text-foreground"
          : "text-foreground/55 hover:bg-muted hover:text-foreground"
      }`}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      {icon}
      <span>{label}</span>
      {badge ? (
        <span
          className="rounded-full bg-warning/15 px-1.5 text-[10px] tabular-nums text-warning"
          aria-label={badge}
        >
          {badge}
        </span>
      ) : null}
    </button>
  );
}
