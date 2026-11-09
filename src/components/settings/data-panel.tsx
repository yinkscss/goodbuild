"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { PanelState, useAccountData, CARD } from "@/components/settings/use-account-data";
import { maskSubject } from "@/lib/account";
import { relativeTime } from "@/lib/home";
import type { AppRow } from "@/server/account/overview";

interface RecordsPage {
  collections: string[];
  collection?: string;
  records: Array<{ key: string; owner: string | null; value: unknown; updatedAt: string }>;
  nextCursor: string | null;
}

function Records({ projectId }: { projectId: string }) {
  const [collection, setCollection] = React.useState<string | null>(null);
  const [paged, setPaged] = React.useState<{ k: string; rows: RecordsPage["records"]; cursor: string | null } | null>(null);
  const q = collection ? `?collection=${encodeURIComponent(collection)}` : "";
  const loaded = useAccountData<RecordsPage>(`/api/projects/${projectId}/app-data/records${q}`);
  const page = loaded.state === "ready" ? loaded.data : null;
  const k = `${projectId}:${page?.collection ?? ""}`;
  const extra = paged?.k === k ? paged.rows : [];
  const next = paged?.k === k ? paged.cursor : (page?.nextCursor ?? null);
  const now = new Date();

  async function more() {
    if (!page || !next) return;
    const res = await fetch(`/api/projects/${projectId}/app-data/records?collection=${encodeURIComponent(page.collection ?? "")}&cursor=${next}`, { cache: "no-store" });
    if (!res.ok) return;
    const body = (await res.json()) as RecordsPage;
    setPaged((m) => ({ k, rows: [...(m?.k === k ? m.rows : []), ...body.records], cursor: body.nextCursor }));
  }

  return (
    <PanelState loaded={loaded}>
      {page && !page.collections.length ? (
        <p className="mt-4 text-sm text-grey-600">Nothing for you to read here. The app has no saved entries, has not been published, or keeps its entries private to each visitor.</p>
      ) : (
        page && (
          <div className="mt-4">
            <div className="flex flex-wrap items-center gap-2">
              {page.collections.map((c) => (
                <button key={c} onClick={() => setCollection(c)} aria-pressed={c === page.collection} className={`rounded-full px-3 py-1 text-sm font-medium ${c === page.collection ? "bg-violet text-white" : "bg-tint text-violet"}`}>{c}</button>
              ))}
              {page.collection && (
                <a href={`/api/projects/${projectId}/app-data/records?collection=${encodeURIComponent(page.collection)}&format=csv`} className="ml-auto text-sm font-medium text-violet hover:underline">Download CSV</a>
              )}
            </div>
            <div className="mt-3 overflow-x-auto rounded-block bg-tint">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-grey-600">
                  <tr><th className="p-3 font-medium">Saved by</th><th className="p-3 font-medium">Entry</th><th className="p-3 font-medium">Updated</th></tr>
                </thead>
                <tbody>
                  {[...page.records, ...extra].map((r) => (
                    <tr key={`${r.owner}:${r.key}`} className="border-t border-surface align-top">
                      <td className="p-3 whitespace-nowrap">{maskSubject(r.owner)}</td>
                      <td className="max-w-[420px] p-3"><code className="block truncate font-mono text-xs" title={JSON.stringify(r.value)}>{JSON.stringify(r.value)}</code></td>
                      <td className="p-3 whitespace-nowrap text-grey-600">{relativeTime(new Date(r.updatedAt), now)}</td>
                    </tr>
                  ))}
                  {!page.records.length && <tr><td colSpan={3} className="p-4 text-grey-600">No entries yet.</td></tr>}
                </tbody>
              </table>
            </div>
            {next && <Button variant="secondary" size="sm" className="mt-3" onClick={() => void more()}>Show more</Button>}
          </div>
        )
      )}
    </PanelState>
  );
}

export function DataPanel() {
  const loaded = useAccountData<{ apps: AppRow[] }>("/api/account/apps");
  const apps = loaded.state === "ready" ? loaded.data.apps.filter((a) => a.slug) : [];
  const [selected, setSelected] = React.useState<string | null>(null);
  const current = selected ?? apps[0]?.id ?? null;
  return (
    <PanelState loaded={loaded} empty={loaded.state === "ready" && !apps.length ? <div className={`${CARD} mt-6 text-center text-sm text-grey-600`}>Publish an app and the entries its visitors save will show up here.</div> : undefined}>
      <div className={`${CARD} mt-6`}>
        <label className="block text-sm text-grey-600">
          App
          <select value={current ?? ""} onChange={(e) => setSelected(e.target.value)} className="ml-2 rounded-full bg-tint px-3 py-2 text-base text-ink outline-none focus:shadow-focus sm:text-sm">
            {apps.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <p className="mt-2 text-xs text-grey-600">You see collections the app lets its owner read. Entries visitors keep private stay private, and visitor email addresses are never shown.</p>
        {current && <Records key={current} projectId={current} />}
      </div>
    </PanelState>
  );
}
