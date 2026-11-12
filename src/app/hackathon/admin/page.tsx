import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AlertTriangle, ExternalLink, Link2 } from "lucide-react";

import { AppShell } from "@/components/home/app-shell";
import { ExpireButton } from "@/components/hackathon/expire-button";
import { explorerAddressUrl } from "@/lib/deploy/explorer";
import { shortAddress } from "@/lib/format";
import { getDb } from "@/server/db/client";
import { DEPLOY_CREDITS, START_CREDITS } from "@/server/hackathon/claim";
import { hackathonReport, type HackathonReport } from "@/server/hackathon/admin";
import { loadSession } from "@/server/home-data";
import { isAdminWallet } from "@/server/settings/mainnet-access";

export const metadata: Metadata = { title: "Hackathon claims · GoodBuild", robots: { index: false } };

const fmt = (n: number) => n.toLocaleString("en-US");
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" });
const CELO = 42220;

/** Who claimed hackathon credits (D100). Only wallets in ADMIN_WALLETS see it; everyone else gets a 404. */
export default function HackathonAdminPage() {
  return (
    <AppShell active="settings" width="max-w-[1100px]">
      <p className="eyebrow">Hackathon admin</p>
      <h1 className="display mt-3 text-[32px] font-extrabold sm:text-[44px]">Who claimed</h1>
      <Suspense fallback={<div className="skeleton mt-8 h-[320px] rounded-card motion-reduce:animate-none" />}>
        <Report />
      </Suspense>
    </AppShell>
  );
}

async function Report() {
  const session = await loadSession();
  if (!isAdminWallet(session.user.wallet)) notFound();
  const r = await hackathonReport(await getDb());
  return <ReportView r={r} />;
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-card bg-surface p-6 shadow-card">
      <p className="eyebrow">{label}</p>
      <p className="display mt-3 text-[32px] font-extrabold tabular-nums">{value}</p>
      {note && <p className="mt-1 text-sm text-grey-600">{note}</p>}
    </div>
  );
}

function ReportView({ r }: { r: HackathonReport }) {
  const used = r.budgetCredits ? Math.min(100, Math.round((r.grantedCredits / r.budgetCredits) * 100)) : 100;
  const peak = Math.max(1, ...r.perDay.map((d) => d.count));
  const flagged = r.rows.filter((x) => x.freshWallet).length;
  return (
    <div className="mt-8 space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Registered" value={fmt(r.registered)} note={`${START_CREDITS} credits each`} />
        <Tile label="Deployed" value={fmt(r.deployed)} note={`${DEPLOY_CREDITS} more each`} />
        <Tile label="Credits given" value={fmt(r.grantedCredits)} note={`of ${fmt(r.budgetCredits)} budget`} />
        <Tile label="Refused claims" value={fmt(r.refusals)} note="Same person again, or budget spent" />
      </div>

      <div className="rounded-card bg-surface p-6 shadow-card">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="eyebrow">Budget used</p>
          <p className="text-sm font-medium text-violet tabular-nums">{used}%</p>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-tint">
          <div className="h-full rounded-full bg-violet" style={{ width: `${used}%` }} />
        </div>
        <p className="mt-3 text-sm text-grey-600">
          Claims close {when(r.closesAt)} WAT. {r.closed ? (r.expiredDone ? `Unspent credits expired: ${fmt(r.expiredCredits)} removed.` : "Claims are closed.") : "Change the budget with HACKATHON_BUDGET_CREDITS, or pause claims with HACKATHON_CLAIMS=off."}
        </p>
        <div className="mt-4">
          <ExpireButton closed={r.closed} />
        </div>
      </div>

      <div className="rounded-card bg-surface p-6 shadow-card">
        <p className="eyebrow">Registrations per day (UTC)</p>
        {r.perDay.length === 0 ? (
          <p className="mt-3 text-sm text-grey-600">No one has registered yet. Registrations show up here as they come in.</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {r.perDay.map((d) => (
              <li key={d.day} className="grid grid-cols-[96px_1fr_40px] items-center gap-3 text-sm tabular-nums">
                <span className="text-grey-600">{d.day}</span>
                <span className="h-2 overflow-hidden rounded-full bg-tint">
                  <span className="block h-full rounded-full bg-violet" style={{ width: `${(d.count / peak) * 100}%` }} />
                </span>
                <span className="text-right font-medium">{d.count}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-card bg-surface p-6 shadow-card">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="eyebrow">Builders, newest first</p>
          {flagged > 0 && (
            <p className="flex items-center gap-1.5 text-sm text-warning">
              <AlertTriangle className="size-4" aria-hidden />
              {flagged} signed up less than 10 minutes before claiming
            </p>
          )}
        </div>
        {r.rows.length === 0 ? (
          <p className="mt-3 text-sm text-grey-600">Nobody yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm tabular-nums">
              <thead className="text-xs text-grey-600">
                <tr>
                  <th className="py-2 pr-4 font-medium">Wallet</th>
                  <th className="py-2 pr-4 font-medium">GoodDollar identity</th>
                  <th className="py-2 pr-4 font-medium">Registered</th>
                  <th className="py-2 pr-4 text-right font-medium">Start</th>
                  <th className="py-2 pr-4 text-right font-medium">Deploy</th>
                  <th className="py-2 pr-4 text-right font-medium">Expired</th>
                  <th className="py-2 font-medium">Flags</th>
                </tr>
              </thead>
              <tbody>
                {r.rows.map((x) => (
                  <tr key={x.root} className="border-t border-hairline">
                    <td className="py-2.5 pr-4">
                      <a href={explorerAddressUrl(CELO, x.wallet)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-xs text-violet hover:underline">
                        {shortAddress(x.wallet)}
                        <ExternalLink className="size-3" aria-hidden />
                      </a>
                    </td>
                    <td className="py-2.5 pr-4 font-mono text-xs">{shortAddress(x.root)}</td>
                    <td className="py-2.5 pr-4">{when(x.at)}</td>
                    <td className="py-2.5 pr-4 text-right">{x.startCredits}</td>
                    <td className="py-2.5 pr-4 text-right">{x.deployCredits || "–"}</td>
                    <td className="py-2.5 pr-4 text-right">{x.expiredCredits || "–"}</td>
                    <td className="py-2.5">
                      <span className="flex flex-wrap gap-1.5">
                        {x.freshWallet && <span className="rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">New wallet</span>}
                        {x.linkedWallet && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-tint px-2 py-0.5 text-xs font-medium text-violet">
                            <Link2 className="size-3" aria-hidden />
                            Linked wallet
                          </span>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-card bg-surface p-6 shadow-card">
        <p className="eyebrow">Refused claims, newest first</p>
        {r.refused.length === 0 ? (
          <p className="mt-3 text-sm text-grey-600">None. A second account trying the same GoodDollar identity would show here.</p>
        ) : (
          <ul className="mt-4 divide-y divide-hairline text-sm">
            {r.refused.map((x, i) => (
              <li key={i} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
                <span className="font-mono text-xs">{shortAddress(x.wallet)}</span>
                <span className="font-mono text-xs text-grey-600">identity {shortAddress(x.root)}</span>
                <span className={x.code === "claimed_elsewhere" ? "text-danger" : "text-warning"}>{x.code === "claimed_elsewhere" ? "Same person, another account" : "Budget spent"}</span>
                <span className="ml-auto text-grey-600">{when(x.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
