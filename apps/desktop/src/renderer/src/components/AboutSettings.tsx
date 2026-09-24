import { useEffect, useState } from "react";
import appIcon from "../../../../resources/icon.png";
import { api } from "../lib/api";
import { ABOUT_RESOURCES, normalizeAppVersion, type AboutResourceId } from "../lib/about";
import { selectChangelogLanguage } from "../lib/changelog";
import { useT } from "../lib/i18n";
import type { UpdateState } from "@shared/types";
import { Button, Description, LoadingIndicator } from "./ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { RichContent } from "./ai-elements/rich-content";
import { IconArrowDown, IconGitFork, IconHistory, IconRefresh, IconRotateCcw } from "./icons";

const RESOURCE_ICONS: Record<AboutResourceId, typeof IconGitFork> = {
  repository: IconGitFork,
};

export function AboutSettings(): React.JSX.Element {
  const { t, f, locale } = useT();
  const [version, setVersion] = useState<string | null | undefined>(undefined);
  const [updateState, setUpdateState] = useState<UpdateState | null>(null);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [changelogRetry, setChangelogRetry] = useState(0);
  const [changelogState, setChangelogState] = useState<
    { status: "loading" } | { status: "loaded"; content: string } | { status: "error" }
  >({ status: "loading" });

  useEffect(() => {
    if (!changelogOpen) return;
    let cancelled = false;
    setChangelogState({ status: "loading" });
    void api.system.changelog().then(
      (content) => {
        if (!cancelled) setChangelogState({ status: "loaded", content });
      },
      () => {
        if (!cancelled) setChangelogState({ status: "error" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [changelogOpen, changelogRetry]);

  useEffect(() => {
    let cancelled = false;
    void api.system.version().then(
      (value) => {
        if (!cancelled) setVersion(normalizeAppVersion(value));
      },
      () => {
        if (!cancelled) setVersion(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const offStateChanged = api.updates.onStateChanged((state) => {
      if (!cancelled) setUpdateState(state);
    });
    void api.updates.getState().then(
      (state) => {
        if (!cancelled) setUpdateState(state);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
      offStateChanged();
    };
  }, []);

  const handleCheckForUpdates = async (): Promise<void> => {
    setUpdateState(await api.updates.check());
  };

  const handleDownloadUpdate = async (): Promise<void> => {
    setUpdateState(await api.updates.download());
  };

  const handleInstallUpdate = async (): Promise<void> => {
    setUpdateState(await api.updates.install());
  };

  const versionLabel =
    version === undefined
      ? t("about.version.loading")
      : (version ?? t("about.version.unavailable"));

  return (
    <section className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center py-8 select-none">
      <header className="flex items-center gap-5">
        <img
          src={appIcon}
          alt=""
          width={80}
          height={80}
          draggable={false}
          className="size-20 shrink-0 rounded-xl shadow-sm ring-1 ring-border"
        />
        <div className="min-w-0">
          <h3 className="mt-1 text-2xl font-semibold leading-tight">Ayaka</h3>
        </div>
      </header>

      <p className="mt-6 max-w-xl text-sm leading-6 text-muted-foreground">
        {t("about.description")}
      </p>

      <dl className="mt-8 grid grid-cols-2 gap-x-8 gap-y-5">
        <div className="flex min-w-0 flex-col gap-1">
          <dt className="text-xs text-muted-foreground">{t("about.version")}</dt>
          <dd className="break-words font-mono text-sm font-medium">
            {version === undefined ? (
              <LoadingIndicator className="justify-start font-sans text-xs" label={versionLabel} />
            ) : (
              versionLabel
            )}
          </dd>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <dt className="text-xs text-muted-foreground">{t("about.license")}</dt>
          <dd className="text-sm font-medium">MIT</dd>
        </div>
      </dl>

      <div className="mt-8 flex flex-col gap-3">
        <h4 className="text-sm font-medium">{t("about.resources")}</h4>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onPress={() => setChangelogOpen(true)}>
            <IconHistory data-icon="inline-start" aria-hidden="true" />
            {t("about.action.changelog")}
          </Button>
          {ABOUT_RESOURCES.map((resource) => {
            const Icon = RESOURCE_ICONS[resource.id];
            return (
              <Button
                key={resource.id}
                variant={resource.id === "repository" ? "primary" : "outline"}
                size="sm"
                onPress={() => window.open(resource.href, "_blank", "noopener,noreferrer")}
              >
                <Icon data-icon="inline-start" aria-hidden="true" />
                {t(`about.action.${resource.id}`)}
              </Button>
            );
          })}
        </div>
      </div>

      {updateState && updateState.status !== "unsupported" ? (
        <div className="mt-8 border-t border-border pt-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h4 className="text-sm font-medium">{t("about.update.title")}</h4>
              <Description className="mt-1">{t("about.update.description")}</Description>
              <Description className="mt-1">
                {updateState.lastCheckedAt
                  ? t("about.update.lastChecked", {
                      time: f.dateTime(updateState.lastCheckedAt),
                    })
                  : t("about.update.neverChecked")}
              </Description>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            {updateState.status === "idle" ? (
              <Description>{t("about.update.ready")}</Description>
            ) : null}
            {updateState.status === "checking" ? (
              <Description>{t("about.update.checking")}</Description>
            ) : null}
            {updateState.status === "available" ? (
              <Description className="text-foreground">
                {t("about.update.available", { version: updateState.availableVersion ?? "" })}
              </Description>
            ) : null}
            {updateState.status === "downloading" ? (
              <div className="min-w-48 flex-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{t("about.update.downloading")}</span>
                  <span>{Math.round(updateState.progress?.percent ?? 0)}%</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-[width]"
                    style={{
                      width: `${Math.max(0, Math.min(100, updateState.progress?.percent ?? 0))}%`,
                    }}
                  />
                </div>
              </div>
            ) : null}
            {updateState.status === "downloaded" ? (
              <Description className="text-foreground">{t("about.update.downloaded")}</Description>
            ) : null}
            {updateState.status === "not-available" ? (
              <Description>{t("about.update.notAvailable")}</Description>
            ) : null}
            {updateState.status === "error" ? (
              <Description className="text-danger">
                {t(`about.update.error.${updateState.errorCode ?? "unknown"}`)}
              </Description>
            ) : null}

            {updateState.status === "available" ? (
              <Button size="sm" variant="primary" onPress={() => void handleDownloadUpdate()}>
                <IconArrowDown data-icon="inline-start" aria-hidden="true" />
                {t("about.update.download")}
              </Button>
            ) : null}
            {updateState.status === "downloaded" ||
            (updateState.status === "error" && updateState.errorCode === "busy") ? (
              <Button size="sm" variant="primary" onPress={() => void handleInstallUpdate()}>
                <IconRotateCcw data-icon="inline-start" aria-hidden="true" />
                {t("about.update.install")}
              </Button>
            ) : null}
            {updateState.status !== "downloading" && updateState.status !== "downloaded" ? (
              <Button
                size="sm"
                variant="outline"
                isPending={updateState.status === "checking"}
                onPress={() => void handleCheckForUpdates()}
              >
                {updateState.status !== "checking" ? (
                  <IconRefresh data-icon="inline-start" aria-hidden="true" />
                ) : null}
                {updateState.status === "checking"
                  ? t("about.update.checking")
                  : t("about.update.check")}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <p className="mt-8 text-xs text-muted-foreground">Copyright © 2026 ZZZVoid</p>

      <Dialog
        open={changelogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setChangelogOpen(false);
            setChangelogState({ status: "loading" });
          }
        }}
      >
        <DialogContent className="max-h-[calc(100vh-32px)] w-[min(760px,calc(100vw-24px))] max-w-none p-0 select-none">
          <DialogHeader>
            <DialogTitle>{t("about.changelog.title")}</DialogTitle>
            <DialogDescription>{t("about.description")}</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {changelogState.status === "loading" ? (
              <LoadingIndicator label={t("about.changelog.loading")} />
            ) : null}
            {changelogState.status === "loaded" ? (
              <RichContent
                value={selectChangelogLanguage(changelogState.content, locale)}
                className="text-sm"
              />
            ) : null}
            {changelogState.status === "error" ? (
              <div className="flex flex-col items-start gap-3">
                <Description className="text-danger">{t("about.changelog.error")}</Description>
                <Button
                  variant="outline"
                  size="sm"
                  onPress={() => setChangelogRetry((value) => value + 1)}
                >
                  {t("about.changelog.retry")}
                </Button>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="secondary" onPress={() => setChangelogOpen(false)}>
              {t("common.done")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
