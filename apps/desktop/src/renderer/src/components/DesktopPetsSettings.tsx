import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import type {
  DesktopPetSelector,
  DesktopPetSnapshot,
  InstalledPet,
  PetImportCandidate,
  StorePet,
  StorePetPage,
  StorePetQuery,
} from "@shared/types";
import { DESKTOP_PET_STORE_ERROR_PREFIX } from "@shared/types";
import { api } from "../lib/api";
import { useT } from "../lib/i18n";
import { notify } from "../lib/toast";
import { petFrameAt } from "../lib/pet-animation";
import { Button, Switch, Tabs, TabsList, TabsTrigger } from "./ui";
import {
  IconCheck,
  IconGlobe,
  IconPlus,
  IconRefresh,
  IconRotateCcw,
  IconSearch,
  IconSparkles,
  IconTrash,
} from "./icons";
import { ConfirmDialog } from "./ConfirmDialog";

type PageView = "installed" | "store";
type ConfirmAction =
  | { kind: "delete"; pet: InstalledPet }
  | { kind: "import"; candidate: PetImportCandidate }
  | { kind: "store"; pet: StorePet }
  | null;

const EMPTY_STORE: StorePetPage = { pets: [], page: 1, pageSize: 30, total: 0, totalPages: 1 };

export function DesktopPetsSettings(): React.JSX.Element {
  const { t, locale } = useT();
  const [view, setView] = useState<PageView>("installed");
  const [snapshot, setSnapshot] = useState<DesktopPetSnapshot | null>(null);
  const [pets, setPets] = useState<InstalledPet[]>([]);
  const [store, setStore] = useState<StorePetPage>(EMPTY_STORE);
  const [query, setQuery] = useState<StorePetQuery>({
    page: 1,
    pageSize: 30,
    sort: "new",
    kind: "all",
    format: "all",
  });
  const [searchDraft, setSearchDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [storeLoading, setStoreLoading] = useState(false);
  const [localLoadError, setLocalLoadError] = useState(false);
  const [storeError, setStoreError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const displayedLocalErrors = useRef(new Map<string, string>());

  const refreshLocal = useCallback(async (): Promise<void> => {
    setLocalLoadError(false);
    try {
      const [nextSnapshot, nextPets] = await Promise.all([
        api.desktopPet.getSnapshot(),
        api.desktopPet.listPets(),
      ]);
      setSnapshot(nextSnapshot);
      setPets(nextPets);
      notifyChangedLocalErrors(nextSnapshot, nextPets, displayedLocalErrors.current);
    } catch (reason) {
      setLocalLoadError(true);
      notify.error(userFacingErrorMessage(reason, t), undefined, locale);
    } finally {
      setLoading(false);
    }
  }, [locale, t]);

  const refreshStore = useCallback(async (): Promise<void> => {
    setStoreLoading(true);
    setStoreError(false);
    try {
      setStore(await api.desktopPet.listStore(query));
    } catch (reason) {
      setStoreError(true);
      notify.error(storeErrorMessage(reason, t) ?? errorMessage(reason), undefined, locale);
    } finally {
      setStoreLoading(false);
    }
  }, [locale, query, t]);

  useEffect(() => {
    void refreshLocal();
  }, [refreshLocal]);

  useEffect(() => {
    if (view === "store") void refreshStore();
  }, [refreshStore, view]);

  const selectedPet = useMemo(
    () =>
      pets.find((pet) => pet.selector === snapshot?.config.selectedPet) ?? snapshot?.pet ?? null,
    [pets, snapshot],
  );

  const perform = async (id: string, action: () => Promise<unknown>): Promise<void> => {
    setBusyId(id);
    try {
      await action();
      await refreshLocal();
    } catch (reason) {
      notify.error(userFacingErrorMessage(reason, t), undefined, locale);
    } finally {
      setBusyId(null);
    }
  };

  const selectPet = (pet: InstalledPet): void => {
    if (
      (!pet.available && pet.source !== "builtin") ||
      (pet.selector === snapshot?.config.selectedPet && pet.available)
    )
      return;
    void perform(pet.selector, async () => {
      setSnapshot(await api.desktopPet.select(pet.selector));
      notify.success(t("pets.toast.selected", { name: pet.displayName }));
    });
  };

  const setEnabled = (enabled: boolean): void => {
    void perform("enabled", async () => {
      setSnapshot(await api.desktopPet.setEnabled(enabled));
    });
  };

  const beginImport = (mode: "zip" | "folder"): void => {
    void perform(`import-${mode}`, async () => {
      const candidate = await api.desktopPet.beginLocalImport(mode);
      if (!candidate) return;
      if (candidate.conflict) {
        setConfirmAction({ kind: "import", candidate });
        return;
      }
      await api.desktopPet.commitLocalImport(candidate.token, false);
      notify.success(t("pets.toast.imported", { name: candidate.pet.displayName }));
    });
  };

  const installStore = (pet: StorePet, replace: boolean): void => {
    void perform(`store-${pet.id}`, async () => {
      await api.desktopPet.installStore(pet.id, replace);
      notify.success(
        t(replace ? "pets.toast.updated" : "pets.toast.downloaded", { name: pet.displayName }),
      );
      await refreshStore();
    });
  };

  const useStorePet = (pet: StorePet): void => {
    void perform(`store-${pet.id}`, async () => {
      setSnapshot(await api.desktopPet.select(`installed:${pet.id}`));
      notify.success(t("pets.toast.selected", { name: pet.displayName }));
    });
  };

  const confirm = (): void => {
    const action = confirmAction;
    setConfirmAction(null);
    if (!action) return;
    if (action.kind === "delete") {
      void perform(action.pet.selector, async () => {
        setSnapshot(await api.desktopPet.delete(action.pet.selector));
        notify.success(t("pets.toast.deleted", { name: action.pet.displayName }));
      });
      return;
    }
    if (action.kind === "import") {
      void perform(`import-${action.candidate.pet.id}`, async () => {
        await api.desktopPet.commitLocalImport(action.candidate.token, true);
        notify.success(t("pets.toast.imported", { name: action.candidate.pet.displayName }));
      });
      return;
    }
    installStore(action.pet, true);
  };

  if (loading && !snapshot) {
    return <PetsSkeleton />;
  }

  return (
    <section className="-mx-5 -my-4 flex min-h-0 flex-1 select-none flex-col overflow-hidden [&_input]:select-text [&_textarea]:select-text">
      <header className="shrink-0 border-b border-foreground/10 px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs value={view} onValueChange={(next) => setView(next as PageView)} className="py-3">
            <TabsList aria-label={t("pets.title")}>
              <TabsTrigger value="installed">{t("pets.tab.installed")}</TabsTrigger>
              <TabsTrigger value="store">{t("pets.tab.store")}</TabsTrigger>
            </TabsList>
          </Tabs>
          {view === "installed" ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onPress={() => beginImport("zip")}>
                <IconPlus className="mr-1 size-3.5" />
                {t("pets.import.zip")}
              </Button>
              <Button size="sm" variant="tertiary" onPress={() => beginImport("folder")}>
                {t("pets.import.folder")}
              </Button>
            </div>
          ) : null}
        </div>

        {view === "installed" ? (
          <div className="border-t border-foreground/10 pb-3 pt-3">
            <div className="grid gap-3 rounded-lg bg-foreground/[0.035] p-2.5 sm:grid-cols-[5rem_minmax(0,1fr)_auto] sm:items-center">
              <div className="flex h-20 items-center justify-center rounded-md bg-background/75">
                {selectedPet?.available ? (
                  <PetSprite pet={selectedPet} animate />
                ) : (
                  <IconSparkles className="size-6 text-foreground/20" />
                )}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs text-accent">
                  <IconSparkles className="size-3.5 shrink-0" />
                  <span>{t("pets.title")}</span>
                  <span className="text-foreground/25">/</span>
                  <span className="truncate text-foreground/55">
                    {snapshot?.enabled ? t("pets.awake") : t("pets.tucked")}
                  </span>
                </div>
                <p className="mt-1 truncate text-sm font-semibold">
                  {selectedPet?.displayName ?? t("pets.noneSelected")}
                </p>
                <p className="mt-0.5 line-clamp-1 text-xs leading-relaxed text-foreground/55">
                  {selectedPet?.description ?? t("pets.chooseOne")}
                </p>
                {snapshot?.activity.kind && snapshot.activity.kind !== "idle" ? (
                  <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-md bg-background px-2 py-0.5 text-[11px]">
                    <span className={`pet-activity-dot pet-activity-${snapshot.activity.kind}`} />
                    {activityLabel(snapshot.activity.kind, t)}
                  </div>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2 sm:max-w-[19rem]">
                <label className="flex items-center gap-2 text-xs">
                  <span className="text-foreground/60">{t("pets.mainAgentOnly")}</span>
                  <Switch
                    isSelected={snapshot?.enabled ?? false}
                    isDisabled={busyId === "enabled"}
                    onChange={setEnabled}
                    aria-label={t("pets.wakeToggle")}
                  />
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <span className="text-foreground/60">{t("pets.alwaysOnTop")}</span>
                  <Switch
                    size="sm"
                    isSelected={snapshot?.config.window.alwaysOnTop ?? false}
                    onChange={(alwaysOnTop) =>
                      void perform("always-on-top", async () => {
                        setSnapshot(await api.desktopPet.updateWindow({ alwaysOnTop }));
                      })
                    }
                    aria-label={t("pets.alwaysOnTop")}
                  />
                </label>
                <Button
                  size="sm"
                  variant="tertiary"
                  onPress={() =>
                    void perform("reset", async () => {
                      setSnapshot(await api.desktopPet.resetPosition());
                    })
                  }
                >
                  <IconRotateCcw className="mr-1 size-3.5" />
                  {t("pets.resetPosition")}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-5">
        {view === "installed" ? (
          <InstalledPets
            pets={pets}
            selected={snapshot?.config.selectedPet ?? null}
            busyId={busyId}
            loadError={localLoadError}
            onSelect={selectPet}
            onDelete={(pet) => setConfirmAction({ kind: "delete", pet })}
            onRetry={() => void refreshLocal()}
          />
        ) : (
          <StorePets
            page={store}
            query={query}
            draft={searchDraft}
            loading={storeLoading}
            error={storeError}
            busyId={busyId}
            selected={snapshot?.config.selectedPet ?? null}
            onDraft={setSearchDraft}
            onQuery={(patch) => setQuery((current) => ({ ...current, ...patch }))}
            onSearch={() => setQuery((current) => ({ ...current, query: searchDraft, page: 1 }))}
            onRetry={() => void refreshStore()}
            onInstall={(pet) =>
              pet.updateAvailable
                ? setConfirmAction({ kind: "store", pet })
                : installStore(pet, false)
            }
            onUse={useStorePet}
          />
        )}
      </div>

      <ConfirmDialog
        open={confirmAction !== null}
        title={confirmTitle(confirmAction, t)}
        message={confirmMessage(confirmAction, t)}
        danger={confirmAction?.kind === "delete"}
        confirmLabel={confirmAction?.kind === "delete" ? t("common.delete") : t("common.replace")}
        onConfirm={confirm}
        onClose={() => setConfirmAction(null)}
      />
    </section>
  );
}

function InstalledPets({
  pets,
  selected,
  busyId,
  loadError,
  onSelect,
  onDelete,
  onRetry,
}: {
  pets: InstalledPet[];
  selected: DesktopPetSelector | null;
  busyId: string | null;
  loadError: boolean;
  onSelect: (pet: InstalledPet) => void;
  onDelete: (pet: InstalledPet) => void;
  onRetry: () => void;
}): React.JSX.Element {
  const { t } = useT();
  return (
    <>
      {loadError ? (
        <div className="mb-5 rounded-xl bg-foreground/[0.035] px-5 py-8 text-center">
          <IconRefresh className="mx-auto size-7 text-foreground/25" />
          <p className="mt-3 text-sm font-medium">{t("pets.library.title")}</p>
          <Button className="mt-4" size="sm" variant="secondary" onPress={onRetry}>
            <IconRefresh className="mr-1 size-3.5" />
            {t("common.retry")}
          </Button>
        </div>
      ) : null}
      <div
        className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4"
        role="radiogroup"
        aria-label={t("pets.library.title")}
      >
        {pets.map((pet) => (
          <article
            key={pet.selector}
            className={`group relative flex min-h-60 flex-col overflow-hidden rounded-xl bg-foreground/[0.035] transition duration-200 ${
              selected === pet.selector ? "ring-2 ring-accent/60" : "hover:bg-foreground/[0.065]"
            }`}
          >
            <button
              type="button"
              className="flex flex-1 flex-col p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
              onClick={() => onSelect(pet)}
              disabled={(!pet.available && pet.source !== "builtin") || busyId === pet.selector}
              role="radio"
              aria-checked={selected === pet.selector}
            >
              <div className="relative flex h-32 w-full items-center justify-center rounded-lg bg-background/70">
                {pet.available ? (
                  <PetSprite pet={pet} animate={selected === pet.selector} />
                ) : (
                  <IconSparkles className="size-7 text-foreground/20" />
                )}
                <span className="absolute left-2 top-2 rounded-sm bg-background/85 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-foreground/60">
                  {sourceLabel(pet, t)} · V{pet.formatVersion}
                </span>
                {selected === pet.selector ? (
                  <span className="absolute right-2 top-2 grid size-6 place-items-center rounded-full bg-accent text-accent-foreground">
                    <IconCheck className="size-3.5" />
                  </span>
                ) : null}
              </div>
              <h5 className="mt-3 truncate text-sm font-semibold">{pet.displayName}</h5>
              <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-foreground/50">
                {pet.description}
              </p>
            </button>
            {pet.removable ? (
              <button
                type="button"
                className="absolute bottom-3 right-3 rounded-md p-1.5 text-foreground/35 opacity-0 transition hover:bg-danger/10 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                onClick={() => onDelete(pet)}
                aria-label={t("pets.delete", { name: pet.displayName })}
              >
                <IconTrash className="size-3.5" />
              </button>
            ) : null}
          </article>
        ))}
      </div>
    </>
  );
}

function StorePets({
  page,
  query,
  draft,
  loading,
  error,
  busyId,
  selected,
  onDraft,
  onQuery,
  onSearch,
  onRetry,
  onInstall,
  onUse,
}: {
  page: StorePetPage;
  query: StorePetQuery;
  draft: string;
  loading: boolean;
  error: boolean;
  busyId: string | null;
  selected: DesktopPetSelector | null;
  onDraft: (value: string) => void;
  onQuery: (patch: Partial<StorePetQuery>) => void;
  onSearch: () => void;
  onRetry: () => void;
  onInstall: (pet: StorePet) => void;
  onUse: (pet: StorePet) => void;
}): React.JSX.Element {
  const { t } = useT();
  return (
    <>
      <div className="flex flex-col gap-3 rounded-xl bg-foreground/[0.035] p-3">
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            onSearch();
          }}
        >
          <label className="relative flex-1">
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground/35" />
            <input
              value={draft}
              onChange={(event) => onDraft(event.target.value)}
              placeholder={t("pets.store.search")}
              className="h-9 w-full select-text rounded-md border border-foreground/10 bg-background pl-9 pr-3 text-sm outline-none transition focus:border-accent/55 focus:ring-2 focus:ring-accent/15"
            />
          </label>
          <Button type="submit" size="sm" variant="primary">
            {t("common.search")}
          </Button>
        </form>
        <div className="flex flex-wrap gap-2">
          <FilterSelect
            label={t("pets.store.format")}
            value={query.format ?? "all"}
            options={[
              ["all", t("common.all")],
              ["v2", "V2"],
              ["v1", "V1"],
            ]}
            onChange={(format) => onQuery({ format: format as StorePetQuery["format"], page: 1 })}
          />
          <FilterSelect
            label={t("pets.store.kind")}
            value={query.kind ?? "all"}
            options={[
              ["all", t("common.all")],
              ["animal", t("pets.kind.animal")],
              ["person", t("pets.kind.person")],
              ["creature", t("pets.kind.creature")],
              ["object", t("pets.kind.object")],
            ]}
            onChange={(kind) => onQuery({ kind: kind as StorePetQuery["kind"], page: 1 })}
          />
          <FilterSelect
            label={t("pets.store.sort")}
            value={query.sort ?? "new"}
            options={[
              ["new", t("pets.sort.new")],
              ["popular", t("pets.sort.popular")],
              ["views", t("pets.sort.views")],
            ]}
            onChange={(sort) => onQuery({ sort: sort as StorePetQuery["sort"], page: 1 })}
          />
          <span className="ml-auto self-center text-xs tabular-nums text-foreground/45">
            {t("pets.store.total", { count: page.total })}
          </span>
        </div>
      </div>

      {error ? (
        <div className="mt-5 rounded-xl bg-foreground/[0.035] px-5 py-10 text-center">
          <IconGlobe className="mx-auto size-7 text-foreground/25" />
          <p className="mt-3 text-sm font-medium">{t("pets.store.unavailable")}</p>
          <Button className="mt-4" size="sm" variant="secondary" onPress={onRetry}>
            <IconRefresh className="mr-1 size-3.5" />
            {t("common.retry")}
          </Button>
        </div>
      ) : loading ? (
        <StoreSkeleton />
      ) : page.pets.length === 0 ? (
        <div className="mt-5 rounded-xl bg-foreground/[0.035] px-5 py-12 text-center text-sm text-foreground/50">
          {t("pets.store.empty")}
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
          {page.pets.map((pet) => (
            <article
              key={pet.id}
              className="flex min-h-72 flex-col overflow-hidden rounded-xl bg-foreground/[0.035] transition hover:bg-foreground/[0.06]"
            >
              <div className="relative flex h-36 items-center justify-center overflow-hidden bg-background/70">
                <img
                  src={pet.posterUrl}
                  alt={pet.displayName}
                  className="h-[104px] w-24 object-none [image-rendering:pixelated]"
                />
                <span className="absolute left-2 top-2 rounded-sm bg-background/85 px-1.5 py-0.5 text-[10px] font-medium">
                  V{pet.formatVersion}
                </span>
              </div>
              <div className="flex flex-1 flex-col p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h5 className="truncate text-sm font-semibold">{pet.displayName}</h5>
                    <p className="truncate text-xs text-foreground/40">
                      {t("pets.store.by", { name: pet.author })}
                    </p>
                  </div>
                </div>
                <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-foreground/50">
                  {pet.description}
                </p>
                <div className="mt-auto pt-4">
                  <Button
                    size="sm"
                    variant={pet.installed ? "secondary" : "primary"}
                    className="w-full"
                    isDisabled={
                      busyId === `store-${pet.id}` ||
                      (pet.installed && !pet.updateAvailable && selected === `installed:${pet.id}`)
                    }
                    onPress={() =>
                      pet.installed && !pet.updateAvailable ? onUse(pet) : onInstall(pet)
                    }
                  >
                    {busyId === `store-${pet.id}`
                      ? t("pets.store.downloading")
                      : pet.updateAvailable
                        ? t("pets.store.update")
                        : pet.installed && selected === `installed:${pet.id}`
                          ? t("pets.store.inUse")
                          : pet.installed
                            ? t("pets.store.use")
                            : t("pets.store.download")}
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {page.totalPages > 1 ? (
        <div className="mt-5 flex items-center justify-center gap-3 text-sm">
          <Button
            size="sm"
            variant="tertiary"
            isDisabled={page.page <= 1}
            onPress={() => onQuery({ page: page.page - 1 })}
          >
            {t("common.previous")}
          </Button>
          <span className="tabular-nums text-foreground/50">
            {page.page} / {page.totalPages}
          </span>
          <Button
            size="sm"
            variant="tertiary"
            isDisabled={page.page >= page.totalPages}
            onPress={() => onQuery({ page: page.page + 1 })}
          >
            {t("common.next")}
          </Button>
        </div>
      ) : null}
    </>
  );
}

function PetSprite({
  pet,
  size = "small",
  animate = false,
}: {
  pet: InstalledPet;
  size?: "small" | "large";
  animate?: boolean;
}): React.JSX.Element {
  const reducedMotion = Boolean(useReducedMotion());
  const [hovered, setHovered] = useState(false);
  const startedAt = useRef(Date.now());
  const [clock, setClock] = useState(Date.now());
  const active = (animate || hovered) && !reducedMotion;
  useEffect(() => {
    if (!active) return;
    startedAt.current = Date.now();
    const interval = window.setInterval(() => setClock(Date.now()), 100);
    return () => window.clearInterval(interval);
  }, [active, pet.selector]);
  const width = size === "large" ? 96 : 72;
  const height = size === "large" ? 104 : 78;
  const rows = pet.formatVersion === 2 ? 11 : 9;
  const frame = active ? petFrameAt("idle", clock - startedAt.current, false, pet.animations) : 0;
  const column = frame % 8;
  const row = Math.floor(frame / 8);
  return (
    <span
      role="img"
      aria-label={pet.displayName}
      className="block shrink-0 bg-no-repeat [image-rendering:pixelated]"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width,
        height,
        backgroundImage: `url(${pet.assetUrl})`,
        backgroundSize: `${width * 8}px ${height * rows}px`,
        backgroundPosition: `${-column * width}px ${-row * height}px`,
      }}
    />
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
}): React.JSX.Element {
  return (
    <label className="flex items-center gap-2 text-xs text-foreground/50">
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 rounded-md border border-foreground/10 bg-background px-2 text-xs text-foreground outline-none focus:border-accent/55"
      >
        {options.map(([id, text]) => (
          <option key={id} value={id}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

function PetsSkeleton(): React.JSX.Element {
  return (
    <div className="flex flex-1 select-none animate-pulse flex-col gap-4 p-6">
      <div className="h-7 w-40 rounded bg-foreground/10" />
      <div className="h-40 rounded-xl bg-foreground/[0.06]" />
      <div className="grid grid-cols-3 gap-3">
        {[0, 1, 2].map((id) => (
          <div key={id} className="h-52 rounded-xl bg-foreground/[0.06]" />
        ))}
      </div>
    </div>
  );
}

function StoreSkeleton(): React.JSX.Element {
  return (
    <div className="mt-5 grid animate-pulse grid-cols-2 gap-3 lg:grid-cols-3">
      {[0, 1, 2, 3, 4, 5].map((id) => (
        <div key={id} className="h-72 rounded-xl bg-foreground/[0.055]" />
      ))}
    </div>
  );
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function notifyChangedLocalErrors(
  snapshot: DesktopPetSnapshot,
  pets: InstalledPet[],
  displayedErrors: Map<string, string>,
): void {
  const nextErrors = new Map<string, string>();
  if (snapshot.assetError) nextErrors.set("snapshot", snapshot.assetError);
  for (const pet of pets) {
    if (pet.error) nextErrors.set(pet.selector, pet.error);
  }

  for (const [key, message] of nextErrors) {
    if (displayedErrors.get(key) !== message) notify.error(message);
  }

  displayedErrors.clear();
  for (const [key, message] of nextErrors) displayedErrors.set(key, message);
}

function userFacingErrorMessage(
  reason: unknown,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  return storeErrorMessage(reason, t) ?? errorMessage(reason);
}

function storeErrorMessage(
  reason: unknown,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string | null {
  const message = errorMessage(reason);
  if (!message.startsWith(`${DESKTOP_PET_STORE_ERROR_PREFIX}:`)) return null;
  const [, code, status] = message.split(":");
  if (code === "network") return t("pets.store.error.network");
  if (code === "timeout") return t("pets.store.error.timeout");
  if (code === "invalid-response") return t("pets.store.error.invalidResponse");
  if (code === "http") {
    const parsedStatus = Number(status);
    return t("pets.store.error.http", {
      status: Number.isInteger(parsedStatus) ? parsedStatus : "",
    });
  }
  return t("pets.store.error.generic");
}

function sourceLabel(
  pet: InstalledPet,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  if (pet.source === "builtin") return t("pets.source.builtin");
  if (pet.source === "store") return t("pets.source.store");
  return t("pets.source.local");
}

function activityLabel(
  kind: DesktopPetSnapshot["activity"]["kind"],
  t: (key: string) => string,
): string {
  return t(`pets.activity.${kind}`);
}

function confirmTitle(action: ConfirmAction, t: (key: string) => string): string {
  if (action?.kind === "delete") return t("pets.confirm.deleteTitle");
  return t("pets.confirm.replaceTitle");
}

function confirmMessage(
  action: ConfirmAction,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  if (!action) return "";
  if (action.kind === "delete")
    return t("pets.confirm.deleteMessage", { name: action.pet.displayName });
  const name = action.kind === "store" ? action.pet.displayName : action.candidate.pet.displayName;
  return t("pets.confirm.replaceMessage", { name });
}
