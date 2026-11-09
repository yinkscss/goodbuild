"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";

import { PanelState, useAccountData, CARD, CHIP } from "@/components/settings/use-account-data";
import { chainName, explorerAddressUrl, shortAddress } from "@/lib/format";
import { relativeTime } from "@/lib/home";
import type { ContractRow } from "@/server/account/overview";

const VERIFY: Record<string, string> = { verified: "Verified", pending: "Verifying", failed: "Not verified", unsupported: "Not verifiable" };

export function ContractsPanel() {
  const loaded = useAccountData<{ contracts: ContractRow[] }>("/api/account/contracts");
  const rows = loaded.state === "ready" ? loaded.data.contracts : [];
  const now = new Date();
  return (
    <PanelState loaded={loaded} empty={loaded.state === "ready" && !rows.length ? <div className={`${CARD} mt-6 text-center text-sm text-grey-600`}>No contracts deployed yet. Deploy one from an app&apos;s workspace.</div> : undefined}>
      <ul className="mt-6 space-y-3">
        {rows.map((c) => {
          const explorer = explorerAddressUrl(c.chainId, c.address);
          return (
            <li key={c.id} className={`${CARD} flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between ${c.live ? "" : "opacity-70"}`}>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-semibold">{c.contractName}</span>
                  <span className={CHIP}>{chainName(c.chainId)}</span>
                  <span className={CHIP}>{c.live ? "Live" : "Replaced"}</span>
                  <span className={CHIP}>{VERIFY[c.verifyStatus] ?? "Verifying"}</span>
                  {c.upgradeable && <span className={CHIP}>Upgradeable</span>}
                </p>
                <p className="mt-1.5 text-sm text-grey-600">
                  <Link href={`/p/${c.projectId}`} className="font-medium text-ink hover:text-violet hover:underline">{c.projectName}</Link> · {relativeTime(new Date(c.createdAt), now)}
                </p>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <code className="rounded-[10px] bg-tint px-2.5 py-1 font-mono text-[13px]" title={c.address}>{shortAddress(c.address, 8, 6)}</code>
                {explorer && (
                  <a href={explorer} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-violet hover:underline" aria-label={`${c.contractName} on the block explorer`}>
                    Explorer <ExternalLink className="size-3.5" aria-hidden />
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </PanelState>
  );
}
