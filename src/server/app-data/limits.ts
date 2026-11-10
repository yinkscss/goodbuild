import "server-only";

const KIB = 1024;
const MIB = 1024 * KIB;

/** Sized for one small VPS and about 50 users (D27). See "Decisions for you" in docs/APP_DATA.md. */
export const DEFAULT_LIMITS = {
  maxValueBytes: 16 * KIB,
  maxRowsPerWallet: 1_000,
  maxBytesPerWallet: 2 * MIB,
  maxRowsPerProject: 20_000,
  /** Records from visitors who didn't sign in (D34), well below the app's total so spam can't crowd out the rest. */
  maxAnonRowsPerProject: 2_000,
  maxBytesPerProject: 20 * MIB,
  /** Across every app. New projects and wallets are free, so per-project limits alone don't bound the disk. */
  maxTotalBytes: 1024 * MIB,
  maxSignInBodyBytes: 16 * KIB,
  readsPerIpPerMinute: 300,
  /**
   * Lists with filters, an order or since (D79): each reads up to 500 records, and a live app polls them.
   * Counted per signed-in person in one app, or per address in one app for visitors who aren't signed in
   * (lists use readsPerIpPerMinute the same way), so players sharing a mobile network's address don't
   * share one allowance.
   */
  queriesPerIpPerMinute: 120,
  /** Every list request from one address, across all apps and people: the ceiling under the limits above. */
  listsPerIpCeilingPerMinute: 1200,
  writesPerIpPerMinute: 120,
  writesPerWalletPerMinute: 60,
  /** Writes without sign-in (D34): per IP, and for the whole app. */
  anonWritesPerIpPerMinute: 10,
  anonWritesPerProjectPerMinute: 60,
  requestsPerProjectPerMinute: 1_500,
  noncesPerIpPerMinute: 30,
  noncesPerProjectPerMinute: 300,
  signInsPerIpPerMinute: 20,
  /** Email codes (D35). Per minute in memory; the rest are counted in the database, so a restart doesn't reset them. */
  emailCodesPerIpPerMinute: 5,
  emailCodesPerProjectPerMinute: 30,
  emailVerifiesPerIpPerMinute: 20,
  emailCodesPerEmailPer10Minutes: 3,
  emailCodesPerEmailPerDay: 10,
  emailFailuresPerEmailPerDay: 10,
  emailCodesPerIpPerDay: 20,
  emailCodesPerProjectPerDay: 100,
  /** Across every app, to stay inside the email provider's free tier. EMAIL_DAILY_CAP overrides it. */
  emailCodesSitePerDay: 90,
};

export type AppDataLimits = typeof DEFAULT_LIMITS;

export function limitsFromEnv(env: Record<string, string | undefined> = process.env): AppDataLimits {
  const total = Number(env.APP_DATA_MAX_TOTAL_BYTES);
  const emailCap = env.EMAIL_DAILY_CAP ? Number(env.EMAIL_DAILY_CAP) : NaN;
  return {
    ...DEFAULT_LIMITS,
    ...(total > 0 ? { maxTotalBytes: total } : {}),
    ...(Number.isInteger(emailCap) && emailCap >= 0 ? { emailCodesSitePerDay: emailCap } : {}),
  };
}

const MAX_TRACKED_KEYS = 50_000;

export interface RateLimiter {
  /** Counts one hit. Returns 0 if allowed, or the seconds until the window resets. */
  hit(key: string, limitPerMinute: number, now?: number): number;
  /** The last value of `load`, at most `ttlMs` old. */
  cached<T>(key: string, ttlMs: number, load: () => Promise<T>, now?: number): Promise<T>;
}

/**
 * Fixed one-minute windows, in this process's memory. Production runs one web process (D27), so
 * this is the real count there. With more processes each would allow the full rate.
 */
export function createRateLimiter(): RateLimiter {
  const windows = new Map<string, { count: number; resetAt: number }>();
  const values = new Map<string, { value: unknown; at: number }>();
  return {
    hit(key, limitPerMinute, now = Date.now()) {
      if (windows.size > MAX_TRACKED_KEYS) {
        for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
        if (windows.size > MAX_TRACKED_KEYS) windows.clear();
      }
      const current = windows.get(key);
      if (!current || current.resetAt <= now) {
        windows.set(key, { count: 1, resetAt: now + 60_000 });
        return 0;
      }
      current.count += 1;
      return current.count > limitPerMinute ? Math.max(1, Math.ceil((current.resetAt - now) / 1000)) : 0;
    },
    async cached<T>(key: string, ttlMs: number, load: () => Promise<T>, now = Date.now()) {
      const hit = values.get(key);
      if (hit && now - hit.at < ttlMs) return hit.value as T;
      const value = await load();
      values.set(key, { value, at: now });
      return value;
    },
  };
}
