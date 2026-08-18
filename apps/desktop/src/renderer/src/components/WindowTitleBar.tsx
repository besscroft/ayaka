import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useT } from "../lib/i18n";
import {
  IconClose,
  IconMaximize,
  IconMinimize,
  IconRestore,
  IconSidebarCollapse,
  IconSidebarExpand,
} from "./icons";

interface WindowTitleBarProps {
  sidebarExpanded: boolean;
  onToggleSidebar: () => void;
}

export function WindowTitleBar({
  sidebarExpanded,
  onToggleSidebar,
}: WindowTitleBarProps): React.JSX.Element {
  const { t } = useT();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let active = true;
    void api.windowControls.isMaximized().then((value) => {
      if (active) setMaximized(value);
    });
    const unsubscribe = api.windowControls.onMaximizedChange(setMaximized);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const toggleMaximize = (): void => {
    void api.windowControls.toggleMaximize().then(setMaximized);
  };

  return (
    <header
      className="window-drag-region flex h-10 shrink-0 select-none items-center border-b border-border bg-background"
      data-slot="window-titlebar"
    >
      <button
        type="button"
        className="window-no-drag flex h-full w-11 items-center justify-center text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-accent focus-visible:text-accent-foreground"
        data-slot="window-sidebar-toggle"
        data-icon-only="true"
        data-icon-tone="neutral"
        onClick={onToggleSidebar}
        aria-label={t(sidebarExpanded ? "shell.sidebar.collapse" : "shell.sidebar.expand")}
        aria-expanded={sidebarExpanded}
      >
        {sidebarExpanded ? (
          <IconSidebarCollapse className="size-4" aria-hidden="true" />
        ) : (
          <IconSidebarExpand className="size-4" aria-hidden="true" />
        )}
      </button>

      <div className="flex min-w-0 flex-1 items-center px-2">
        <span
          className="truncate text-[11px] font-medium tracking-wide text-muted-foreground"
          data-slot="window-brand"
        >
          {t("shell.brand")}
        </span>
      </div>

      <div className="window-no-drag flex h-full items-stretch" data-slot="window-controls">
        <button
          type="button"
          className="window-control-button"
          data-slot="window-control"
          data-icon-only="true"
          data-icon-tone="neutral"
          onClick={() => void api.windowControls.minimize()}
          aria-label={t("window.minimize")}
        >
          <IconMinimize className="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="window-control-button"
          data-slot="window-control"
          data-icon-only="true"
          data-icon-tone="neutral"
          onClick={toggleMaximize}
          aria-label={t(maximized ? "window.restore" : "window.maximize")}
        >
          {maximized ? (
            <IconRestore className="size-3.5" aria-hidden="true" />
          ) : (
            <IconMaximize className="size-3.5" aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          className="window-control-button window-close-button"
          data-slot="window-control"
          data-icon-only="true"
          data-icon-tone="danger"
          onClick={() => void api.windowControls.close()}
          aria-label={t("window.close")}
        >
          <IconClose className="size-4" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
