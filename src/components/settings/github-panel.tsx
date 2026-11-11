"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";

import { GithubMark } from "@/components/brand/github-mark";
import { CARD, PanelState, useAccountData } from "@/components/settings/use-account-data";
import { Button } from "@/components/ui/button";

interface Account {
  configured: boolean;
  connected: boolean;
  reconnect?: boolean;
  login: string | null;
}

/** Connect or disconnect GitHub. Each app is put on GitHub from its own workspace (the logo in the top bar). */
export function GithubPanel() {
  const loaded = useAccountData<Account>("/api/github");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  const result = useSearchParams().get("github");

  async function disconnect() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/api/github", { method: "DELETE" });
      if (!res.ok) throw new Error("failed");
      const data = (await res.json()) as { revoked?: boolean };
      if (data.revoked === false) setNote("Disconnected here, but GitHub didn't confirm it. To be sure GoodBuild has no access, remove it at github.com/settings/applications.");
      loaded.reload();
    } catch {
      setError("We couldn't disconnect. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PanelState loaded={loaded}>
      {loaded.state === "ready" && (
        <div className={`${CARD} mt-6`}>
          <div className="flex items-start gap-4">
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-ink text-white">
              <GithubMark />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold">{loaded.data.connected ? `Connected as ${loaded.data.login}` : "GitHub"}</p>
              <p className="mt-1.5 text-sm text-grey-600">
                {loaded.data.reconnect
                  ? "Your saved GitHub connection can't be used any more. Connect again to keep syncing."
                  : !loaded.data.configured && !loaded.data.connected
                  ? "GitHub isn't switched on for this GoodBuild yet."
                  : loaded.data.connected
                    ? "Open any app and tap the GitHub logo in the top bar to put it in a public repository. GoodBuild keeps its main branch up to date. Disconnecting stops syncing and leaves your repositories on GitHub."
                    : "Connect GitHub to put your apps in public repositories with one tap and keep them in sync as you build."}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {loaded.data.connected && (
                  <Button variant="secondary" size="sm" onClick={() => void disconnect()} disabled={busy}>
                    Disconnect GitHub
                  </Button>
                )}
                {loaded.data.configured && !loaded.data.connected && (
                  <Button asChild size="sm">
                    <a href="/api/github/connect?returnTo=%2Fsettings%3Ftab%3Dgithub">
                      <GithubMark className="size-4" /> Connect GitHub
                    </a>
                  </Button>
                )}
              </div>
              {result === "different_account" && (
                <p role="alert" className="mt-3 text-sm text-danger">
                  That GitHub account isn&rsquo;t the one your synced apps are in, so nothing was changed. Stop syncing those apps first (the GitHub logo in each app), or sign in to the same GitHub account.
                </p>
              )}
              {result === "failed" && (
                <p role="alert" className="mt-3 text-sm text-danger">
                  GitHub didn&rsquo;t connect. Try again.
                </p>
              )}
              {note && <p className="mt-3 text-sm text-grey-600">{note}</p>}
              {error && (
                <p role="alert" className="mt-3 text-sm text-danger">
                  {error}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </PanelState>
  );
}
