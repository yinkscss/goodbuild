"use client";

import Link from "next/link";

import { PanelState, useAccountData, CARD, CHIP } from "@/components/settings/use-account-data";
import { chainName } from "@/lib/format";
import { projectStatusMeta, relativeTime } from "@/lib/home";
import type { AppRow } from "@/server/account/overview";

function size(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function AppsPanel() {
  const loaded = useAccountData<{ apps: AppRow[] }>("/api/account/apps");
  const apps = loaded.state === "ready" ? loaded.data.apps : [];
  const now = new Date();
  return (
    <PanelState
      loaded={loaded}
      empty={
        loaded.state === "ready" && apps.length === 0 ? (
          <div className={`${CARD} mt-6 text-center text-sm text-grey-600`}>
            Nothing built yet. <Link href="/home" className="font-medium text-violet hover:underline">Start a build</Link>
          </div>
        ) : undefined
      }
    >
      <ul className="mt-6 space-y-3">
        {apps.map((a) => (
          <li key={a.id} className={`${CARD} flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`}>
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2">
                <Link href={`/p/${a.id}`} className="text-base font-semibold hover:text-violet hover:underline">{a.name}</Link>
                <span className={CHIP}>{chainName(a.chainId)}</span>
                <span className={CHIP}>{a.live ? "Live" : "Not published"}</span>
              </p>
              <p className="mt-1.5 text-sm text-grey-600">
                {projectStatusMeta(a.status, a.chainId).label} · updated {relativeTime(new Date(a.updatedAt), now)} · {a.contracts} {a.contracts === 1 ? "contract" : "contracts"} · {a.dataRecords} saved {a.dataRecords === 1 ? "entry" : "entries"} ({size(a.dataBytes)})
              </p>
            </div>
            <Link href={`/p/${a.id}`} className="text-sm font-medium text-violet hover:underline">Open</Link>
          </li>
        ))}
      </ul>
    </PanelState>
  );
}
