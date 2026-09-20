import {
  ActionProvider,
  Renderer,
  StateProvider,
  ValidationProvider,
  VisibilityProvider,
  useJsonRenderMessage,
} from "@json-render/react";
import type { Spec } from "@json-render/core";
import { Component, useEffect, useMemo, type ReactNode } from "react";
import type { UIMessage } from "ai";
import { useT } from "../lib/i18n";
import { generatedUIRegistry } from "../lib/generated-ui-registry";
import {
  createGeneratedUIStateStore,
  withGeneratedUISpecState,
} from "@shared/generated-ui/message";
import type { GeneratedUIStateChange } from "@shared/generated-ui/types";

interface GeneratedUIMessageProps {
  message: UIMessage;
  isStreaming: boolean;
  onStateChange?: (change: GeneratedUIStateChange) => void;
}

interface ErrorBoundaryProps {
  fallback: ReactNode;
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

class GeneratedUIController {
  messageId = "";
  spec: Spec | null = null;
  isStreaming = true;
  syncing = false;
  onStateChange: ((change: GeneratedUIStateChange) => void) | undefined;

  update(
    messageId: string,
    spec: Spec | null,
    isStreaming: boolean,
    onStateChange: ((change: GeneratedUIStateChange) => void) | undefined,
  ): void {
    this.messageId = messageId;
    this.spec = spec;
    this.isStreaming = isStreaming;
    this.onStateChange = onStateChange;
  }

  beginSync(): void {
    this.syncing = true;
  }

  endSync(): void {
    this.syncing = false;
  }

  report(state: Record<string, unknown>): void {
    if (this.syncing || this.isStreaming || !this.spec) return;
    this.onStateChange?.({
      messageId: this.messageId,
      spec: withGeneratedUISpecState(this.spec, state),
      state: { ...state },
    });
  }
}

class GeneratedUIErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown): void {
    console.error("[chat] generated UI render failed:", error);
  }

  render(): ReactNode {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

function GeneratedUIFallback(): React.JSX.Element {
  const { t } = useT();
  return (
    <div
      role="status"
      className="rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
    >
      {t("generatedUI.unavailable")}
    </div>
  );
}

function UnknownComponentFallback(): React.JSX.Element {
  const { t } = useT();
  return (
    <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
      {t("generatedUI.unsupported")}
    </div>
  );
}

function GeneratedUIMessageContent({
  message,
  isStreaming,
  onStateChange,
}: GeneratedUIMessageProps): React.JSX.Element | null {
  const { spec, hasSpec } = useJsonRenderMessage(message.parts);
  const controller = useMemo(() => new GeneratedUIController(), []);

  useEffect(() => {
    controller.update(message.id, spec, isStreaming, onStateChange);
  }, [controller, isStreaming, message.id, onStateChange, spec]);

  const store = useMemo(
    () => createGeneratedUIStateStore({}, (state) => controller.report(state)),
    [controller],
  );

  useEffect(() => {
    if (!spec?.state) return;
    controller.beginSync();
    try {
      store.update(spec.state);
    } finally {
      controller.endSync();
    }
  }, [controller, spec?.state, store]);

  if (!hasSpec || !spec) return null;

  const content = (
    <StateProvider store={store}>
      <ValidationProvider>
        <VisibilityProvider>
          <ActionProvider handlers={{}}>
            <Renderer
              spec={spec}
              registry={generatedUIRegistry}
              loading={isStreaming}
              fallback={UnknownComponentFallback}
            />
          </ActionProvider>
        </VisibilityProvider>
      </ValidationProvider>
    </StateProvider>
  );

  return (
    <div
      data-slot="generated-ui"
      data-message-id={message.id}
      aria-busy={isStreaming || undefined}
      className={isStreaming ? "pointer-events-none opacity-75" : undefined}
    >
      {content}
    </div>
  );
}

export function GeneratedUIMessage(props: GeneratedUIMessageProps): React.JSX.Element | null {
  return (
    <GeneratedUIErrorBoundary fallback={<GeneratedUIFallback />}>
      <GeneratedUIMessageContent {...props} />
    </GeneratedUIErrorBoundary>
  );
}
