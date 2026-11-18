"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, Gift, Loader2 } from "lucide-react";

import { useGoodIdVerify } from "@/components/auth/use-goodid-verify";
import { Button } from "@/components/ui/button";
import { LINK_WALLET_GUIDE } from "@/lib/goodid";
import { FlowstateVote } from "@/components/hackathon/flowstate-vote";
import { UbiClaimError, useClaimUbi } from "./use-claim-ubi";
import { cn } from "@/lib/utils";

/** What GET /api/credits/free answers (FreeStatus in server/credits/free-grants.ts, dates as strings). */
export interface FreeStatusJson {
  policy: "verified" | "legacy";
  verified: boolean;
  welcomeDone: boolean;
  /** The welcome waits for a FlowState vote (D125). */
  welcomeNeedsVote?: boolean;
  welcomeCredits: number;
  refillCredits: number;
  refill: {
    state: "available" | "claimed_today" | "week_full" | "month_full";
    leftThisWeek: number;
    leftThisMonth: number;
    nextAt: string | null;
    claimedDays: string[];
  } | null;
  budgetFull: boolean;
  refillNeedsUbi: boolean;
  ubiClaimedToday: boolean | null;
  /** Why a refill can't be claimed now, beyond the day/week/month limits. */
  refillBlocked: "not_low" | "inactive" | null;
  refillBelowCredits: number;
}

const MONTH_SLOTS = 5;

async function loadStatus(): Promise<FreeStatusJson | null> {
  const res = await fetch("/api/credits/free", { cache: "no-store", credentials: "same-origin" });
  return res.ok ? ((await res.json()) as FreeStatusJson) : null;
}

/** "Mon 24 Nov" for the next reset. */
function shortDay(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

/** The date GoodDollar's current day began on (its days run noon to noon UTC), as YYYY-MM-DD. */
function gdToday() {
  return new Date(Date.now() - 12 * 3_600_000).toISOString().slice(0, 10);
}

function refillLine(refill: NonNullable<FreeStatusJson["refill"]>) {
  if (refill.state === "claimed_today") return "Claimed today. Your next refill is after noon UTC.";
  if (refill.state === "week_full") return `This week's refills are used. Back on ${refill.nextAt ? shortDay(refill.nextAt) : "Monday"}.`;
  if (refill.state === "month_full") return `This month's refills are used. Back on ${refill.nextAt ? shortDay(refill.nextAt) : "the 1st"}.`;
  return `${refill.leftThisMonth} of ${MONTH_SLOTS} left this month.`;
}

/**
 * Free credits (D123). Not verified: verify with GoodDollar to get the welcome credits, which the
 * server adds as soon as it sees the verification on-chain. Verified: one tap claims today's G$ UBI
 * in the wallet (when the refill needs it) and then the daily refill,
 * with this month's claims shown as five slots. `compact` is the workspace version: it shows only
 * when there's something to do.
 */
export function FreeCreditsCard({ compact = false, onChange: onChangeProp }: { compact?: boolean; onChange?: () => unknown }) {
  const router = useRouter();
  // Without a handler (the Credits page), re-render the server parts so the balance shows the new credits.
  const onChange = React.useCallback(() => (onChangeProp ? onChangeProp() : router.refresh()), [onChangeProp, router]);
  const [status, setStatus] = React.useState<FreeStatusJson | null>(null);
  const [claiming, setClaiming] = React.useState(false);
  const [note, setNote] = React.useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const [step, setStep] = React.useState<"ubi" | "refill" | null>(null);
  const claimUbi = useClaimUbi();

  const refresh = React.useCallback(async () => {
    const next = await loadStatus().catch(() => null);
    setStatus(next);
    return next;
  }, []);

  const afterVerify = React.useCallback(async () => {
    // The hook's check already posted the welcome credits. Asking again is a safe replay that also
    // retries a grant that failed, and says why if it still can't be paid.
    const res = await fetch("/api/account/goodid", { method: "POST", credentials: "same-origin" }).catch(() => null);
    const body = res ? ((await res.json().catch(() => ({}))) as { welcomeError?: string; needsVote?: boolean }) : {};
    // Still waiting for the FlowState vote (D125): the card itself shows that step next.
    if (body.needsVote) setNote(null);
    else setNote(body.welcomeError ? { text: body.welcomeError, tone: "error" } : { text: "You're verified. Your free credits are in your balance.", tone: "ok" });
    await refresh();
    await onChange?.();
  }, [onChange, refresh]);

  /** The vote landed on-chain: claim the welcome credits it unlocks (D125). */
  const afterVote = React.useCallback(async () => {
    const res = await fetch("/api/account/goodid", { method: "POST", credentials: "same-origin" }).catch(() => null);
    const body = res ? ((await res.json().catch(() => ({}))) as { welcomeError?: string; welcomeMicro?: number }) : {};
    setNote(
      body.welcomeError
        ? { text: body.welcomeError, tone: "error" }
        : { text: `Thank you for voting! ${Math.round((body.welcomeMicro ?? 0) / 10_000)} free credits added.`, tone: "ok" },
    );
    await refresh();
    await onChange?.();
  }, [onChange, refresh]);

  const { busy, note: verifyNote, showLinkGuide, verify } = useGoodIdVerify(afterVerify);

  React.useEffect(() => {
    let stopped = false;
    void Promise.resolve().then(async () => {
      const s = await refresh();
      if (stopped || !s || s.policy !== "verified") return;
      // Verified and maybe already voted (on /hackathon, or on FlowState itself): check the vote on-chain
      // once, quietly, and post the welcome credits, so a voter is never asked to vote again.
      if (s.verified) {
        if (!s.welcomeNeedsVote || s.welcomeDone) return;
        const res = await fetch("/api/account/goodid", { method: "POST", credentials: "same-origin" }).catch(() => null);
        const body = res?.ok ? ((await res.json().catch(() => ({}))) as { welcomeMicro?: number; needsVote?: boolean }) : {};
        if (!stopped && !body.needsVote && body.welcomeMicro) {
          setNote({ text: `Thank you for voting! ${Math.round(body.welcomeMicro / 10_000)} free credits added.`, tone: "ok" });
          await refresh();
          await onChange?.();
        }
        return;
      }
      // Already verified on GoodDollar from before? Check once, quietly, so they never have to ask.
      const res = await fetch("/api/account/goodid", { method: "POST", credentials: "same-origin" }).catch(() => null);
      const body = res?.ok ? ((await res.json().catch(() => ({}))) as { verified?: boolean; welcomeMicro?: number }) : {};
      if (!stopped && body.verified) {
        if (body.welcomeMicro) setNote({ text: `You're already verified with GoodDollar. ${Math.round(body.welcomeMicro / 10_000)} free credits added.`, tone: "ok" });
        await refresh();
        await onChange?.();
      }
    });
    return () => {
      stopped = true;
    };
    // Once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Claim today's G$ UBI first when it's needed and not done, then the refill (D123). */
  async function claim() {
    setClaiming(true);
    setNote(null);
    try {
      if (status?.refillNeedsUbi && status.ubiClaimedToday !== true) {
        setStep("ubi");
        try {
          await claimUbi();
        } catch (error) {
          setNote({ text: error instanceof UbiClaimError ? error.message : "We couldn't claim your G$. Try again in a moment.", tone: "error" });
          return;
        }
      }
      setStep("refill");
      // The server reads the claim from the chain, which can trail the receipt by a few seconds.
      let res: Response | null = null;
      let body: { grantedMicro?: number; error?: string; message?: string } = {};
      for (let i = 0; i < 5; i++) {
        res = await fetch("/api/credits/free/refill", { method: "POST", credentials: "same-origin" });
        body = (await res.json().catch(() => ({}))) as typeof body;
        if (res.ok || body.error !== "ubi_not_claimed" || !status?.refillNeedsUbi) break;
        await new Promise((t) => setTimeout(t, 2000));
      }
      if (!res?.ok) setNote({ text: body.message ?? "We couldn't add your refill. Try again.", tone: "error" });
      else setNote({ text: `Added ${Math.round((body.grantedMicro ?? 0) / 10_000)} credits.`, tone: "ok" });
      await refresh();
      await onChange?.();
    } finally {
      setClaiming(false);
      setStep(null);
    }
  }

  if (!status || status.policy !== "verified") return null;
  const refill = status.refill;
  const votePending = status.verified && status.welcomeNeedsVote && !status.welcomeDone;
  if (compact && status.verified && !votePending && (refill?.state !== "available" || status.refillBlocked) && !note) return null;

  const shell = compact ? "rounded-block bg-tint p-4 text-sm" : "rounded-card bg-surface p-6 shadow-card";
  const message = note ?? (verifyNote ? { text: verifyNote, tone: "error" as const } : null);

  if (!status.verified) {
    return (
      <section className={shell} aria-label="Free credits">
        <p className="flex items-center gap-2 font-semibold text-violet-ink">
          <BadgeCheck className="size-4 shrink-0 text-violet" aria-hidden />
          Get {status.welcomeCredits} free credits
        </p>
        <p className="mt-1 text-sm text-grey-600">
          Verify once with GoodDollar, a free face check that takes about a minute{status.welcomeNeedsVote ? ", then support our project by voting (we cover the network fee)" : ""}. Then, when you&apos;re running low, claim {status.refillCredits} more credits on any day you claim your G$ UBI, up to {MONTH_SLOTS} times a month. Unused free credits expire after 30 days. You get 2 free plans a day now, and 5 once verified.
        </p>
        {status.budgetFull ? (
          <p className="mt-3 text-sm text-grey-600">This month&apos;s free credits are all gone. Verify now and you can claim refills from the 1st.</p>
        ) : null}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button variant="primary" size={compact ? "sm" : "default"} disabled={busy} onClick={() => void verify()}>
            {busy && <Loader2 className="animate-spin motion-reduce:animate-none" />}
            Verify with GoodDollar
          </Button>
          <a href={LINK_WALLET_GUIDE} target="_blank" rel="noreferrer" className="text-xs text-violet hover:underline">
            Already verified on another wallet?
          </a>
        </div>
        {message && <Note {...message} />}
        {showLinkGuide && <p className="mt-1 text-xs text-grey-600">If you verified on another wallet, link this one to it, then press Verify.</p>}
      </section>
    );
  }

  if (votePending) {
    return (
      <section className={shell} aria-label="Unlock free credits">
        <p className="flex items-center gap-2 font-semibold text-violet-ink">
          <Gift className="size-4 shrink-0 text-violet" aria-hidden />
          Unlock {status.welcomeCredits} free credits
        </p>
        <p className="mt-1 text-sm text-grey-600">
          You&apos;re verified. Last step: support our project by voting. It takes a minute, and we cover the network fee.
        </p>
        <div className="mt-3">
          <FlowstateVote onConfirmed={() => void afterVote()} />
        </div>
        {message && <Note {...message} />}
      </section>
    );
  }

  if (!refill) return null;
  const used = new Set(refill.claimedDays);
  const today = gdToday();
  const needsUbi = status.refillNeedsUbi && status.ubiClaimedToday !== true;
  const blocked = refill.state === "available" ? status.refillBlocked : null;
  const slots = Array.from({ length: MONTH_SLOTS }, (_, i) => refill.claimedDays[i] ?? null);
  return (
    <section className={shell} aria-label="Daily refill">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-semibold text-violet-ink">
          <Gift className="size-4 shrink-0 text-violet" aria-hidden />
          Daily refill
        </p>
        <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2.5 py-0.5 text-xs font-semibold text-success">
          <BadgeCheck className="size-3.5" aria-hidden /> Verified
        </span>
      </div>
      {!compact && (
        <ol className="mt-4 grid grid-cols-5 gap-1.5" aria-label={`Refills claimed this month: ${used.size} of ${MONTH_SLOTS}`}>
          {slots.map((day, i) => (
            <li
              key={i}
              className={cn(
                "grid h-9 place-items-center rounded-[10px] text-[11px] font-semibold tabular-nums",
                day === today ? "bg-pink text-violet-ink" : day ? "bg-violet text-white" : "bg-tint text-grey-400",
              )}
            >
              {day ? (day === today ? "Today" : shortDay(`${day}T00:00:00Z`).replace(/^\w+ /, "")) : "—"}
            </li>
          ))}
        </ol>
      )}
      <p className="mt-3 text-sm text-grey-600">
        +{status.refillCredits} credits, once a day. {refillLine(refill)}
      </p>
      {blocked === "not_low" && <p className="mt-1 text-sm text-grey-600">Refills are for when you&apos;re running low. You can claim one once you have under {status.refillBelowCredits} credits.</p>}
      {blocked === "inactive" && <p className="mt-1 text-sm text-grey-600">Refills are for people who are building. Finish a build or deploy an app, then come back.</p>}
      {refill.state === "available" && !blocked && needsUbi && (
        <p className="mt-1 text-sm text-grey-600">
          Claim today&apos;s G$ UBI from GoodDollar to unlock it. One tap does both: your wallet claims the G$, then we add the credits. The network fee is a fraction of a cent in CELO.
        </p>
      )}
      {status.budgetFull && refill.state === "available" && <p className="mt-1 text-sm text-grey-600">This month&apos;s free credits are all gone. Refills come back on the 1st.</p>}
      <div className="mt-3">
        <Button variant="primary" size={compact ? "sm" : "default"} disabled={claiming || refill.state !== "available" || status.budgetFull || Boolean(blocked)} onClick={() => void claim()}>
          {claiming && <Loader2 className="animate-spin motion-reduce:animate-none" />}
          {step === "ubi"
            ? "Claiming G$ in your wallet…"
            : step === "refill"
              ? "Adding credits…"
              : blocked
                ? "Not yet"
                : refill.state === "available"
                ? needsUbi
                  ? `Claim G$ + ${status.refillCredits} credits`
                  : `Claim ${status.refillCredits} credits`
                : refill.state === "claimed_today"
                  ? "Claimed today"
                  : "No refills left"}
        </Button>
      </div>
      {message && <Note {...message} />}
    </section>
  );
}

function Note({ text, tone }: { text: string; tone: "ok" | "error" }) {
  return (
    <p className={cn("mt-2 text-xs", tone === "ok" ? "text-success" : "text-danger")} role={tone === "ok" ? "status" : "alert"}>
      {text}
    </p>
  );
}
