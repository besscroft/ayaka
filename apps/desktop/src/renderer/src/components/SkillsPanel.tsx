import { useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "./ui";
import { useT } from "../lib/i18n";
import { CatalogDiscover, InstalledSkillsPanel } from "./ToolsPanel";

type SkillsTab = "marketplace" | "installed";

export function SkillsPanel(): React.JSX.Element {
  const { t } = useT();
  const [tab, setTab] = useState<SkillsTab>("marketplace");
  return (
    <div data-slot="skills-panel" className="flex h-full w-full flex-col gap-4 overflow-hidden">
      <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight select-none">{t("skills.title")}</h1>
        </div>
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value === "installed" ? "installed" : "marketplace")}
        >
          <TabsList aria-label={t("skills.tabs.label")}>
            <TabsTrigger value="marketplace">{t("skills.tab.marketplace")}</TabsTrigger>
            <TabsTrigger value="installed">{t("skills.tab.installed")}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "marketplace" ? <CatalogDiscover /> : <InstalledSkillsPanel />}
      </div>
    </div>
  );
}
