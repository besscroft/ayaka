import { useEffect, useState } from "react";
import appIcon from "../../../../resources/icon.png";
import { api } from "../lib/api";
import { ABOUT_RESOURCES, normalizeAppVersion, type AboutResourceId } from "../lib/about";
import { useT } from "../lib/i18n";
import type { UpdateState } from "@shared/types";
import { Button, Description } from "./ui";
import {
  IconArrowDown,
  IconBookOpen,
  IconBug,
  IconGitFork,
  IconRefresh,
  IconRotateCcw,
} from "./icons";

const RESOURCE_ICONS: Record<AboutResourceId, typeof IconGitFork> = {
  repository: IconGitFork,
  documentation: IconBookOpen,
  issues: IconBug,
};

export function AboutSettings(): React.JSX.Element {
  const { t } = useT();
  const [version, setVersion] = useState<string | null | undefined>(undefined);
  const [updateState, setUpdateState] = useState<UpdateState | null>(null);

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
    <section className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center py-8">
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
          <p className="text-xs font-medium text-accent">{t("about.product")}</p>
          <h3 className="mt-1 text-2xl font-semibold leading-tight">Paimon</h3>
          <Description className="mt-1">{t("shell.tagline")}</Description>
        </div>
      </header>

      <p className="mt-6 max-w-xl text-sm leading-6 text-muted-foreground">
        {t("about.description")}
      </p>

      <dl className="mt-8 grid grid-cols-2 gap-x-8 gap-y-5">
        <div className="flex min-w-0 flex-col gap-1">
          <dt className="text-xs text-muted-foreground">{t("about.version")}</dt>
          <dd className="break-words font-mono text-sm font-medium">{versionLabel}</dd>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <dt className="text-xs text-muted-foreground">{t("about.license")}</dt>
          <dd className="text-sm font-medium">MIT</dd>
        </div>
      </dl>

      <div className="mt-8 flex flex-col gap-3">
        <h4 className="text-sm font-medium">{t("about.resources")}</h4>
        <div className="flex flex-wrap gap-2">
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
            </div>
            <IconRefresh
              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
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
            {updateState.status === "error" && updateState.errorCode === "busy" ? (
              <Description className="text-danger">{t("about.update.error.busy")}</Description>
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
                <IconRefresh data-icon="inline-start" aria-hidden="true" />
                {updateState.status === "checking"
                  ? t("about.update.checking")
                  : t("about.update.check")}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <p className="mt-8 text-xs text-muted-foreground">Copyright (c) 2026 Bess Croft</p>
    </section>
  );
}
