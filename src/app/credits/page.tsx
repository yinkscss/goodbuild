import { Suspense } from "react";

import { AddCredits } from "@/components/credits/add-credits";
import { AppShell } from "@/components/home/app-shell";
import { RowsSkeleton, Shimmer, SlowLoadNote } from "@/components/ui/wait";
import { formatCredits } from "@/lib/credits-math";
import { chainName } from "@/lib/format";
import { relativeTime } from "@/lib/home";
import { getCredits } from "@/server/credits";
import { freeRemainingMicro } from "@/server/credits/cap";
import { listTopUps } from "@/server/credits/topups";
import { getDb } from "@/server/db/client";
import { loadSession } from "@/server/home-data";

export const metadata = { title: "Credits · GoodBuild" };

/** The balance, the Add credits flow (G$ against a signed quote) and the latest top-ups. */
export default function CreditsPage() {
  return (
    <AppShell active="credits" width="max-w-[760px]">
      <p className="eyebrow">Credits</p>
      <h1 className="display mt-3 text-[32px] font-extrabold sm:text-[44px]">Credits pay for your AI builds</h1>
      <Suspense
        fallback={
          <div className="mt-8 grid gap-4" aria-busy="true" aria-label="Loading credits">
            <div className="rounded-card bg-surface p-6 shadow-card">
              <p className="eyebrow">Your credits</p>
              <Shimmer className="mt-3 h-8 w-28 rounded-full" />
              <Shimmer className="mt-3 h-3 w-48 rounded-full" />
            </div>
            <RowsSkeleton rows={3} label="Loading top-ups" />
            <SlowLoadNote what="your credits" />
          </div>
        }
      >
        <CreditsBody />
      </Suspense>
    </AppShell>
  );
}

async function CreditsBody() {
  const session = await loadSession();
  const { balanceMicro } = await getCredits(session.user.id);
  const freeMicro = await freeRemainingMicro(await getDb(), session.user.id).catch(() => 0);
  const totalMicro = balanceMicro === null ? null : balanceMicro + (freeMicro ?? 0);
  let topUps: Awaited<ReturnType<typeof listTopUps>> = [];
  let historyError = false;
  try {
    topUps = await listTopUps(await getDb(), session.user.id);
  } catch (error) {
    console.error(error);
    historyError = true;
  }
  const now = new Date();
  return (
    <>
      <div className="mt-8 flex flex-col gap-4 rounded-card bg-surface p-6 shadow-card sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-[.14em] text-grey-400 uppercase">Available</p>
          <p className="display mt-1 text-[40px] font-extrabold">{totalMicro === null ? "Unavailable" : formatCredits(totalMicro)}</p>
          <p className="mt-1 text-sm text-grey-600">{balanceMicro === null ? "We couldn't read your balance. Reload to try again." : freeMicro === null ? `${formatCredits(balanceMicro)} paid, plus unlimited free AI. Each build uses a few credits.` : `${formatCredits(balanceMicro)} paid + ${formatCredits(freeMicro)} of free AI left. Free AI is used first. Each build uses a few credits.`}</p>
        </div>
        <AddCredits />
      </div>

      <h2 className="display mt-10 text-[20px] font-bold">Recent top-ups</h2>
      {historyError ? (
        <p role="alert" className="mt-3 rounded-card bg-surface p-5 text-sm text-danger shadow-card">
          We could not load your top-ups. Reload the page to try again.
        </p>
      ) : topUps.length === 0 ? (
        <p className="mt-3 rounded-card bg-surface p-5 text-sm text-grey-600 shadow-card">No top-ups yet. Add credits with G$ and they show up here.</p>
      ) : (
        <ul className="mt-3 overflow-hidden rounded-card bg-surface shadow-card">
          {topUps.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-3.5 text-sm last:border-b-0">
              <span className="text-grey-600">
                {relativeTime(t.createdAt, now)} <span aria-hidden>· </span>
                {chainName(t.chainId)}
              </span>
              <b className="font-semibold">+{formatCredits(t.amountMicro)}</b>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
