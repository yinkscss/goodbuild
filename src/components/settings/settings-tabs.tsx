"use client";

import * as React from "react";

import { AdminPanel } from "@/components/settings/admin-panel";
import { AppsPanel } from "@/components/settings/apps-panel";
import { ContractsPanel } from "@/components/settings/contracts-panel";
import { GithubPanel } from "@/components/settings/github-panel";
import { DataPanel } from "@/components/settings/data-panel";
import { PreferencesPanel } from "@/components/settings/preferences-panel";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "apps", label: "Apps" },
  { key: "contracts", label: "Contracts" },
  { key: "admin", label: "Admin functions" },
  { key: "data", label: "Data" },
  { key: "github", label: "GitHub" },
  { key: "preferences", label: "Preferences" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const isTab = (v: string | undefined): v is TabKey => TABS.some((t) => t.key === v);

export function SettingsTabs({ initialTab }: { initialTab?: string }) {
  const [tab, setTab] = React.useState<TabKey>(isTab(initialTab) ? initialTab : "apps");
  const select = (key: TabKey) => {
    setTab(key);
    window.history.replaceState(null, "", `/settings?tab=${key}`);
  };
  return (
    <div className="mt-8">
      <div role="tablist" aria-label="Settings" className="flex gap-1 overflow-x-auto rounded-full bg-tint p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            id={`tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls={`panel-${t.key}`}
            onClick={() => select(t.key)}
            className={cn("shrink-0 rounded-full px-4 py-2 text-sm font-medium outline-none focus-visible:shadow-focus", tab === t.key ? "bg-surface shadow-card" : "text-ink/65 hover:text-violet")}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "apps" && <AppsPanel />}
        {tab === "contracts" && <ContractsPanel />}
        {tab === "admin" && <AdminPanel />}
        {tab === "data" && <DataPanel />}
        {tab === "github" && <GithubPanel />}
        {tab === "preferences" && <PreferencesPanel />}
      </div>
    </div>
  );
}
