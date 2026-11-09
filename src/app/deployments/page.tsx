import { Suspense } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";

import { AppShell } from "@/components/home/app-shell";
import { chainName, explorerAddressUrl, shortAddress } from "@/lib/format";
import { relativeTime } from "@/lib/home";
import { cn } from "@/lib/utils";
import { getDb } from "@/server/db/client";
import { listUserDeployments } from "@/server/deploy/list";
import { loadSession } from "@/server/home-data";

export const metadata = { title: "Deployments · GoodBuild" };

const VERIFY: Record<string, { label: string; className: string }> = {
  verified: { label: "Verified", className: "bg-success/10 text-success" },
  pending: { label: "Verifying", className: "bg-tint text-violet" },
  failed: { label: "Not verified", className: "bg-warning/10 text-warning" },
  unsupported: { label: "Not verifiable", className: "bg-tint text-grey-600" },
};

/** Every contract the signed-in user has deployed, across their projects. */
export default function DeploymentsPage() {
  return (
    <AppShell active="deployments" width="max-w-[1000px]">
      <p className="eyebrow">Deployments</p>
      <h1 className="display mt-3 text-[32px] font-extrabold sm:text-[44px]">Your contracts, live on Celo</h1>
      <p className="mt-3 max-w-xl text-base text-grey-600">Every contract you have deployed from GoodBuild, with its address, network and whether its source is verified on Sourcify.</p>
      <Suspense fallback={<div className="skeleton mt-8 h-[220px] rounded-card motion-reduce:animate-none" />}>
        <DeploymentList />
      </Suspense>
    </AppShell>
  );
}

async function DeploymentList() {
  const session = await loadSession();
  let rows;
  try {
    rows = await listUserDeployments(await getDb(), session.user.id);
  } catch (error) {
    console.error(error);
    return (
      <p role="alert" className="mt-8 rounded-card bg-surface p-6 text-sm text-danger shadow-card">
        We could not load your deployments. Reload the page to try again.
      </p>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="mt-8 rounded-card bg-surface p-8 text-center shadow-card">
        <p className="text-sm text-grey-600">Nothing deployed yet. Build a dApp, then deploy it from its workspace and it shows up here.</p>
        <Link href="/home" className="mt-3 inline-block text-sm font-medium text-violet hover:underline">
          Start a build
        </Link>
      </div>
    );
  }
  const now = new Date();
  return (
    <ul className="mt-8 space-y-3">
      {rows.map((d) => {
        const verify = VERIFY[d.verifyStatus] ?? VERIFY.pending;
        const explorer = explorerAddressUrl(d.chainId, d.address);
        return (
          <li key={d.id} className="flex flex-col gap-3 rounded-card bg-surface p-5 shadow-card sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2">
                <span className="text-base font-semibold">{d.contractName}</span>
                <span className="rounded-full bg-tint px-2.5 py-0.5 text-[12px] font-medium text-violet">{chainName(d.chainId)}</span>
                <span className={cn("rounded-full px-2.5 py-0.5 text-[12px] font-medium", verify.className)}>{verify.label}</span>
                {d.upgradeable && <span className="rounded-full bg-tint px-2.5 py-0.5 text-[12px] font-medium text-grey-600">Upgradeable</span>}
              </p>
              <p className="mt-1.5 text-sm text-grey-600">
                <Link href={`/p/${d.projectId}`} className="font-medium text-ink hover:text-violet hover:underline">
                  {d.projectName}
                </Link>
                <span aria-hidden> · </span>
                <span>{relativeTime(d.createdAt, now)}</span>
              </p>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <code className="rounded-[10px] bg-tint px-2.5 py-1 font-mono text-[13px]" title={d.address}>
                {shortAddress(d.address, 8, 6)}
              </code>
              {explorer && (
                <a href={explorer} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-violet hover:underline" aria-label={`${d.contractName} on the block explorer`}>
                  Explorer
                  <ExternalLink className="size-3.5" aria-hidden />
                </a>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
