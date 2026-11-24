"use client";
import * as React from "react";
import Link from "next/link";
import { useSendGate } from "@/components/auth/send-gate";
import { useGoodIdVerify } from "@/components/auth/use-goodid-verify";
import { FlowstateVote } from "@/components/hackathon/flowstate-vote";
import { useAuth } from "@/lib/auth/context";
import { cn } from "@/lib/utils";

function Step({ n, title, done, active, children }: { n: number; title: string; done: boolean; active: boolean; children?: React.ReactNode }) {
  return (
    <li className={cn("rounded-block p-5", done ? "bg-tint" : active ? "bg-tint shadow-card" : "bg-grey-100/50 opacity-60")}>
      <div className="flex items-center gap-3">
        <span className={cn("flex size-7 items-center justify-center rounded-full text-sm font-semibold", done ? "bg-violet text-white" : "bg-surface text-violet")}>{done ? "✓" : n}</span>
        <h2 className="text-base font-semibold">{title}</h2>
      </div>
      {active && !done && <div className="mt-4 space-y-3">{children}</div>}
    </li>
  );
}

export const VOTE_PATH = "/vote";

/** Sign in, verify with GoodDollar, one-tap vote split with GoodCash (D155, D158). Each step opens when the one before it is done. */
export function VoteSteps() {
  const auth = useAuth();
  const { openConnect } = useSendGate();
  const user = auth.user;
  const [verifiedHere, setVerifiedHere] = React.useState(false);
  const [voted, setVoted] = React.useState(false);
  const verified = Boolean(user?.verified) || verifiedHere;
  const { busy, note, showLinkGuide, verify } = useGoodIdVerify(
    () => setVerifiedHere(true),
    () => `${window.location.origin}${VOTE_PATH}`,
  );

  if (!auth.ready) return <p role="status" className="mt-8 text-sm text-grey-600">Loading…</p>;
  const signedIn = Boolean(user);
  return (
    <>
      <ol className="mt-8 space-y-3">
        <Step n={1} title="Sign in" done={signedIn} active={!signedIn}>
          <p className="text-sm text-grey-600">Use your email, or connect a wallet.</p>
          <button type="button" onClick={openConnect} className="rounded-full bg-violet px-6 py-3 text-sm font-medium text-white outline-none focus-visible:shadow-focus">
            Sign in to start
          </button>
        </Step>
        <Step n={2} title="Verify you&rsquo;re a real person with GoodDollar" done={verified} active={signedIn}>
          <p className="text-sm text-grey-600">A quick face check, once. It stops one person claiming twice.</p>
          <button type="button" disabled={busy} onClick={() => void verify()} className="rounded-full bg-violet px-6 py-3 text-sm font-medium text-white outline-none focus-visible:shadow-focus disabled:opacity-60">
            {busy ? "Checking…" : "Verify with GoodDollar"}
          </button>
          {note && (
            <p role="alert" className="text-sm text-danger">
              {note}
              {showLinkGuide && " If you verified with another wallet, link it first, then try again."}
            </p>
          )}
        </Step>
        <Step n={3} title="Vote for GoodBuild and GoodCash" done={voted} active={signedIn && verified}>
          <p className="text-sm text-grey-600">One tap. We check you&rsquo;re eligible and split all your votes equally between GoodBuild and our partner GoodCash. We cover the network fee.</p>
          <FlowstateVote label="Tap to vote" verifyHref={VOTE_PATH} onConfirmed={() => setVoted(true)} />
        </Step>
      </ol>
      {voted && (
        <div className="mt-6 rounded-block bg-violet p-5 text-white">
          <p className="text-lg font-semibold">Thank you for voting!</p>
          <p className="mt-1 text-sm text-white/80">If you&rsquo;re new, your free credits are added and ready to build with.</p>
          <Link href="/home" className="mt-4 inline-block rounded-full bg-white px-6 py-3 text-sm font-medium text-ink outline-none focus-visible:shadow-focus">
            Start building →
          </Link>
        </div>
      )}
    </>
  );
}
