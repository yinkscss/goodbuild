"use client";

import * as React from "react";

import { CARD, PanelState, useAccountData } from "@/components/settings/use-account-data";
import { cn } from "@/lib/utils";

export function PreferencesPanel() {
  const loaded = useAccountData<{ showBadge: boolean }>("/api/account/preferences");
  const [override, setOverride] = React.useState<boolean | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const on = override ?? (loaded.state === "ready" ? loaded.data.showBadge : true);

  async function toggle() {
    const next = !on;
    setOverride(next);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/account/preferences", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ showBadge: next }) });
      if (!res.ok) throw new Error("failed");
    } catch {
      setOverride(!next);
      setError("We couldn't save that. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <PanelState loaded={loaded}>
      <div className={`${CARD} mt-6 flex items-start justify-between gap-6`}>
        <div className="min-w-0">
          <p id="badge-label" className="text-base font-semibold">Show &ldquo;Built with GoodBuild&rdquo; on my apps</p>
          <p className="mt-1.5 text-sm text-grey-600">
            A small badge at the bottom of your published apps. Turn it off to remove it. It applies the next time you publish an app. Notices visitors need, such as a demo
            contract or a contract that can still be changed, stay on the page.
          </p>
          {error && (
            <p role="alert" className="mt-2 text-sm font-medium text-danger">
              {error}
            </p>
          )}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby="badge-label"
          disabled={saving}
          onClick={toggle}
          className={cn("relative mt-0.5 h-7 w-12 shrink-0 rounded-full outline-none transition-colors duration-200 focus-visible:shadow-focus disabled:opacity-60", on ? "bg-violet" : "bg-grey-400/50")}
        >
          <span className={cn("absolute top-1 left-1 size-5 rounded-full bg-white shadow-card transition-transform duration-200", on && "translate-x-5")} />
        </button>
      </div>
    </PanelState>
  );
}
