import { useEffect, useState } from "react";
import { Button, Input, LoadingIndicator } from "./ui";
import { api } from "../lib/api";
import { useT } from "../lib/i18n";
import { notify } from "../lib/toast";
import type { ManagedRuntimeSnapshot, RuntimeKind } from "@shared/types";

function formatRuntimeTarget(snapshot: ManagedRuntimeSnapshot): string {
  const { platform, architecture, libc } = snapshot.target;
  return `${platform}/${architecture}${platform === "linux" ? `/${libc ?? "unknown libc"}` : ""}`;
}

export function updateRuntimeSource(
  source: Record<RuntimeKind, string>,
  kind: RuntimeKind,
  value: string,
): Record<RuntimeKind, string> {
  return { ...source, [kind]: value };
}

export function RuntimeSettings(): React.JSX.Element {
  const { t } = useT();
  const [snapshot, setSnapshot] = useState<ManagedRuntimeSnapshot | null>(null);
  const [source, setSource] = useState<Record<RuntimeKind, string>>({ node: "", uv: "" });
  const [busy, setBusy] = useState<RuntimeKind | null>(null);

  const refresh = (): void => {
    void api.runtime.managedSnapshot().then((next) => {
      setSnapshot(next);
      setSource({
        node: next.preferences.find((item) => item.kind === "node")?.manifestUrl ?? "",
        uv: next.preferences.find((item) => item.kind === "uv")?.manifestUrl ?? "",
      });
    });
  };

  useEffect(refresh, []);
  useEffect(() => api.runtime.onStateChanged(() => refresh()), []);

  const run = async (kind: RuntimeKind, action: () => Promise<unknown>): Promise<void> => {
    setBusy(kind);
    try {
      await action();
      notify.success(t("runtime.toast.updated"));
      refresh();
    } catch (error) {
      notify.error(
        t("runtime.toast.failed"),
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setBusy(null);
    }
  };

  if (!snapshot) return <LoadingIndicator label={t("runtime.loading")} />;

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h3 className="text-base font-semibold">{t("runtime.title")}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t("runtime.description")}</p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {(["node", "uv"] as const).map((kind) => {
          const managed = snapshot.runtimes
            .filter((runtime) => runtime.kind === kind && runtime.status === "available")
            .sort((left, right) =>
              right.version.localeCompare(left.version, undefined, { numeric: true }),
            );
          const system = snapshot.system.find((item) => item.kind === kind);
          return (
            <div
              key={kind}
              className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{kind === "node" ? "Node.js" : "uv / uvx"}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("runtime.system")}{" "}
                    {system?.available
                      ? (system.version ?? t("runtime.available"))
                      : t("runtime.missing")}
                  </p>
                  {system?.companion ? (
                    <p className="text-xs text-muted-foreground">
                      {system.companion.command}:{" "}
                      {system.companion.available
                        ? (system.companion.version ?? t("runtime.available"))
                        : t("runtime.missing")}
                    </p>
                  ) : null}
                </div>
                <span className="rounded-full bg-muted px-2 py-1 text-xs">
                  {managed[0]?.version ?? t("runtime.notInstalled")}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">{t("runtime.priority")}</p>
              <p className="text-xs text-muted-foreground">
                {t("runtime.target")} {formatRuntimeTarget(snapshot)}
              </p>
              {kind === "uv" ? (
                <p className="text-xs text-muted-foreground">{t("runtime.uvBinaries")}</p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  isPending={busy === kind}
                  onPress={() => void run(kind, () => api.runtime.managedInstall(kind))}
                >
                  {t("runtime.install")}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  isDisabled={busy !== null}
                  onPress={() => void run(kind, () => api.runtime.managedUpgrade(kind))}
                >
                  {t("runtime.upgrade")}
                </Button>
                {managed[0] ? (
                  <Button
                    size="sm"
                    variant="tertiary"
                    isDisabled={busy !== null}
                    onPress={() =>
                      void run(kind, () => api.runtime.managedUninstall(managed[0]!.id))
                    }
                  >
                    {t("runtime.uninstall")}
                  </Button>
                ) : null}
              </div>
              <label className="grid gap-1 text-xs">
                <span>{t("runtime.source")}</span>
                <Input
                  value={source[kind]}
                  onChange={(event) => {
                    // Read the DOM value before entering the state updater. React
                    // clears currentTarget after dispatch, while the updater may
                    // run later.
                    const value = event.currentTarget.value;
                    setSource((current) => updateRuntimeSource(current, kind, value));
                  }}
                  onBlur={() => {
                    const value = source[kind].trim();
                    void run(kind, () => api.runtime.managedSetSource(kind, value));
                  }}
                  placeholder={t("runtime.sourcePlaceholder")}
                />
              </label>
            </div>
          );
        })}
      </div>
      <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        {t("runtime.safety")}
      </p>
    </section>
  );
}
