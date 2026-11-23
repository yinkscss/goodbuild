import "server-only";

import { sendTelegram } from "@/server/support/ticket";

/** At most one alert per this long per worker: every build fails while the account is empty. */
export const ALERT_EVERY_MS = 30 * 60_000;

let lastSent = Number.NEGATIVE_INFINITY;

/**
 * Tell the owner on Telegram that GoodBuild's AI provider account is out of money (23 Nov 2026). On that day the
 * DeepSeek balance hit zero and every build failed for six hours before anyone noticed. Fire and forget: a failed
 * alert never changes the build's outcome.
 */
export function alertProviderFunds(detail: string, env: Record<string, string | undefined> = process.env, fetcher: typeof fetch = fetch, now = Date.now()): boolean {
  if (now - lastSent < ALERT_EVERY_MS) return false;
  lastSent = now;
  const text = `GoodBuild: builds are failing because the AI provider account is out of funds. Top it up to bring builds back.\n\n${detail.slice(0, 500)}`;
  void sendTelegram(text, env, fetcher).catch(() => false);
  console.error("[provider-funds]", detail);
  return true;
}

export function resetProviderAlertForTests() {
  lastSent = Number.NEGATIVE_INFINITY;
}
