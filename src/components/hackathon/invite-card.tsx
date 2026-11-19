"use client";
import * as React from "react";
import { REFERRAL_BONUS_CREDITS, MAX_PAID_REFERRALS } from "@/lib/hackathon-referral";

interface Summary {
  code: string;
  invited: number;
  earned: number;
  waiting: number;
}

/** "Invite a builder" (D136): a link to copy, and how many invites have paid off. */
export function InviteCard() {
  const [summary, setSummary] = React.useState<Summary | null>(null);
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    let stopped = false;
    void fetch("/api/hackathon/referral", { cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as Summary | null) : null))
      .catch(() => null)
      .then((s) => {
        if (!stopped) setSummary(s);
      });
    return () => {
      stopped = true;
    };
  }, []);
  if (!summary) return null;
  const link = `${window.location.origin}/hackathon?ref=${summary.code}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="rounded-card bg-tint p-6 shadow-card">
      <p className="text-[11px] font-semibold uppercase tracking-[.18em] text-violet">Invite a builder</p>
      <h3 className="display mt-2 text-lg font-bold">You and your friend both get {REFERRAL_BONUS_CREDITS} credits</h3>
      <p className="mt-2 text-sm text-grey-600">
        When someone you invite registers and deploys their first app, you both get {REFERRAL_BONUS_CREDITS} build credits. Up to {MAX_PAID_REFERRALS} friends can earn you the bonus.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input readOnly value={link} aria-label="Your invite link" onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 rounded-block bg-surface px-4 py-3 text-sm outline-none focus-visible:shadow-focus" />
        <button type="button" onClick={() => void copy()} className="rounded-full bg-violet px-6 py-3 text-sm font-medium text-white outline-none focus-visible:shadow-focus">
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>
      <p className="mt-3 text-xs text-grey-600">
        {summary.invited} invited · {summary.earned} paid you · {summary.waiting} waiting
      </p>
    </div>
  );
}
