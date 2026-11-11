"use client";

import * as React from "react";

export interface GithubLinkInfo {
  fullName: string;
  url: string;
  branch: string;
  status: "synced" | "syncing" | "diverged" | "error";
  error: string | null;
  lastVersion: number | null;
  syncedAt: string | null;
  autoSync: boolean;
}

export interface GithubAccount {
  configured: boolean;
  connected: boolean;
  reconnect?: boolean;
  login: string | null;
}

/** The person's GitHub connection and this project's repository, refreshed on a new version and when asked. */
export function useGithub(projectId: string, version: number, enabled = true) {
  const [account, setAccount] = React.useState<GithubAccount | null>(null);
  const [link, setLink] = React.useState<GithubLinkInfo | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [tick, setTick] = React.useState(0);
  const refresh = React.useCallback(() => setTick((n) => n + 1), []);

  React.useEffect(() => {
    if (!enabled) return;
    let stale = false;
    Promise.all([fetch("/api/github", { cache: "no-store" }), fetch(`/api/projects/${projectId}/github`, { cache: "no-store" })])
      .then(async ([a, l]) => {
        if (stale) return;
        if (a.ok) setAccount((await a.json()) as GithubAccount);
        if (l.ok) setLink(((await l.json()) as { link: GithubLinkInfo | null }).link);
      })
      .catch(() => {
        // The button still works; it just shows the last thing it knew.
      });
    return () => {
      stale = true;
    };
  }, [projectId, version, enabled, tick]);

  // While a push is running, look again shortly.
  React.useEffect(() => {
    if (link?.status !== "syncing") return;
    const t = window.setTimeout(refresh, 3000);
    return () => window.clearTimeout(t);
  }, [link, refresh]);

  async function act(method: "POST" | "PATCH" | "DELETE", body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/github`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = (await res.json().catch(() => ({}))) as { link?: GithubLinkInfo | null; message?: string };
      if (!res.ok) {
        setError(data.message ?? "Something went wrong. Try again.");
        if (res.status === 409) refresh();
        return;
      }
      setLink(data.link ?? null);
      // A sync that lost GitHub access also removed the connection: show the reconnect action, not "Try again".
      if (data.link?.status === "error") refresh();
    } catch {
      setError("Couldn't reach GoodBuild. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return {
    account,
    link,
    busy,
    error,
    refresh,
    create: () => act("POST"),
    sync: () => act("PATCH", { action: "sync" }),
    overwrite: () => act("PATCH", { action: "overwrite" }),
    setAuto: (autoSync: boolean) => act("PATCH", { autoSync }),
    unlink: () => act("DELETE"),
  };
}
export type Github = ReturnType<typeof useGithub>;
