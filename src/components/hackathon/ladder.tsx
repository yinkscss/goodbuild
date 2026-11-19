"use client";
import * as React from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth/context";
import { buildLadder, type LadderRow } from "@/lib/hackathon-ladder";
import { RANK_REWARDS_GD } from "@/lib/hackathon-rewards";

type Entry = { id: string; alias: string; title: string; liveUrl: string; sourceUrl: string; approvals: number; pitch: string; prevRank?: number | null };

const LEAGUE_STYLE = {
  Gold: "bg-[#fff1cf] text-[#8a5a00]",
  Silver: "bg-[#e8e8ee] text-[#555]",
  Bronze: "bg-[#f6e2d3] text-[#8a4b1f]",
} as const;

const gd = (n: number) => n.toLocaleString("en-US");

/**
 * The live leaderboard (D130), shared by the public page and the in-app dashboard so they can't
 * disagree. `mode="app"` highlights the signed-in builder's own project and shows how many
 * approvals it needs to reach the prize zone.
 */
export function Ladder({ mode }: { mode: "web" | "app" }) {
  const { user } = useAuth();
  const [entries, setEntries] = React.useState<Entry[] | null>(null);
  const [myId, setMyId] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    let stopped = false;
    const load = () =>
      fetch("/api/hackathon/projects", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("failed"))))
        .then((data: Entry[]) => !stopped && (setEntries(data), setFailed(false)))
        .catch(() => !stopped && setFailed(true));
    void load();
    const timer = setInterval(load, 60_000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

  React.useEffect(() => {
    if (mode !== "app" || !user) return;
    let stopped = false;
    void fetch("/api/hackathon/projects?mine", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((mine: { id?: string } | null) => !stopped && setMyId(mine?.id ?? null))
      .catch(() => undefined);
    return () => {
      stopped = true;
    };
  }, [mode, user]);

  if (failed && !entries) return <p role="status" className="text-sm text-grey-600">The leaderboard couldn’t load. Reload to try again.</p>;
  if (!entries) return <p role="status" className="text-sm text-grey-600">Loading the leaderboard…</p>;

  const { rows, mine, gapToPrizeZone } = buildLadder(entries, user ? myId : null);
  if (rows.length === 0)
    return (
      <p className="text-sm text-grey-600">
        No published projects yet. The first one to go live takes rank 1.{" "}
        <Link href="/hackathon/submit" className="font-medium text-violet underline-offset-4 hover:underline">
          Submit yours
        </Link>
      </p>
    );

  const shown = rows.slice(0, 20);
  const outside = mine && !mine.inPrizeZone ? mine : null;

  return (
    <div>
      {mode === "app" && mine && (
        <div className="mb-4 rounded-block bg-tint p-4 text-sm">
          <p className="font-semibold">
            You are #{mine.entry.rank} with {mine.entry.approvals} {mine.entry.approvals === 1 ? "approval" : "approvals"}.
          </p>
          <p className="mt-1 text-grey-600">
            {gapToPrizeZone === 0
              ? "You’re in the prize zone."
              : `${gapToPrizeZone ?? "A few"} more ${gapToPrizeZone === 1 ? "approval" : "approvals"} to reach the prize zone.`}{" "}
            Estimated earnings: {gd(mine.entry.totalGd)} G$ (an estimate until voting closes on 10 Dec).
          </p>
        </div>
      )}
      <ol className="m-0 list-none p-0">
        {shown.map((row) => (
          <LadderItem key={row.entry.id} row={row} you={row.entry.id === myId} />
        ))}
      </ol>
      {outside && (
        <>
          <p className="my-3 text-center text-xs font-semibold text-warning">Prize zone ends at #{RANK_REWARDS_GD.length}</p>
          <ol className="m-0 list-none p-0">
            <LadderItem row={outside} you />
          </ol>
        </>
      )}
      <p className="mt-4 text-xs text-grey-600">
        Ranked by verified approvals; ties go to the earlier submission. Amounts are estimates, not balances or confirmed payments.
      </p>
    </div>
  );
}

function LadderItem<T extends Entry>({ row, you }: { row: LadderRow<T>; you: boolean }) {
  const { entry, league, moved } = row;
  return (
    <li className={`grid grid-cols-[2.5rem_1fr_auto] items-center gap-3 border-t border-ink/5 py-3 first:border-t-0 ${you ? "-mx-3 rounded-block bg-tint px-3" : ""}`}>
      <span className="display text-base font-extrabold text-grey-400 tabular-nums">{entry.rank}</span>
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 font-semibold">
          <span className="truncate">{entry.title}</span>
          {you && <span className="rounded-full bg-violet px-2.5 py-0.5 text-[11px] font-semibold text-white">You</span>}
          {league && <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${LEAGUE_STYLE[league]}`}>{league}</span>}
          {moved !== 0 && (
            <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${moved > 0 ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}>
              <span aria-hidden>{moved > 0 ? "▲" : "▼"} {Math.abs(moved)}</span>
              <span className="sr-only">{moved > 0 ? `Up ${moved}` : `Down ${Math.abs(moved)}`} {Math.abs(moved) === 1 ? "place" : "places"} since yesterday</span>
            </span>
          )}
        </p>
        <p className="text-xs text-grey-600">
          by {entry.alias} · est. {gd(entry.totalGd)} G$
        </p>
      </div>
      <p className="text-right tabular-nums">
        <b className="block text-sm">{entry.approvals}</b>
        <span className="text-xs text-grey-600">{entry.approvals === 1 ? "approval" : "approvals"}</span>
      </p>
    </li>
  );
}
