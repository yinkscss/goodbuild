"use client";
import * as React from "react";
import { REFERRAL_BONUS_CREDITS, friendStatus, invitePath } from "@/lib/referral";
import { shortAddress } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Friend {
  wallet: string;
  joinedAt: string;
  verified: boolean;
  voted: boolean;
  rewarded: boolean;
}
interface Summary {
  code: string;
  bonus: number;
  max: number;
  invited: number;
  voted: number;
  earnedCredits: number;
  friends: Friend[];
}

const TONE = { ok: "bg-success/10 text-success", wait: "bg-warning/10 text-warning", new: "bg-tint text-violet" } as const;

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-card bg-surface p-4 shadow-card">
      <p className="display text-2xl font-bold text-violet tabular-nums">{value.toLocaleString()}</p>
      <p className="mt-1 text-xs text-grey-600">{label}</p>
    </div>
  );
}

function HowItWorks({ bonus }: { bonus: number }) {
  const steps = [
    ["Friend joins with your link", "Automatic, nothing to enter"],
    ["Verifies with GoodDollar", "Proves they are a real person"],
    ["Votes for GoodBuild", `You both get ${bonus} credits`],
  ];
  return (
    <section aria-label="How it works" className="rounded-card bg-surface p-5 shadow-card">
      <h2 className="text-sm font-semibold">How it works</h2>
      <ol className="mt-3 space-y-3">
        {steps.map(([title, sub], i) => (
          <li key={title} className="flex gap-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-tint text-[11px] font-semibold text-violet">{i + 1}</span>
            <span>
              <span className="block text-sm font-medium">{title}</span>
              <span className="block text-xs text-grey-600">{sub}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The Referrals page: your link first, then how it's going, then the people (D155). */
export function ReferralsHub() {
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
  if (!loaded) return <div className="skeleton mt-6 h-[200px] rounded-card motion-reduce:animate-none" />;

  if (!summary)
    return (
      <div className="mt-6 space-y-4">
        <section aria-label="Get your link" className="rounded-card bg-violet p-6 text-white">
          <p className="text-[11px] font-semibold uppercase tracking-[.18em] text-violet-mist">Get your link</p>
          <h2 className="display mt-2 text-xl font-bold">Verify to start inviting</h2>
          <p className="mt-2 max-w-[52ch] text-sm text-violet-soft">Verifying with GoodDollar proves you are a real person. Then you get your own link, and you both earn credits.</p>
          <a href="/hackathon#register" className="mt-4 inline-block rounded-full bg-surface px-6 py-3 text-sm font-medium text-violet outline-none focus-visible:shadow-focus">
            Verify with GoodDollar
          </a>
        </section>
        <HowItWorks bonus={REFERRAL_BONUS_CREDITS} />
      </div>
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
  const verified = summary.friends.filter((f) => f.verified).length;
  const rewarded = summary.friends.filter((f) => f.rewarded).length;

  return (
    <div className="mt-6 space-y-4">
      <section aria-label="Your invite link" className="rounded-card bg-violet p-6 text-white">
        <p className="text-[11px] font-semibold uppercase tracking-[.18em] text-violet-mist">Your invite link</p>
        <h2 className="display mt-2 text-xl font-bold">You and your friend both get {summary.bonus} credits</h2>
        <p className="mt-2 max-w-[52ch] text-sm text-violet-soft">
          When a friend verifies with GoodDollar and votes for us, you both get credits. Up to {summary.max} friends can earn you credits.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <input readOnly value={link} aria-label="Your invite link" onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 rounded-block bg-surface px-4 py-3 font-mono text-xs text-ink outline-none focus-visible:shadow-focus" />
          <button type="button" onClick={() => void copy()} className="rounded-full bg-surface px-6 py-3 text-sm font-medium text-violet outline-none focus-visible:shadow-focus">
            {copied ? "Copied" : "Copy link"}
          </button>
          {canShare && (
            <button type="button" onClick={() => void share()} className="rounded-full bg-ink px-6 py-3 text-sm font-medium text-white outline-none focus-visible:shadow-focus">
              Share
            </button>
          )}
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat value={summary.invited} label="Friends joined" />
        <Stat value={verified} label="Verified" />
        <Stat value={rewarded} label="Rewarded" />
        <Stat value={summary.earnedCredits} label="Credits earned" />
      </div>

      <div className="grid gap-4 md:grid-cols-[1.5fr_1fr]">
        <section aria-label="Your friends" className="rounded-card bg-surface p-5 shadow-card">
          <h2 className="text-sm font-semibold">Your friends</h2>
          {summary.friends.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm font-medium">No friends yet</p>
              <p className="mt-1 text-sm text-grey-600">Send your link to one friend. They show up here the moment they join.</p>
            </div>
          ) : (
            <ul className="mt-2 divide-y divide-hairline">
              {summary.friends.map((f) => {
                const st = friendStatus(f);
                return (
                  <li key={f.wallet} className="flex items-center gap-3 py-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-tint text-xs font-semibold text-violet">{f.wallet.slice(2, 4).toUpperCase()}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{shortAddress(f.wallet)}</span>
                      <span className="block text-xs text-grey-600">{st.detail} · {new Date(f.joinedAt).toLocaleDateString()}</span>
                    </span>
                    <span className={cn("whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium", TONE[st.tone])}>{st.label}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <HowItWorks bonus={summary.bonus} />
      </div>
    </div>
  );
}
