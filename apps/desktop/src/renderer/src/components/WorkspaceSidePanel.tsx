import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { useT } from "../lib/i18n";
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
const WIDTH_BY_CONVERSATION = new Map<string, number>();
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

export function openWorkspaceSidePanel(tab: WorkspaceSidePanelTab, artifactId?: string): void {
  window.dispatchEvent(
    new CustomEvent(OPEN_WORKSPACE_PANEL_EVENT, {
      detail: { tab, artifactId },
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
  const [open, setOpen] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [activeTab, setActiveTab] = useState<WorkspaceSidePanelTab>("runtime");
  const [requestedArtifactId, setRequestedArtifactId] = useState<string | null>(null);
  const [generatedSummary, setGeneratedSummary] = useState<GeneratedAppSummary>({
    artifactCount: 0,
    runningPreviews: 0,
    failedPreviews: 0,
  });
  const [width, setWidth] = useState(() => WIDTH_BY_CONVERSATION.get(conversationId) ?? 460);
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

  useEffect(() => {
    setWidth(WIDTH_BY_CONVERSATION.get(conversationId) ?? 460);
    setOpen(false);
    setActiveTab("runtime");
    setRequestedArtifactId(null);
  }, [conversationId]);

  useEffect(() => {
    const handle = (event: Event): void => {
      const detail = (event as CustomEvent<{ tab?: WorkspaceSidePanelTab; artifactId?: string }>)
        .detail;
      const tab = detail?.tab ?? "generated-app";
      setActiveTab(tab);
      if (detail?.artifactId) setRequestedArtifactId(detail.artifactId);
      setOpen(true);
    };
    window.addEventListener(OPEN_WORKSPACE_PANEL_EVENT, handle);
    window.addEventListener(OPEN_GENERATED_APP_EVENT, handle);
    return () => {
      window.removeEventListener(OPEN_WORKSPACE_PANEL_EVENT, handle);
      window.removeEventListener(OPEN_GENERATED_APP_EVENT, handle);
    };
  }, []);

  useEffect(() => {
    const handle = (event: PointerEvent): void => {
      const drag = dragRef.current;
      if (!drag) return;
      const nextWidth = Math.min(760, Math.max(320, drag.startWidth + drag.startX - event.clientX));
      setWidth(nextWidth);
      WIDTH_BY_CONVERSATION.set(conversationId, nextWidth);
    };
    const stop = (): void => {
      const drag = dragRef.current;
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
            onPress={() => setOpen(false)}
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
