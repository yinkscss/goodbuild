"use client";
import * as React from "react";
import { invitePath } from "@/lib/referral";

interface Summary {
  code: string;
  bonus: number;
  max: number;
  invited: number;
  voted: number;
  earnedCredits: number;
}

/** "Invite friends" on the home dashboard (D153): a link to copy or share, and how it's going. */
export function InviteFriendsCard() {
  const [summary, setSummary] = React.useState<Summary | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    let stopped = false;
    void fetch("/api/referral", { cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as Summary | null) : null))
      .catch(() => null)
      .then((s) => {
        if (stopped) return;
        setSummary(s);
        setLoaded(true);
      });
    return () => {
      stopped = true;
    };
  }, []);
  if (!loaded) return null;
  if (!summary)
    return (
      <section aria-label="Invite friends" className="mt-12 rounded-card bg-tint p-6 shadow-card">
        <p className="text-[11px] font-semibold uppercase tracking-[.18em] text-violet">Invite friends</p>
        <h2 className="display mt-2 text-lg font-bold">Verify with GoodDollar to get your invite link</h2>
        <p className="mt-2 text-sm text-grey-600">Once you&rsquo;re verified, send your link to friends and you both get free credits.</p>
        <a href="/hackathon#register" className="mt-4 inline-block rounded-full bg-violet px-6 py-3 text-sm font-medium text-white outline-none focus-visible:shadow-focus">
          Verify with GoodDollar
        </a>
      </section>
    );
  const link = `${window.location.origin}${invitePath(summary.code)}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  const share = async () => {
    try {
      await navigator.share({ title: "GoodBuild", text: "Build an app just by describing it. Join me on GoodBuild:", url: link });
    } catch {
      await copy();
    }
  };
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  return (
    <section aria-label="Invite friends" className="mt-12 rounded-card bg-tint p-6 shadow-card">
      <p className="text-[11px] font-semibold uppercase tracking-[.18em] text-violet">Invite friends</p>
      <h2 className="display mt-2 text-lg font-bold">You and your friend both get {summary.bonus} credits</h2>
      <p className="mt-2 text-sm text-grey-600">
        Send your link. When your friend verifies with GoodDollar and votes for us, you both get {summary.bonus} credits. Up to {summary.max} friends can earn you credits.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input readOnly value={link} aria-label="Your invite link" onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 rounded-block bg-surface px-4 py-3 text-sm outline-none focus-visible:shadow-focus" />
        <button type="button" onClick={() => void copy()} className="rounded-full bg-violet px-6 py-3 text-sm font-medium text-white outline-none focus-visible:shadow-focus">
          {copied ? "Copied" : "Copy link"}
        </button>
        {canShare && (
          <button type="button" onClick={() => void share()} className="rounded-full bg-surface px-6 py-3 text-sm font-medium text-violet outline-none focus-visible:shadow-focus">
            Share
          </button>
        )}
      </div>
      <p className="mt-3 text-xs text-grey-600">
        {summary.invited} joined · {summary.voted} voted · {summary.earnedCredits} credits earned
      </p>
    </section>
  );
}
