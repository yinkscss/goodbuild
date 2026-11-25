import "server-only";

import { and, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";

import type { Db } from "@/server/db/client";
import { providerStatus } from "@/server/db/provider-schema";
import { sendTelegram } from "@/server/support/ticket";
import { MODEL_IDS } from "./model";

/**
 * Pause and hold (D177). On 23 Nov 2026 the DeepSeek account hit zero and 48 builds failed, one person 12 times. Now
 * the first out-of-funds error pauses builds for every worker (a row in `provider_status`), new requests wait in the
 * queue instead of failing, and a probe every few minutes starts them again once the account works. A low-balance
 * alert warns the owner before it gets there.
 */

export type Provider = "deepseek" | "anthropic";
type Env = Record<string, string | undefined>;

/** How often a paused provider is probed, and how often DeepSeek's balance is read. */
export const PROBE_EVERY_MS = 3 * 60_000;
export const BALANCE_EVERY_MS = 5 * 60_000;
/**
 * Low-balance alert line (Claude's pick, D177): 5 USD, or 35 CNY for an account kept in yuan. A DeepSeek build costs
 * a few US cents, so 5 USD is many builds of warning, hours at the 23 Nov rate. DEEPSEEK_LOW_BALANCE overrides it
 * (in the account's currency).
 */
export const LOW_BALANCE = { USD: 5, CNY: 35 } as const;
/** Builds start again only above this, so held builds don't all start on a near-empty account and trip it again. */
export const RESUME_FLOOR = { USD: 0.5, CNY: 3.5 } as const;

/** Which provider an out-of-funds message names ("… (DeepSeek, 402): …"). DeepSeek writes most of every build. */
export function providerOf(message: string): Provider {
  return /\(Anthropic\b/i.test(message) ? "anthropic" : "deepseek";
}

/**
 * SQL, for queued job `j`, that is true while it must wait (claimJob). Per provider: every build starts on DeepSeek
 * (TIER_FOR), so a DeepSeek pause holds every new build. Anthropic only fixes what DeepSeek couldn't, so an
 * Anthropic pause holds only the re-run of a build that failed on Anthropic; other builds keep running.
 */
export const JOB_WAITS = sql`EXISTS (
  SELECT 1 FROM provider_status ps WHERE ps.paused_at IS NOT NULL AND (
    ps.provider = 'deepseek'
    OR (ps.provider = 'anthropic' AND EXISTS (SELECT 1 FROM turn_jobs src WHERE src.id = j.retry_of_job_id AND src.error LIKE '%(Anthropic,%'))
  ))`;

/** Does a queued job of this project wait for a paused AI account (the workspace's held card)? Same rule as JOB_WAITS. */
export async function projectWaiting(db: Db, projectId: string): Promise<boolean> {
  const result = await db.execute(sql`SELECT 1 FROM turn_jobs j WHERE j.project_id = ${projectId} AND j.status = 'queued' AND ${JOB_WAITS} LIMIT 1`);
  return (Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])).length > 0;
}

/**
 * SQL that is true while held builds may still be catching up: a provider is paused, or a pause ended less than
 * `ms` ago. checkHolds doesn't count a queued build as stuck then (23 Nov's outage lasted about 6 hours).
 */
export function holdingWithin(ms: number) {
  return sql`EXISTS (SELECT 1 FROM provider_status ps WHERE ps.paused_at IS NOT NULL OR ps.resumed_at > now() - ${`${ms} milliseconds`}::interval)`;
}

export async function anyProviderPaused(db: Db): Promise<boolean> {
  const [row] = await db.select({ provider: providerStatus.provider }).from(providerStatus).where(isNotNull(providerStatus.pausedAt)).limit(1);
  return Boolean(row);
}

async function ensureRow(db: Db, provider: Provider) {
  await db.insert(providerStatus).values({ provider }).onConflictDoNothing();
}

/**
 * Pause builds because `provider`'s account is out of money. Only the call that actually sets the pause alerts the
 * owner, so a burst of failures across workers sends one message. Returns whether this call paused it.
 */
export async function pauseProvider(db: Db, provider: Provider, reason: string, env: Env = process.env, fetcher: typeof fetch = fetch): Promise<boolean> {
  await ensureRow(db, provider);
  const rows = await db
    .update(providerStatus)
    .set({ pausedAt: new Date(), reason: reason.slice(0, 500), updatedAt: new Date() })
    .where(and(eq(providerStatus.provider, provider), isNull(providerStatus.pausedAt)))
    .returning({ provider: providerStatus.provider });
  if (!rows.length) return false;
  console.error(`[provider-funds] paused builds: ${provider}: ${reason}`);
  void sendTelegram(
    `GoodBuild: new builds are paused because the ${name(provider)} account is out of funds. People's requests are saved and will start on their own once it's topped up (checked every ${PROBE_EVERY_MS / 60_000} minutes). To restart by hand: pnpm provider:resume\n\n${reason.slice(0, 500)}`,
    env,
    fetcher,
  ).catch(() => false);
  return true;
}

/** Clear the pause (a probe passed, or the owner). Held builds then start in order. Returns whether it was paused. */
export async function resumeProvider(db: Db, provider: Provider, why: string, env: Env = process.env, fetcher: typeof fetch = fetch): Promise<boolean> {
  const rows = await db
    .update(providerStatus)
    .set({ pausedAt: null, reason: null, resumedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(providerStatus.provider, provider), isNotNull(providerStatus.pausedAt)))
    .returning({ provider: providerStatus.provider });
  if (!rows.length) return false;
  console.log(`[provider-funds] resumed builds: ${provider}: ${why}`);
  void sendTelegram(`GoodBuild: builds are back on. The ${name(provider)} account works again (${why}), so saved requests are starting now.`, env, fetcher).catch(() => false);
  return true;
}

const name = (p: Provider) => (p === "deepseek" ? "DeepSeek" : "Anthropic");

/** Claim a periodic check for this process: true for exactly one caller per interval across all workers. */
async function claim(db: Db, provider: Provider, column: "lastProbeAt" | "lastBalanceCheckAt", everyMs: number, now: Date): Promise<boolean> {
  await ensureRow(db, provider);
  const col = providerStatus[column];
  const rows = await db
    .update(providerStatus)
    .set({ [column]: now })
    .where(and(eq(providerStatus.provider, provider), or(isNull(col), lt(col, new Date(now.getTime() - everyMs)))))
    .returning({ provider: providerStatus.provider });
  return rows.length > 0;
}

export type Balance = { available: boolean; amount: number; currency: "USD" | "CNY" };

/**
 * DeepSeek's balance (GET /user/balance, api-docs.deepseek.com/api/get-user-balance; read on 23 Nov 2026 per D166).
 * Amounts come as strings; the USD entry is preferred. Null when it can't be read (no key, network, odd reply).
 */
export async function readDeepSeekBalance(env: Env = process.env, fetcher: typeof fetch = fetch): Promise<Balance | null> {
  const key = env.DEEPSEEK_API_KEY;
  if (!key) return null;
  try {
    const res = await fetcher("https://api.deepseek.com/user/balance", { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      console.warn(`[provider-funds] couldn't read the DeepSeek balance: HTTP ${res.status}`);
      return null;
    }
    const body = (await res.json()) as { is_available?: boolean; balance_infos?: Array<{ currency?: string; total_balance?: string }> };
    const infos = body.balance_infos ?? [];
    const info = infos.find((i) => i.currency === "USD") ?? infos.find((i) => i.currency === "CNY");
    const amount = Number(info?.total_balance);
    if (!info || !Number.isFinite(amount) || typeof body.is_available !== "boolean") {
      console.warn("[provider-funds] couldn't read the DeepSeek balance: unexpected reply");
      return null;
    }
    return { available: body.is_available, amount, currency: info.currency as "USD" | "CNY" };
  } catch (e) {
    console.warn(`[provider-funds] couldn't read the DeepSeek balance: ${(e as Error).message}`);
    return null;
  }
}

/**
 * Does the DeepSeek account answer? A 1-token call, used when the balance can't be read, so a pause still clears
 * by itself if the balance endpoint changes. True when it works, false when it's out of funds, null otherwise.
 */
export async function probeDeepSeek(env: Env = process.env, fetcher: typeof fetch = fetch): Promise<boolean | null> {
  const key = env.DEEPSEEK_API_KEY;
  if (!key) return null;
  try {
    const res = await fetcher("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL_IDS.cheap, max_tokens: 1, messages: [{ role: "user", content: "ok" }] }),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) return true;
    const text = await res.text().catch(() => "");
    return res.status === 402 || /Insufficient Balance/i.test(text) ? false : null;
  } catch {
    return null;
  }
}

/** Does the Anthropic account answer? A 1-token call: true when it works, false when it's out of funds, null otherwise. */
export async function probeAnthropic(env: Env = process.env, fetcher: typeof fetch = fetch): Promise<boolean | null> {
  const key = env.ANTHROPIC_API_KEY;
  if (!key) return null;
  try {
    const res = await fetcher("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL_IDS.strong, max_tokens: 1, messages: [{ role: "user", content: "ok" }] }),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) return true;
    const text = await res.text().catch(() => "");
    return res.status === 402 || /billing_error|credit balance is too low/i.test(text) ? false : null;
  } catch {
    return null;
  }
}

export function lowBalanceLine(currency: "USD" | "CNY", env: Env = process.env): number {
  const set = Number(env.DEEPSEEK_LOW_BALANCE);
  return env.DEEPSEEK_LOW_BALANCE !== undefined && Number.isFinite(set) && set >= 0 ? set : LOW_BALANCE[currency];
}

/**
 * The worker's periodic provider checks (D177), safe to call on every tick from every process: each check is claimed
 * in the database, so it runs once per interval in total.
 * - A paused provider is probed every 3 minutes and resumed when it works.
 * - DeepSeek's balance is read every 5 minutes: below the line the owner is told once (re-armed when it recovers),
 *   and `is_available: false` pauses builds before any of them fails.
 * Returns whether builds were resumed, so the worker can look for held jobs straight away.
 */
export async function runProviderChecks(db: Db, env: Env = process.env, fetcher: typeof fetch = fetch, now = new Date()): Promise<{ resumed: boolean }> {
  let resumed = false;
  const paused = await db.select().from(providerStatus).where(isNotNull(providerStatus.pausedAt));
  for (const row of paused) {
    const provider = row.provider as Provider;
    if (!(await claim(db, provider, "lastProbeAt", PROBE_EVERY_MS, now))) continue;
    if (provider === "deepseek") {
      const b = await readDeepSeekBalance(env, fetcher);
      if (b) await recordBalance(db, b, now);
      if (b?.available && b.amount >= RESUME_FLOOR[b.currency]) resumed = (await resumeProvider(db, provider, `balance ${b.amount} ${b.currency}`, env, fetcher)) || resumed;
      else if (!b && (await probeDeepSeek(env, fetcher)) === true) resumed = (await resumeProvider(db, provider, "a test call worked", env, fetcher)) || resumed;
    } else if ((await probeAnthropic(env, fetcher)) === true) {
      resumed = (await resumeProvider(db, provider, "a test call worked", env, fetcher)) || resumed;
    }
  }
  if (env.DEEPSEEK_API_KEY && (await claim(db, "deepseek", "lastBalanceCheckAt", BALANCE_EVERY_MS, now))) {
    const b = await readDeepSeekBalance(env, fetcher);
    if (b) {
      await recordBalance(db, b, now);
      if (!b.available) await pauseProvider(db, "deepseek", `DeepSeek reports the balance can't pay for calls (${b.amount} ${b.currency}).`, env, fetcher);
      const line = lowBalanceLine(b.currency, env);
      if (b.amount < line) {
        const armed = await db
          .update(providerStatus)
          .set({ lowAlertSentAt: now })
          .where(and(eq(providerStatus.provider, "deepseek"), isNull(providerStatus.lowAlertSentAt)))
          .returning({ provider: providerStatus.provider });
        if (armed.length) {
          console.warn(`[provider-funds] DeepSeek balance low: ${b.amount} ${b.currency}`);
          void sendTelegram(`GoodBuild: the DeepSeek balance is low: ${b.amount.toFixed(2)} ${b.currency} (alert line ${line} ${b.currency}). Top it up soon, or new builds will pause when it runs out.`, env, fetcher).catch(() => false);
        }
      } else {
        // Topped up: the next drop below the line alerts again.
        await db.update(providerStatus).set({ lowAlertSentAt: null }).where(and(eq(providerStatus.provider, "deepseek"), isNotNull(providerStatus.lowAlertSentAt)));
      }
    }
  }
  return { resumed };
}

async function recordBalance(db: Db, b: Balance, now: Date) {
  await db.update(providerStatus).set({ lastBalance: String(b.amount), balanceCurrency: b.currency, updatedAt: now }).where(eq(providerStatus.provider, "deepseek"));
}
