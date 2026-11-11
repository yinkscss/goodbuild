import { Suspense } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { connection } from "next/server";
import { ArrowUpRight, Check, ExternalLink } from "lucide-react";

import { RetryButton } from "@/components/home/retry-button";
import { SiteFooter } from "@/components/landing/site-footer";
import { SiteNav } from "@/components/landing/site-nav";
import { SignupsChart } from "@/components/stats/signups-chart";
import { RowsSkeleton } from "@/components/ui/wait";
import { SITE_URL } from "@/config/site-url";
import { explorerAddressUrl, explorerTxUrl } from "@/lib/deploy/explorer";
import { shortAddress } from "@/lib/format";
import { relativeTime } from "@/lib/home";
import { publishedAppUrl, publishedAppsDomain } from "@/lib/published-host";
import { getPublicStats } from "@/server/stats/cached";
import type { PublicStats } from "@/server/stats/public-stats";

export const metadata: Metadata = {
  title: { absolute: "Open stats · GoodBuild" },
  description: "How many people use GoodBuild, what they build, and every contract deployed to Celo, with links so anyone can check.",
  alternates: { canonical: `${SITE_URL}/stats` },
};

const CONTRACTS_SHOWN = 25;
const APPS_SHOWN = 12;
const fmt = (v: number) => v.toLocaleString("en-US");
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** Public, signed-out stats page (D91): our own numbers from the database, and Celo mainnet facts anyone can check on Celoscan. */
export default function StatsPage() {
  return (
    <>
      <SiteNav />
      <main className="mx-auto max-w-[1360px] px-4 sm:px-8">
        <Suspense fallback={<StatsSkeleton />}>
          <Stats />
        </Suspense>
        <SiteFooter />
      </main>
    </>
  );
}

function StatsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="rounded-card bg-surface p-8 shadow-card md:p-12">
        <p className="eyebrow">Open stats</p>
        <h1 className="display mt-3 text-[28px] font-bold sm:text-[40px]">GoodBuild in numbers</h1>
      </div>
      <RowsSkeleton rows={4} label="Loading stats" />
    </div>
  );
}

async function Stats() {
  await connection();
  let stats: PublicStats;
  let requestHost: string | null = null;
  try {
    [stats, requestHost] = await Promise.all([getPublicStats(), headers().then((h) => h.get("host"))]);
  } catch (error) {
    console.error("public stats unavailable", error);
    return (
      <div role="alert" className="flex flex-wrap items-start justify-between gap-4 rounded-card bg-surface p-6 shadow-card">
        <div className="flex items-start gap-3">
          <span className="mt-1.5 size-2 shrink-0 rounded-full bg-danger" aria-hidden />
          <div>
            <p className="text-sm font-medium">We couldn&apos;t load the stats.</p>
            <p className="text-sm text-grey-600">This is usually a brief connection problem.</p>
          </div>
        </div>
        <RetryButton />
      </div>
    );
  }

  const chainId = stats.mainnet.chainId;
  const thisWeek = stats.signupsByWeek.at(-1)?.signups ?? 0;
  const tx = stats.mainnet.transactions;
  const domain = publishedAppsDomain();

  return (
    <div className="space-y-4">
      <section className="flex flex-col justify-between gap-6 rounded-card bg-surface p-8 shadow-card md:flex-row md:items-end md:p-12">
        <div>
          <p className="eyebrow">Open stats</p>
          <h1 className="display mt-3 text-[28px] font-bold sm:text-[40px]">GoodBuild in numbers</h1>
          <p className="mt-4 max-w-xl text-base text-grey-600">
            Who uses GoodBuild and what they make. Everything on Celo is listed below with a link, so you can check it yourself.
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 text-sm md:items-end">
          <span className="text-grey-600">Updated {relativeTime(new Date(stats.generatedAt))}</span>
          <a href="/stats.json" className="font-medium text-violet hover:underline">
            Download the data (JSON)
          </a>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[2.1fr_1fr]">
        <section aria-labelledby="signups-h" className="rounded-card bg-surface p-6 shadow-card md:p-8">
          <p id="signups-h" className="eyebrow">Sign-ups</p>
          <p className="display mt-3 text-[40px] font-extrabold sm:text-[58px]">{fmt(stats.users.total)}</p>
          <p className="text-sm text-grey-600">
            people have signed up · <span className="font-medium text-violet">+{fmt(thisWeek)} this week</span>
          </p>
          <SignupsChart weeks={stats.signupsByWeek} />
        </section>
        <section aria-labelledby="users-h" className="flex flex-col justify-between gap-6 rounded-card bg-surface p-6 shadow-card md:p-8">
          <p id="users-h" className="eyebrow">Our users</p>
          <dl className="grid gap-5">
            <Row label="Signed in this week" value={stats.users.signedInLast7Days} />
            <Row label="Signed in this month" value={stats.users.signedInLast30Days} />
            <Row label="New this month" value={stats.users.newLast30Days} />
            <Row label="Verified with GoodDollar" value={stats.users.goodIdVerified} />
          </dl>
        </section>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile eyebrow="Projects" value={stats.builds.projects} note="Apps people started building" />
        <Tile eyebrow="Builds" value={stats.builds.buildsFinished} note="Times the AI finished a build" />
        <Tile eyebrow="Live apps" value={stats.apps.live} note="Apps published and open to anyone" />
        <Tile eyebrow="Contracts on Celo" value={stats.mainnet.contracts} note={`${fmt(stats.mainnet.contractsSourceChecked)} with source code checked`} />
      </div>

      <section aria-labelledby="tx-h" className="grid gap-6 rounded-card bg-violet p-6 text-white shadow-card md:grid-cols-[1fr_2fr] md:p-8">
        <div>
          <p id="tx-h" className="text-[11px] font-semibold uppercase tracking-[.18em] text-white/70">Transactions on Celo</p>
          <p className="display mt-3 text-[40px] font-extrabold sm:text-[58px]">{fmt(tx.total)}</p>
          <p className="text-sm text-white/70">deploy, upgrade and credit transactions on Celo mainnet</p>
        </div>
        <div className="grid content-end gap-4">
          <dl className="grid gap-4 sm:grid-cols-3">
            <Split label="Contract deploys" value={tx.deploys} />
            <Split label="Contract upgrades" value={tx.upgrades} />
            <Split label="Credit purchases" value={tx.creditPurchases} />
          </dl>
        </div>
      </section>

      <section id="verify" aria-labelledby="verify-h" className="scroll-mt-24 rounded-card bg-surface p-6 shadow-card md:p-8">
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
          <div>
            <p className="eyebrow">Check it yourself</p>
            <h2 id="verify-h" className="display mt-3 text-[24px] font-bold sm:text-[28px]">Every contract on Celo</h2>
          </div>
          <p className="max-w-md text-sm text-grey-600">
            Each one opens on Celoscan, Celo&apos;s public record. The newest {Math.min(CONTRACTS_SHOWN, stats.contracts.length)} are here; the full list is in{" "}
            <a href="/stats.json" className="font-medium text-violet hover:underline">
              the data file
            </a>
            .
          </p>
        </div>
        {stats.contracts.length === 0 ? (
          <p className="mt-6 text-sm text-grey-600">No contracts on Celo mainnet yet.</p>
        ) : (
          <ul className="mt-6 divide-y divide-hairline">
            {stats.contracts.slice(0, CONTRACTS_SHOWN).map((c) => (
              <li key={c.address} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{c.name}</span>
                  <span className="text-grey-600">{day(c.deployedAt)}</span>
                </span>
                <span className="flex flex-wrap items-center gap-3">
                  {c.sourceChecked && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-3 py-1 text-[13px] font-medium text-success">
                      <Check className="size-3.5" aria-hidden /> Source code checked
                    </span>
                  )}
                  <a href={explorerAddressUrl(chainId, c.address)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[13px] text-violet hover:underline">
                    {shortAddress(c.address)} <ExternalLink className="size-3.5" aria-hidden />
                    <span className="sr-only">(opens Celoscan)</span>
                  </a>
                  <a href={explorerTxUrl(chainId, c.txHash)} target="_blank" rel="noreferrer" className="text-[13px] text-grey-600 hover:text-violet">
                    Transaction
                  </a>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="apps-h" className="rounded-card bg-surface p-6 shadow-card md:p-8">
        <p className="eyebrow">Live apps</p>
        <h2 id="apps-h" className="display mt-3 text-[24px] font-bold sm:text-[28px]">Open them and see</h2>
        {stats.liveApps.length === 0 ? (
          <p className="mt-6 text-sm text-grey-600">No apps published yet.</p>
        ) : (
          <ul className="mt-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {stats.liveApps.slice(0, APPS_SHOWN).map((a) => {
              const href = publishedAppUrl(a.slug, requestHost, domain);
              return (
                <li key={a.slug}>
                  <a href={href} target="_blank" rel="noreferrer" className="group flex items-center justify-between gap-3 rounded-block bg-tint px-4 py-3 text-sm transition-colors duration-200 ease-gb hover:bg-violet-soft">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{a.name}</span>
                      <span className="block truncate text-grey-600">{new URL(href).host}</span>
                    </span>
                    <ArrowUpRight className="size-4 shrink-0 text-violet" aria-hidden />
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="how-h" className="rounded-card bg-surface p-6 text-sm text-grey-600 shadow-card md:p-8">
        <p id="how-h" className="eyebrow">How we count</p>
        <ul className="mt-4 grid list-disc gap-2 pl-5 md:grid-cols-2">
          <li>We publish counts only. No names, emails, wallets or amounts.</li>
          <li>Celo figures cover Celo mainnet only, not the test network.</li>
          <li>Transactions are contract deploys (two for an upgradeable contract), upgrades (two each) and credit purchases.</li>
          <li>&quot;Signed in&quot; counts each person once, however often they came back.</li>
          <li>Contracts from projects their owners deleted aren&apos;t counted, though they stay on Celo.</li>
          <li>Numbers refresh at most every 10 minutes.</li>
        </ul>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-hairline pb-3 last:border-0 last:pb-0">
      <dt className="text-sm text-grey-600">{label}</dt>
      <dd className="display text-[24px] font-bold text-violet">{fmt(value)}</dd>
    </div>
  );
}

function Tile({ eyebrow, value, note }: { eyebrow: string; value: number; note: string }) {
  return (
    <div className="flex min-h-44 flex-col justify-between gap-6 rounded-card bg-surface p-6 shadow-card">
      <p className="eyebrow">{eyebrow}</p>
      <div>
        <p className="display text-[40px] font-extrabold">{fmt(value)}</p>
        <p className="mt-1 text-sm text-grey-600">{note}</p>
      </div>
    </div>
  );
}

function Split({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col-reverse">
      <dt className="text-sm text-white/70">{label}</dt>
      <dd className="display text-[28px] font-bold">{fmt(value)}</dd>
    </div>
  );
}
