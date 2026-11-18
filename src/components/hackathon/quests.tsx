"use client";
import * as React from "react";
import { buildLadder } from "@/lib/hackathon-ladder";
import { buildQuests } from "@/lib/hackathon-quests";
import { MAX_APPROVALS_PER_PERSON, type VoteStatus } from "@/lib/hackathon-vote";
import { REWARD_SLOTS } from "@/lib/hackathon-rewards";

type Entry = { id: string; liveUrl: string; approvals: number; stars?: number[] };

async function get<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/**
 * The builder's quests and badges (D133). Everything is worked out from what the app already knows:
 * the registration claim, the approvals they've given, and their project's approvals and rank.
 */
export function Quests({ registered, deployClaimed }: { registered: boolean; deployClaimed: boolean }) {
  const [state, setState] = React.useState<{ entries: Entry[]; mineId: string | null; votes: VoteStatus | null } | null>(null);

  React.useEffect(() => {
    let stopped = false;
    void Promise.all([
      get<Entry[]>("/api/hackathon/projects"),
      get<{ id?: string } | null>("/api/hackathon/projects?mine=1"),
      get<VoteStatus>("/api/hackathon/votes"),
    ]).then(([entries, mine, votes]) => {
      if (!stopped) setState({ entries: entries ?? [], mineId: mine?.id ?? null, votes });
    });
    return () => {
      stopped = true;
    };
  }, []);

  if (!state) return <p role="status" className="text-sm text-grey-600">Loading your quests…</p>;

  const ladder = buildLadder(state.entries, state.mineId);
  const own = state.mineId ? state.entries.find((e) => e.id === state.mineId) : undefined;
  const { quests, badges, league, done } = buildQuests({
    registered,
    deployClaimed,
    published: Boolean(own?.liveUrl),
    approvalsGiven: state.votes?.used ?? 0,
    maxApprovals: state.votes?.max ?? MAX_APPROVALS_PER_PERSON,
    approvalsReceived: own?.approvals ?? 0,
    rank: ladder.mine?.entry.rank ?? null,
    prizeSlots: REWARD_SLOTS,
    risingStarWeeks: own?.stars?.length ?? 0,
  });

  return (
    <div className="rounded-card bg-surface p-6 shadow-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[.18em] text-violet">Quests</p>
          <h3 className="display mt-1 text-lg font-bold">{done} of {quests.length} done</h3>
        </div>
        {league && <span className="rounded-full bg-tint px-3 py-1 text-xs font-semibold text-violet">{league} league</span>}
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-tint" aria-hidden>
        <div className="h-full rounded-full bg-violet transition-[width] motion-reduce:transition-none" style={{ width: `${(done / quests.length) * 100}%` }} />
      </div>
      <ul className="m-0 mt-2 list-none p-0">
        {quests.map((q) => (
          <li key={q.id} className="grid grid-cols-[1.75rem_1fr_auto] items-center gap-3 border-t border-ink/5 py-3 first:border-t-0">
            <span className={`grid h-6 w-6 place-items-center rounded-full text-xs font-bold ${q.done ? "bg-success text-white" : "bg-tint text-violet"}`} aria-hidden>
              {q.done ? "✓" : ""}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold">
                {q.title}
                <span className="sr-only">{q.done ? " (done)" : " (not done yet)"}</span>
              </p>
              {!q.done && <p className="text-xs text-grey-600">{q.hint}</p>}
            </div>
            <span className="font-mono text-xs text-violet">{q.reward}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap gap-2" aria-label="Badges">
        {badges.map((b) => (
          <span key={b.id} className={`rounded-full px-3 py-1 text-xs font-semibold ${b.earned ? "bg-violet text-white" : "bg-tint text-grey-600 opacity-60"}`}>
            {b.label}
          </span>
        ))}
      </div>
    </div>
  );
}
