"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";

interface Stats {
  records: number;
  wallets: number;
  bytes: number;
}

const plural = (n: number, word: string) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;

/** A row in the publish modal: what visitors have saved in this app, and a way to delete it. Hidden until there is some. */
export function AppDataRow({ projectId }: { projectId: string }) {
  const [stats, setStats] = React.useState<Stats | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    let stale = false;
    void fetch(`/api/projects/${projectId}/app-data`)
      .then((r) => (r.ok ? (r.json() as Promise<Stats>) : null))
      .then((s) => !stale && setStats(s))
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [projectId]);

  if (!stats?.records) return null;

  async function remove() {
    if (!window.confirm("Delete everything visitors have saved in this app? This can't be undone.")) return;
    setDeleting(true);
    setFailed(false);
    const res = await fetch(`/api/projects/${projectId}/app-data`, { method: "DELETE" }).catch(() => null);
    setDeleting(false);
    if (res?.ok) setStats((await res.json()) as Stats);
    else setFailed(true);
  }

  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <dt className="text-grey-600">Saved data</dt>
      <dd className="flex flex-wrap items-center justify-end gap-2 text-right">
        <span className="font-medium">
          {plural(stats.records, "record")} from {plural(stats.wallets, "wallet")}
        </span>
        {failed && (
          <span className="flex items-center gap-1.5 text-xs" role="alert">
            <span className="size-2 rounded-full bg-danger" aria-hidden />
            Couldn&apos;t delete it. Try again.
          </span>
        )}
        <Button variant="ghost" size="sm" disabled={deleting} onClick={() => void remove()}>
          {deleting && <Loader2 className="animate-spin motion-reduce:animate-none" />} Delete all
        </Button>
      </dd>
    </div>
  );
}
