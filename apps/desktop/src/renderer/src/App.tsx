import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { AppShell, type AppView } from "./components/AppShell";
import { ChatView } from "./components/ChatView";
import { SettingsDialog, type SettingsTabId } from "./components/SettingsDialog";
import { MainPanelView } from "./components/MainPanelView";
import { api } from "./lib/api";
import { handleTrayAction } from "./lib/tray-actions";
import { SettingsProvider, useSettings } from "./lib/settings";
import { AppI18nProvider, useT } from "./lib/i18n";
import { SettingKey, type LocalServerInfo, type UpdateState } from "@shared/types";
import { Toaster, toast } from "sonner";
import { MotionConfig } from "motion/react";
import { chatSessionRegistry } from "./lib/chat-session-registry";

const ORIGINAL_TOASTER_ID = "original";
const ORIGINAL_TOAST_CLASS = "ayaka-original-toast";
const ORIGINAL_TOASTER_CLASS = "ayaka-original-toaster";

function App(): React.JSX.Element {
  return (
    <AppProviders>
      <AppContent />
    </AppProviders>
  );
}

export function AppProviders({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <SettingsProvider>
      <AppRoot>{children}</AppRoot>
    </SettingsProvider>
  );
}

function AppRoot({ children }: { children: ReactNode }): React.JSX.Element {
  const { resolvedLanguage, settings } = useSettings();
  const reducedMotion =
    settings.reduceMotion === "on" ? "always" : settings.reduceMotion === "off" ? "never" : "user";
  return (
    <AppI18nProvider locale={resolvedLanguage}>
      <MotionConfig reducedMotion={reducedMotion}>{children}</MotionConfig>
    </AppI18nProvider>
  );
}

function AppContent(): React.JSX.Element {
  const { t } = useT();
  const { resolvedLanguage, settings } = useSettings();
  const isZzzSkin = settings.skin === "zzz";
  const [activeId, setActiveId] = useState<string | null>(null);
  const [newConversationId, setNewConversationId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<AppView>("chat");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTabId>("appearance");
  const announcedUpdateVersion = useRef<string | null>(null);
  // 服务端口：useChat 必须在首次渲染就拿到正确 transport。
  // 因此端口就绪前不挂载 ChatView。
  const [serverInfo, setServerInfo] = useState<LocalServerInfo | null>(null);

  const createNewConversation = useCallback(async (): Promise<void> => {
    const id = crypto.randomUUID();
    setActiveId(id);
    setNewConversationId(id);
    setActiveView("chat");
    await api.settings.set(SettingKey.ActiveConversationId, id);
  }, [t]);

  useEffect(() => {
    void api.tray.setLabels({
      settings: t("tray.settings"),
      openHome: t("tray.open"),
      chat: t("tray.chat"),
      quit: t("tray.quit"),
    });
  }, [resolvedLanguage, t]);

  useEffect(() => {
    const offTrayAction = api.tray.onAction((action) => {
      handleTrayAction(action, {
        openSettings: () => {
          setSettingsInitialTab("appearance");
          setSettingsOpen(true);
        },
        openHome: () => {
          setSettingsOpen(false);
          setActiveView("chat");
        },
        newChat: () => void createNewConversation(),
      });
    });
    return offTrayAction;
  }, [createNewConversation]);

  useEffect(() => {
    // 提早拉取本地服务端口，避免 ChatView 内部 useEffect 抢跑。
    void api.server.info().then(setServerInfo);
  }, []);

  useEffect(() => {
    const announceUpdate = (state: UpdateState): void => {
      if (
        state.status !== "available" ||
        !state.availableVersion ||
        announcedUpdateVersion.current === state.availableVersion
      ) {
        return;
      }
      announcedUpdateVersion.current = state.availableVersion;
      toast.info(t("about.update.toast", { version: state.availableVersion }), {
        toasterId: ORIGINAL_TOASTER_ID,
        className: ORIGINAL_TOAST_CLASS,
        duration: 6_000,
        action: {
          label: t("about.update.open"),
          onClick: () => {
            setSettingsInitialTab("about");
            setSettingsOpen(true);
          },
        },
      });
    };
    const offUpdates = api.updates.onStateChanged(announceUpdate);
    void api.updates.getState().then(announceUpdate, () => undefined);
    return offUpdates;
  }, [t]);

  useEffect(() => {
    void (async () => {
      const last = await api.settings.get(SettingKey.ActiveConversationId);
      if (last) {
        setActiveId(last);
        return;
      }
      const list = await api.conversations.list();
      if (list.length > 0) {
        setActiveId(list[0].id);
        return;
      }
      void createNewConversation();
    })();
  }, [createNewConversation]);

  const handleSelect = useCallback((id: string): void => {
    setActiveId(id);
    setNewConversationId(null);
    void api.settings.set(SettingKey.ActiveConversationId, id);
  }, []);

  const handleSelectView = useCallback((view: AppView): void => {
    setActiveView(view);
  }, []);

  const handleDelete = useCallback(
    (id: string): void => {
      chatSessionRegistry.delete(id);
      setActiveId((current) => {
        if (current === id) {
          void api.conversations.list().then((list) => {
            const next = list.find((c) => c.id !== id);
            if (next) {
              setActiveId(next.id);
              void api.settings.set(SettingKey.ActiveConversationId, next.id);
            } else {
              void createNewConversation();
            }
          });
        }
        return current;
      });
    },
    [createNewConversation],
  );

  useEffect(() => {
    const handleOpenConversation = (event: Event): void => {
      const conversationId = (event as CustomEvent<{ conversationId?: string }>).detail
        ?.conversationId;
      if (!conversationId) return;
      setActiveId(conversationId);
      setNewConversationId(null);
      setActiveView("chat");
      void api.settings.set(SettingKey.ActiveConversationId, conversationId);
    };
    window.addEventListener("ayaka:open-conversation", handleOpenConversation);
    return () => window.removeEventListener("ayaka:open-conversation", handleOpenConversation);
  }, []);

  useEffect(() => {
    const handleConversationCreated = (event: Event): void => {
      const id = (event as CustomEvent<{ id?: string }>).detail?.id;
      if (id && id === newConversationId) setNewConversationId(null);
    };
    window.addEventListener("ayaka:conversation-created", handleConversationCreated);
    return () =>
      window.removeEventListener("ayaka:conversation-created", handleConversationCreated);
  }, [newConversationId]);

  return (
    <>
      <AppShell
        activeView={activeView}
        activeConversationId={activeId}
        onSelectView={handleSelectView}
        onSelectConversation={handleSelect}
        onCreateConversation={() => void createNewConversation()}
        onDeleteConversation={handleDelete}
        onOpenSettings={() => {
          setSettingsInitialTab("appearance");
          setSettingsOpen(true);
        }}
      >
        <div
          className={activeView === "chat" ? "flex min-h-0 flex-1" : "hidden"}
          aria-hidden={activeView !== "chat"}
        >
          {activeId && serverInfo !== null ? (
            <ChatView
              key={activeId}
              conversationId={activeId}
              serverInfo={serverInfo}
              isNewConversation={newConversationId === activeId}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-foreground/40">
              {t("chat.initializing")}
            </div>
          )}
        </div>
        {activeView !== "chat" ? (
          <MainPanelView section={activeView} activeConversationId={activeId} />
        ) : null}
      </AppShell>

      <SettingsDialog
        open={settingsOpen}
        initialTab={settingsInitialTab}
        onClose={() => setSettingsOpen(false)}
      />
      <Toaster
        richColors
        closeButton
        position={isZzzSkin ? "top-center" : "top-right"}
        duration={isZzzSkin ? 1500 : 1000}
        visibleToasts={isZzzSkin ? 1 : 3}
      />
      <Toaster
        id={ORIGINAL_TOASTER_ID}
        richColors
        closeButton
        position="top-right"
        duration={1000}
        visibleToasts={3}
        className={ORIGINAL_TOASTER_CLASS}
      />
    </>
  );
}

export default App;
