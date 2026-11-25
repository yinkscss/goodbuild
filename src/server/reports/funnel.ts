import "server-only";

import { sql } from "drizzle-orm";

import type { Db } from "@/server/db/client";
import { isProviderFundsMessage } from "@/server/agent/model";

/**
 * The weekly funnel (D177): how many projects started each week got as far as a version, a published app and a
 * deployed contract, and why builds failed. Counts only: no prompt, file or error text leaves this module. Weeks are
 * cohorts by the Monday (UTC) of the week the project was started, so a project started on 20 Nov and published on
 * 26 Nov counts as published in the week of 16 Nov. Job errors are counted by the week the job was queued.
 */

/** Why a build ended in error, in the same buckets the person reads (src/lib/plain-words.ts plainError). */
export type ErrorCause =
  | "ai_account_empty"
  | "ai_unavailable"
  | "credits"
  | "free_allowance_used"
  | "connection"
  | "timeout"
  | "stalled"
  | "interrupted"
  | "other";

export function errorCause(message: string | null | undefined): ErrorCause {
  const m = (message ?? "").trim();
  if (isProviderFundsMessage(m)) return "ai_account_empty";
  if (/credits ran (low|out)|not enough credits|top.?up/i.test(m)) return "credits";
  if (/included build allowance is used up/i.test(m)) return "free_allowance_used";
  if (/stopped because it stalled/i.test(m)) return "stalled";
  if (/interrupted|saved progress|older version of GoodBuild|no longer matches|failed to start/i.test(m)) return "interrupted";
  if (/AI provider|overloaded|rate.?limit|\b(429|502|503|529)\b/i.test(m)) return "ai_unavailable";
  if (/fetch failed|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|network|connection (was )?(reset|closed|refused)/i.test(m)) return "connection";
  if (/timed? ?out|ETIMEDOUT|deadline|took too long/i.test(m)) return "timeout";
  return "other";
}

export type FunnelWeek = { week: string; started: number; gotVersion: number; published: number; deployed: number };
export type ErrorWeek = { week: string; cause: ErrorCause; jobs: number; projects: number; people: number };
export type FunnelReport = { from: string; weeks: FunnelWeek[]; errors: ErrorWeek[] };

function rowsOf<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : ((result as { rows?: T[] }).rows ?? [])) as T[];
}

const day = (d: Date | string) => new Date(d).toISOString().slice(0, 10);

/** Monday 00:00 UTC of the week `weeks - 1` weeks before `now`'s week. */
export function weeksStart(now: Date, weeks: number): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) - 7 * (weeks - 1));
  return d;
}

/** Read-only: runs inside a READ ONLY transaction, so even a mistake here can't write. */
export async function funnelReport(db: Db, opts: { weeks?: number; now?: Date } = {}): Promise<FunnelReport> {
  const from = weeksStart(opts.now ?? new Date(), Math.max(1, opts.weeks ?? 8));
  const fromIso = from.toISOString();
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION READ ONLY`);
    const weeks = rowsOf<{ week: string; started: string; got_version: string; published: string; deployed: string }>(
      await tx.execute(sql`
        SELECT to_char(date_trunc('week', p.created_at at time zone 'UTC'), 'YYYY-MM-DD') AS week,
          count(*) AS started,
          count(*) FILTER (WHERE EXISTS (SELECT 1 FROM versions v WHERE v.project_id = p.id AND v.number >= 1)) AS got_version,
          count(*) FILTER (WHERE EXISTS (SELECT 1 FROM publications u WHERE u.project_id = p.id)) AS published,
          count(*) FILTER (WHERE EXISTS (SELECT 1 FROM deployments d WHERE d.project_id = p.id)) AS deployed
        FROM projects p
        WHERE p.created_at >= ${fromIso}::timestamptz
        GROUP BY 1 ORDER BY 1`),
    );
    // The error text is read only to classify it here; it is never returned or printed.
    const failed = rowsOf<{ week: string; error: string | null; project_id: string; user_id: string }>(
      await tx.execute(sql`
        SELECT to_char(date_trunc('week', j.created_at at time zone 'UTC'), 'YYYY-MM-DD') AS week, j.error, j.project_id, j.user_id
        FROM turn_jobs j
        WHERE j.status = 'error' AND j.created_at >= ${fromIso}::timestamptz`),
    );
    const groups = new Map<string, { week: string; cause: ErrorCause; jobs: number; projects: Set<string>; people: Set<string> }>();
    for (const f of failed) {
      const cause = errorCause(f.error);
      const key = `${f.week}|${cause}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { week: f.week, cause, jobs: 0, projects: new Set(), people: new Set() }));
      g.jobs++;
      g.projects.add(f.project_id);
      g.people.add(f.user_id);
    }
    return {
      from: day(from),
      weeks: weeks.map((w) => ({ week: w.week, started: Number(w.started), gotVersion: Number(w.got_version), published: Number(w.published), deployed: Number(w.deployed) })),
      errors: [...groups.values()]
        .map((g) => ({ week: g.week, cause: g.cause, jobs: g.jobs, projects: g.projects.size, people: g.people.size }))
        .sort((a, b) => a.week.localeCompare(b.week) || b.jobs - a.jobs),
    };
  });
}

const pct = (n: number, of: number) => (of ? `${Math.round((100 * n) / of)}%` : "-");

/** Plain-text tables for the terminal. */
export function formatFunnel(r: FunnelReport): string {
  const lines = [`GoodBuild weekly funnel, weeks from ${r.from} (UTC, by the week each project was started)`, ""];
  lines.push("week        started  got a version   published      deployed a contract");
  for (const w of r.weeks) {
    lines.push(
      `${w.week}  ${String(w.started).padStart(7)}  ${`${w.gotVersion} (${pct(w.gotVersion, w.started)})`.padEnd(14)}  ${`${w.published} (${pct(w.published, w.started)})`.padEnd(13)}  ${w.deployed} (${pct(w.deployed, w.started)})`,
    );
  }
  if (!r.weeks.length) lines.push("(no projects in this window)");
  lines.push("", "Build errors by cause (week the build was queued)", "week        cause                jobs  projects  people");
  for (const e of r.errors) lines.push(`${e.week}  ${e.cause.padEnd(19)}  ${String(e.jobs).padStart(4)}  ${String(e.projects).padStart(8)}  ${String(e.people).padStart(6)}`);
  if (!r.errors.length) lines.push("(no build errors in this window)");
  return lines.join("\n");
}
