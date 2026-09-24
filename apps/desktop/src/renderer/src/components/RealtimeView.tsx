import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { experimental_useRealtime } from "@ai-sdk/react";
import type { Experimental_RealtimeSessionConfig } from "ai";
import type {
  LocalServerInfo,
  ProviderInfo,
  RealtimeSessionMessage,
  RealtimeSessionRecord,
} from "@shared/types";
import { Button, SelectField } from "./ui";
import { api } from "../lib/api";
import { useT } from "../lib/i18n";
import { useSettings } from "../lib/settings";
import { createRealtimeModel } from "../lib/realtime-adapters";
import { IconArrowLeft, IconMessage, IconMic, IconPlus, IconSend, IconX } from "./icons";

interface RealtimeViewProps {
  serverInfo: LocalServerInfo | null;
  onReturnToChat: () => void;
}

interface RealtimeModelOption {
  provider: ProviderInfo;
  modelId: string;
  label: string;
  ref: string;
}

interface ActiveRealtimeSession {
  id: string;
  modelRef: string;
  stream: MediaStream;
  context: RealtimeSessionMessage[];
}

export function RealtimeView({ serverInfo, onReturnToChat }: RealtimeViewProps): React.JSX.Element {
  const { t, f } = useT();
  const { settings } = useSettings();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [sessions, setSessions] = useState<RealtimeSessionRecord[]>([]);
  const [selectedModelRef, setSelectedModelRef] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<ActiveRealtimeSession | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const startInProgress = useRef(false);
  const selectedModelManually = useRef(false);

  const refreshSessions = useCallback(async (): Promise<void> => {
    try {
      setSessions(await api.realtimeSessions.list());
    } catch {
      setStartError(t("realtime.connectionError"));
    }
  }, [t]);

  useEffect(() => {
    let active = true;
    void Promise.all([api.providers.list(), api.realtimeSessions.list()])
      .then(([nextProviders, nextSessions]) => {
        if (!active) return;
        setProviders(nextProviders);
        setSessions(nextSessions);
        setSelectedModelRef((current) => {
          if (current) return current;
          const availableRefs = nextProviders.flatMap((provider) =>
            provider.realtimeEnabled && provider.hasApiKey
              ? provider.models
                  .filter(
                    (model) =>
                      model.enabled && model.hasApiKey && model.capabilities.realtime === true,
                  )
                  .map((model) => `${provider.id}/${model.id}`)
              : [],
          );
          return settings.realtimeVoiceModel && availableRefs.includes(settings.realtimeVoiceModel)
            ? settings.realtimeVoiceModel
            : (availableRefs[0] ?? "");
        });
      })
      .catch(() => {
        if (active) setStartError(t("realtime.connectionError"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [settings.realtimeVoiceModel, t]);

  const modelOptions = useMemo<RealtimeModelOption[]>(
    () =>
      providers.flatMap((provider) =>
        provider.realtimeEnabled && provider.hasApiKey
          ? provider.models
              .filter(
                (model) => model.enabled && model.hasApiKey && model.capabilities.realtime === true,
              )
              .map((model) => ({
                provider,
                modelId: model.id,
                label: `${provider.label} / ${model.label ?? model.id}`,
                ref: `${provider.id}/${model.id}`,
              }))
          : [],
      ),
    [providers],
  );

  useEffect(() => {
    if (selectedModelRef && !modelOptions.some((model) => model.ref === selectedModelRef))
      setSelectedModelRef("");
  }, [modelOptions, selectedModelRef]);

  useEffect(() => {
    if (selectedModelManually.current || modelOptions.length === 0) return;
    const preferred = modelOptions.find((model) => model.ref === settings.realtimeVoiceModel);
    setSelectedModelRef(preferred?.ref ?? modelOptions[0].ref);
  }, [modelOptions, settings.realtimeVoiceModel]);

  const selectModelForThisView = (modelRef: string): void => {
    selectedModelManually.current = true;
    setSelectedModelRef(modelRef);
  };

  const selectedModel = modelOptions.find((model) => model.ref === selectedModelRef) ?? null;
  const selectedHistory = sessions.find((session) => session.id === selectedSessionId) ?? null;

  const beginSession = useCallback(
    async (context: RealtimeSessionMessage[] = []): Promise<void> => {
      if (startInProgress.current) return;
      startInProgress.current = true;
      setStarting(true);
      setStartError(null);
      let pendingStream: MediaStream | null = null;
      try {
        if (!selectedModel || !serverInfo) {
          setStartError(t("realtime.noModels"));
          return;
        }
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch {
          setStartError(t("realtime.permissionError"));
          return;
        }
        pendingStream = stream;
        const id = crypto.randomUUID();
        await api.realtimeSessions.create({
          id,
          providerId: selectedModel.provider.id,
          modelId: selectedModel.modelId,
          title: t("realtime.defaultTitle"),
        });
        setSessions(await api.realtimeSessions.list());
        setSelectedSessionId(id);
        setActiveSession({
          id,
          modelRef: selectedModel.ref,
          stream,
          context: context.slice(-40),
        });
      } catch {
        pendingStream?.getTracks().forEach((track) => track.stop());
        setStartError(t("realtime.connectionError"));
      } finally {
        startInProgress.current = false;
        setStarting(false);
      }
    },
    [selectedModel, serverInfo, t],
  );

  const openHistory = (sessionId: string): void => {
    setActiveSession(null);
    setSelectedSessionId(sessionId);
    setStartError(null);
  };

  const finishSession = (): void => {
    const endedId = activeSession?.id;
    setActiveSession(null);
    if (endedId) setSelectedSessionId(endedId);
    void refreshSessions();
  };

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-background">
      <aside className="flex w-[250px] shrink-0 flex-col border-r border-border bg-sidebar">
        <div className="border-b border-sidebar-border px-4 pb-3 pt-4">
          <Button variant="ghost" size="sm" className="mb-4 -ml-2 gap-2" onPress={onReturnToChat}>
            <IconArrowLeft className="size-4" />
            {t("shell.nav.conversations")}
          </Button>
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-semibold text-sidebar-foreground/75">
              {t("realtime.history")}
            </div>
            <Button
              isIconOnly
              size="sm"
              variant="tertiary"
              aria-label={t("realtime.new")}
              onPress={() => {
                setActiveSession(null);
                setSelectedSessionId(null);
                setStartError(null);
              }}
            >
              <IconPlus className="size-4" />
            </Button>
          </div>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto p-2" aria-label={t("realtime.history")}>
          {sessions.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-muted-foreground">
              {loading ? t("chat.initializing") : t("realtime.emptyHistory")}
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {sessions.map((session) => (
                <li key={session.id}>
                  <button
                    type="button"
                    className={[
                      "group flex w-full items-start gap-2 rounded-md px-3 py-2 text-left transition-colors",
                      selectedSessionId === session.id
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground/75 hover:bg-sidebar-accent",
                    ].join(" ")}
                    onClick={() => openHistory(session.id)}
                  >
                    <IconMessage className="mt-0.5 size-3.5 shrink-0 opacity-60" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs">{session.title}</span>
                      <span className="mt-1 block text-[10px] text-muted-foreground">
                        {f.dateTime(session.updatedAt)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </nav>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {activeSession ? (
          <RealtimeSessionPane
            key={activeSession.id}
            activeSession={activeSession}
            model={
              modelOptions.find((model) => model.ref === activeSession.modelRef) ?? selectedModel
            }
            serverInfo={serverInfo}
            onTranscriptChanged={refreshSessions}
            onEnd={finishSession}
          />
        ) : selectedHistory ? (
          <RealtimeHistoryPane
            session={selectedHistory}
            modelOptions={modelOptions}
            selectedModelRef={selectedModelRef}
            onSelectedModelChange={selectModelForThisView}
            isStarting={starting}
            onContinue={() => void beginSession(selectedHistory.messages)}
          />
        ) : (
          <section className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center justify-between border-b border-border px-7 py-5">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  {t("realtime.history")}
                </p>
                <h1 className="mt-1 text-lg font-semibold">{t("realtime.defaultTitle")}</h1>
              </div>
              <div className="w-[260px] max-w-[45%]">
                <SelectField
                  value={selectedModelRef}
                  options={modelOptions.map((model) => ({ value: model.ref, label: model.label }))}
                  onChange={selectModelForThisView}
                  ariaLabel={t("realtime.chooseModel")}
                  placeholder={t("realtime.chooseModel")}
                />
              </div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-8">
              <div className="mb-5 grid size-20 place-items-center rounded-full bg-accent/60 text-accent-foreground ring-8 ring-accent/20">
                <IconMic className="size-8" />
              </div>
              <p className="max-w-md text-center text-sm text-muted-foreground">
                {modelOptions.length === 0 ? t("realtime.noModels") : t("realtime.connectHint")}
              </p>
              {startError ? (
                <p role="alert" className="mt-3 max-w-lg text-center text-sm text-danger">
                  {startError}
                </p>
              ) : null}
              <Button
                variant="primary"
                className="mt-6 gap-2"
                isDisabled={!selectedModel || !serverInfo || starting}
                onPress={() => void beginSession()}
              >
                <IconMic className="size-4" />
                {starting ? t("realtime.connecting") : t("realtime.connect")}
              </Button>
            </div>
          </section>
        )}
      </section>
    </div>
  );
}

function RealtimeHistoryPane({
  session,
  modelOptions,
  selectedModelRef,
  onSelectedModelChange,
  isStarting,
  onContinue,
}: {
  session: RealtimeSessionRecord;
  modelOptions: RealtimeModelOption[];
  selectedModelRef: string;
  onSelectedModelChange: (value: string) => void;
  isStarting: boolean;
  onContinue: () => void;
}): React.JSX.Element {
  const { t, f } = useT();
  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-7 py-5">
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {t("realtime.readOnly")}
          </p>
          <h1 className="mt-1 truncate text-lg font-semibold">{session.title}</h1>
          <p className="mt-1 text-xs text-muted-foreground">{f.dateTime(session.createdAt)}</p>
        </div>
        <div className="flex items-center gap-2">
          {modelOptions.length ? (
            <div className="w-[250px] max-w-[40vw]">
              <SelectField
                value={selectedModelRef}
                options={modelOptions.map((model) => ({ value: model.ref, label: model.label }))}
                onChange={onSelectedModelChange}
                ariaLabel={t("realtime.chooseModel")}
              />
            </div>
          ) : null}
          <Button
            variant="primary"
            size="sm"
            className="gap-2"
            isDisabled={!selectedModelRef || isStarting}
            onPress={onContinue}
          >
            <IconMic className="size-3.5" />
            {isStarting ? t("realtime.connecting") : t("realtime.continue")}
          </Button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-7">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
          {session.messages.map((message) => (
            <TranscriptBubble key={message.id} message={message} />
          ))}
          {session.messages.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              {t("realtime.emptyHistory")}
            </p>
          ) : null}
        </div>
      </div>
      <footer className="border-t border-border px-7 py-3 text-center text-xs text-muted-foreground">
        {t("realtime.continueHint")}
      </footer>
    </>
  );
}

function RealtimeSessionPane({
  activeSession,
  model,
  serverInfo,
  onTranscriptChanged,
  onEnd,
}: {
  activeSession: ActiveRealtimeSession;
  model: RealtimeModelOption | null;
  serverInfo: LocalServerInfo | null;
  onTranscriptChanged: () => Promise<void>;
  onEnd: () => void;
}): React.JSX.Element {
  const { t } = useT();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(activeSession.stream);
  const connectionLifecycleRef = useRef(0);
  const createdAtById = useRef(new Map<string, number>());
  const transcriptRef = useRef<RealtimeSessionMessage[]>([]);
  const modelInstance = useMemo(() => {
    return createRealtimeModel({
      descriptor: {
        transport: model?.provider.realtimeTransport ?? "websocket",
        protocol: model?.provider.realtimeProtocol ?? "openai",
        endpoint:
          model?.provider.realtimeEndpoint ??
          model?.provider.baseUrl ??
          "https://api.openai.com/v1",
      },
      modelId: model?.modelId || "gpt-realtime",
    });
  }, [
    model?.modelId,
    model?.provider.baseUrl,
    model?.provider.realtimeEndpoint,
    model?.provider.realtimeProtocol,
  ]);

  const contextTranscript = activeSession.context
    .map((message) => `${message.role === "user" ? "User" : "Ayaka"}: ${message.text}`)
    .join("\n");
  const contextText = contextTranscript
    ? `\n\nContext from the previous realtime conversation (latest turns):\n${contextTranscript.slice(-14_000)}`
    : "";
  const realtimeProtocol = model?.provider.realtimeProtocol ?? "openai";
  const sessionConfig = useMemo(() => {
    const config: Partial<Experimental_RealtimeSessionConfig> = {
      instructions: `You are Ayaka, a natural and concise realtime voice conversation partner. Respond in the user's language.${contextText}`,
      voice: "alloy",
      turnDetection: { type: "server-vad" },
      outputModalities: ["text", "audio"],
    };
    if (realtimeProtocol === "bailian") {
      config.inputAudioFormat = { type: "audio/pcm", rate: 16_000 };
      config.outputAudioFormat = { type: "audio/pcm", rate: 24_000 };
    } else {
      config.inputAudioTranscription = {};
      config.outputAudioTranscription = {};
    }
    return config;
  }, [contextText, realtimeProtocol]);
  const setupUrl =
    serverInfo && model
      ? `http://127.0.0.1:${serverInfo.port}/api/realtime/setup?session=${encodeURIComponent(serverInfo.token)}&model=${encodeURIComponent(model.ref)}`
      : "http://127.0.0.1:1/api/realtime/setup";
  const realtime = experimental_useRealtime({
    model: modelInstance,
    api: { token: setupUrl },
    sessionConfig,
    onEvent: (event) => {
      if (event.type === "session-created" || event.type === "session-updated") setError(null);
    },
    onError: (error) => {
      console.error("[realtime] connection failed:", error.message);
      setError(t("realtime.connectionError"));
    },
  });

  const transcript = useMemo(() => {
    const now = Date.now();
    return realtime.messages.flatMap((message) => {
      const textParts = message.parts
        .filter((part) => part.type === "text")
        .map((part) => (part.type === "text" ? part.text : ""))
        .join("")
        .trim();
      if (!textParts || (message.role !== "user" && message.role !== "assistant")) return [];
      const createdAt = createdAtById.current.get(message.id) ?? now;
      createdAtById.current.set(message.id, createdAt);
      return [
        {
          id: message.id,
          role: message.role,
          text: textParts,
          createdAt,
        } satisfies RealtimeSessionMessage,
      ];
    });
  }, [realtime.messages]);

  transcriptRef.current = transcript;

  useEffect(() => {
    if (realtime.status === "connected" && streamRef.current && !realtime.isCapturing) {
      realtime.startAudioCapture(streamRef.current);
    }
  }, [realtime.status, realtime.isCapturing, realtime.startAudioCapture]);

  useEffect(() => {
    if (realtime.status !== "disconnected" && realtime.status !== "error") return;
    if (realtime.status === "error") {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, [realtime.status]);

  useEffect(() => {
    const lifecycle = ++connectionLifecycleRef.current;
    // React StrictMode replays effects in development. Defer the connection
    // until that replay has completed so the discarded mount cannot create a
    // proxy session that is immediately torn down during the upstream handshake.
    const connectTimer = window.setTimeout(() => {
      if (connectionLifecycleRef.current === lifecycle) void realtime.connect();
    }, 0);
    const stream = streamRef.current;
    return () => {
      if (transcriptRef.current.length)
        void api.realtimeSessions.saveTranscript(activeSession.id, transcriptRef.current);
      window.clearTimeout(connectTimer);
      queueMicrotask(() => {
        if (connectionLifecycleRef.current !== lifecycle) return;
        realtime.stopAudioCapture();
        realtime.disconnect();
        stream?.getTracks().forEach((track) => track.stop());
      });
    };
    // This pane represents a single new server session; reconnecting is handled by creating a new one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!transcript.length) return;
    const timer = window.setTimeout(() => {
      void api.realtimeSessions
        .saveTranscript(activeSession.id, transcript)
        .then(() => onTranscriptChanged())
        .catch(() => setError(t("realtime.connectionError")));
    }, 600);
    return () => window.clearTimeout(timer);
  }, [activeSession.id, onTranscriptChanged, t, transcript]);

  const handleEnd = (): void => {
    realtime.stopAudioCapture();
    realtime.disconnect();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (transcriptRef.current.length)
      void api.realtimeSessions
        .saveTranscript(activeSession.id, transcriptRef.current)
        .then(() => onTranscriptChanged());
    onEnd();
  };

  const submitText = (): void => {
    const value = text.trim();
    if (!value || realtime.status !== "connected") return;
    realtime.sendTextMessage(value);
    setText("");
  };

  const statusLabel =
    realtime.status === "connected"
      ? realtime.isCapturing
        ? t("realtime.listening")
        : t("realtime.connected")
      : realtime.status === "connecting"
        ? t("realtime.connecting")
        : t("realtime.disconnected");

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-7 py-5">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {t("realtime.history")}
          </p>
          <h1 className="mt-1 text-lg font-semibold">
            {transcript[0]?.role === "user"
              ? transcript[0].text.slice(0, 72)
              : t("realtime.defaultTitle")}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground">
            <span
              className={[
                "size-2 rounded-full",
                realtime.status === "connected"
                  ? "bg-emerald-500"
                  : realtime.status === "error"
                    ? "bg-danger"
                    : "bg-muted-foreground/40",
              ].join(" ")}
            />
            {statusLabel}
          </div>
          <span className="max-w-[220px] truncate text-xs text-muted-foreground">
            {model?.label ?? ""}
          </span>
          <Button variant="tertiary" size="sm" className="gap-2" onPress={handleEnd}>
            <IconX className="size-3.5" />
            {t("realtime.disconnect")}
          </Button>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto px-6 py-7">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
          {transcript.map((message) => (
            <TranscriptBubble key={message.id} message={message} />
          ))}
          {transcript.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center py-20 text-center">
              <div className="mb-5 grid size-16 place-items-center rounded-full bg-accent/60 text-accent-foreground ring-8 ring-accent/20">
                <IconMic className="size-7" />
              </div>
              <p className="text-sm text-muted-foreground">{statusLabel}</p>
              <div className="mt-3 flex h-8 items-center gap-1" aria-hidden="true">
                {[10, 18, 26, 15, 23, 12, 20, 14, 25, 11, 19].map((height, index) => (
                  <span key={index} className="w-1 rounded-full bg-primary/55" style={{ height }} />
                ))}
              </div>
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-center text-sm text-danger">
              {error}
            </p>
          ) : null}
        </div>
      </main>
      <footer className="border-t border-border bg-background px-6 py-4">
        <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-input bg-card p-2 shadow-sm focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
          <textarea
            value={text}
            onChange={(event) => setText(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submitText();
              }
            }}
            placeholder={t("realtime.textPlaceholder")}
            aria-label={t("realtime.textPlaceholder")}
            rows={1}
            className="max-h-32 min-h-10 flex-1 resize-y bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
          />
          <Button
            isIconOnly
            size="md"
            variant="primary"
            aria-label={t("realtime.send")}
            isDisabled={!text.trim() || realtime.status !== "connected"}
            onPress={submitText}
          >
            <IconSend className="size-4" />
          </Button>
        </div>
        <p className="mx-auto mt-2 max-w-3xl text-center text-[10px] text-muted-foreground">
          {t("realtime.connectHint")}
        </p>
      </footer>
    </>
  );
}

function TranscriptBubble({ message }: { message: RealtimeSessionMessage }): React.JSX.Element {
  const { t } = useT();
  const isUser = message.role === "user";
  return (
    <article
      className={[
        "flex max-w-[86%] flex-col gap-1.5",
        isUser ? "self-end items-end" : "self-start items-start",
      ].join(" ")}
    >
      <span className="px-1 text-[10px] font-medium text-muted-foreground">
        {isUser ? t("realtime.you") : t("realtime.assistant")}
      </span>
      <div
        className={[
          "whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed",
          isUser
            ? "rounded-br-md bg-accent text-accent-foreground"
            : "rounded-bl-md bg-muted/70 text-foreground",
        ].join(" ")}
      >
        {message.text}
      </div>
    </article>
  );
}
