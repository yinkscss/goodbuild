"use client";
import Link from "next/link";
import { useAuth } from "@/lib/auth/context";
import { Quests } from "./quests";
import { RegisterSteps } from "./register-steps";
import { DEPLOY_CREDITS, START_CREDITS, useHackathonClaim } from "./use-hackathon-claim";

const NEXT = [
  { href: "/home/hackathon/project", title: "My project", body: "Add your app and publish it so people can approve it." },
  { href: "/home/hackathon/leaderboard", title: "Leaderboard", body: "See the top 20 and what every project is earning." },
  { href: "/home/hackathon/vote", title: "Vote", body: "Approve up to 3 projects you’d actually use." },
];

/**
 * "Get started" (D132): the four registration steps until the person has registered, then a short
 * summary of where they stand. Registered people never see the steps again.
 */
export function GetStarted() {
  const { user, ready } = useAuth();
  if (!ready) return <p role="status">Loading…</p>;
  if (!user) return <RegisterSteps />;
  return <Signed key={user.id} userId={user.id} />;
}

function Signed({ userId }: { userId: string }) {
  const claim = useHackathonClaim(userId, () => undefined);
  if (!claim.status) return <p role="status">Loading your hackathon status…</p>;
  if (!claim.status.registered) return <RegisterSteps />;
  const { startCredits, deployCredits, deployPending } = claim.status;
  return (
    <div className="grid gap-4">
      <div className="rounded-card bg-violet p-8 text-white shadow-card">
        <p className="text-[11px] font-semibold uppercase tracking-[.18em] text-white/70">You’re registered</p>
        <h2 className="display mt-3 text-[28px] font-extrabold leading-[.95] sm:text-[40px]">You’re in the hackathon.</h2>
        <p className="mt-3 max-w-xl text-white/80">
          {startCredits + deployCredits} build credits granted. {deployPending ? `Deploy your first app to Celo and claim ${DEPLOY_CREDITS} more.` : "Both parts are claimed."}
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link href="/" className="rounded-full bg-white px-6 py-3 text-sm font-medium text-ink outline-none focus-visible:shadow-focus">Start building →</Link>
          {deployPending && (
            <button
              type="button"
              disabled={claim.busy}
              onClick={() => void claim.run()}
              className="rounded-full bg-white/15 px-6 py-3 text-sm font-medium text-white outline-none hover:bg-white/25 focus-visible:shadow-focus disabled:opacity-60"
            >
              {claim.busy ? "Checking…" : `I’ve deployed · claim ${DEPLOY_CREDITS} more`}
            </button>
          )}
        </div>
        {claim.error && <p role="alert" className="mt-3 text-sm">{claim.error}</p>}
      </div>
      <Quests registered deployClaimed={deployCredits > 0} />
      <div className="grid gap-4 sm:grid-cols-3">
        {NEXT.map((n) => (
          <Link key={n.href} href={n.href} className="rounded-card bg-surface p-6 shadow-card outline-none hover:shadow-pop focus-visible:shadow-focus">
            <p className="text-[11px] font-semibold uppercase tracking-[.18em] text-violet">Next</p>
            <h3 className="display mt-2 text-lg font-bold">{n.title}</h3>
            <p className="mt-2 text-sm text-grey-600">{n.body}</p>
          </Link>
        ))}
      </div>
      <p className="text-xs text-grey-600">{START_CREDITS} credits on registering, {DEPLOY_CREDITS} after your first Celo deploy.</p>
    </div>
  );
}
