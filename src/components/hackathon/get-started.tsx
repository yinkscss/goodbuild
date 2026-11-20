"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FUTMINNA, HACKATHON_EVENTS } from "@/lib/hackathon-events";
import { useHackathonEvent } from "./use-event";
import { useAuth } from "@/lib/auth/context";
import { InviteFriendsCard } from "@/components/referral/invite-card";
import { Quests } from "./quests";
import { RegisterSteps } from "./register-steps";
import { DEPLOY_CREDITS, START_CREDITS, useHackathonClaim } from "./use-hackathon-claim";

const NEXT = [
  { href: "/home/hackathon/project", title: "My project", body: "Add your app and publish it so people can approve it." },
  { href: "/home/hackathon/leaderboard", title: "Leaderboard", body: "See the top 20 and what every project is earning." },
  { href: "/home/hackathon/vote", title: "Vote", body: "Use all 3 approvals on one project or spread them around." },
];

/**
 * "Get started" (D155): the four registration steps until the person has registered, then a short
 * summary of where they stand. Registered people never see the steps again.
 */
export function GetStarted() {
  const { user, ready } = useAuth();
  const { event } = useHackathonEvent();
  if (!ready) return <p role="status">Loading…</p>;
  if (!user) return <RegisterSteps />;
  if (event === "futminna") return <FutminnaSigned key={user.id} userId={user.id} />;
  return <Signed key={user.id} userId={user.id} />;
}

/** True when this person's project is entered in FUTMinna and not in the main hackathon (D160). */
function useFutminnaBuilder(userId: string) {
  const [yes, setYes] = React.useState(false);
  React.useEffect(() => {
    let stopped = false;
    const mine = (q: string) =>
      fetch(`/api/hackathon/projects?mine=1${q}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
    void Promise.all([mine(""), mine("&event=futminna")]).then(([main, futminna]) => {
      if (!stopped && !main && futminna) setYes(true);
    });
    return () => {
      stopped = true;
    };
  }, [userId]);
  return yes;
}

function Signed({ userId }: { userId: string }) {
  const claim = useHackathonClaim(userId, () => undefined);
  const router = useRouter();
  // A FUTMinna builder lands on their own hackathon's tabs; the switch brings them back here.
  const futminnaBuilder = useFutminnaBuilder(userId);
  React.useEffect(() => {
    // `?stay` is set by the hackathon switch: someone who picked the main hackathon stays on it.
    if (futminnaBuilder && !new URLSearchParams(window.location.search).has("stay"))
      router.replace(HACKATHON_EVENTS.futminna.app);
  }, [futminnaBuilder, router]);
  if (!claim.status) return <p role="status">Loading your hackathon status…</p>;
  if (!claim.status.registered) return <RegisterSteps />;
  const { startCredits, deployCredits, deployPending, referralPending } = claim.status;
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
          {(deployPending || referralPending) && (
            <button
              type="button"
              disabled={claim.busy}
              onClick={() => void claim.run()}
              className="rounded-full bg-white/15 px-6 py-3 text-sm font-medium text-white outline-none hover:bg-white/25 focus-visible:shadow-focus disabled:opacity-60"
            >
              {claim.busy ? "Checking…" : deployPending ? `I’ve deployed · claim ${DEPLOY_CREDITS} more` : "Claim your invite bonus"}
            </button>
          )}
        </div>
        {claim.error && <p role="alert" className="mt-3 text-sm">{claim.error}</p>}
      </div>
      <Quests registered deployClaimed={deployCredits > 0} />
      <InviteFriendsCard />
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

const FUTMINNA_NEXT = [
  { path: "/project", title: "My project", body: "Enter your app or game and publish it so people can approve it." },
  { path: "/leaderboard", title: "Leaderboard", body: `The top ${FUTMINNA.shortlist} by approvals make the shortlist.` },
  { path: "/vote", title: "Vote", body: "Use your 3 FUTMinna approvals on the projects you like best." },
];

/**
 * FUTMinna's Get started (D160). Registration and credits are the main hackathon's (one grant per
 * person), so the steps are the same; once registered, the person is on the FUTMinna list too.
 */
function FutminnaSigned({ userId }: { userId: string }) {
  const claim = useHackathonClaim(userId, () => undefined);
  const app = HACKATHON_EVENTS.futminna.app;
  const registered = Boolean(claim.status?.registered);
  React.useEffect(() => {
    if (registered) void fetch("/api/hackathon/participants?event=futminna&join=1", { method: "POST" }).catch(() => undefined);
  }, [registered]);
  if (!claim.status) return <p role="status">Loading your hackathon status…</p>;
  if (!claim.status.registered) return <RegisterSteps />;
  const { startCredits, deployCredits, deployPending } = claim.status;
  return (
    <div className="grid gap-4">
      <div className="rounded-card bg-violet p-8 text-white shadow-card">
        <p className="text-[11px] font-semibold uppercase tracking-[.18em] text-white/70">FUTMinna hackathon</p>
        <h2 className="display mt-3 text-[28px] font-extrabold leading-[.95] sm:text-[40px]">You’re in. Build to win the scholarship.</h2>
        <p className="mt-3 max-w-xl text-white/80">
          ₦{FUTMINNA.scholarshipNaira.toLocaleString("en-US")} scholarship for the best GoodDollar app or game. The top {FUTMINNA.shortlist} by
          approvals make the shortlist, and {FUTMINNA.judges} pick the winner after voting closes on 10 Dec.
        </p>
        <p className="mt-2 text-sm text-white/70">
          {startCredits + deployCredits} build credits granted.{" "}
          {deployPending ? `Deploy your first app to Celo to claim ${DEPLOY_CREDITS} more.` : "Both parts are claimed."}
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
      <div className="grid gap-4 sm:grid-cols-3">
        {FUTMINNA_NEXT.map((n) => (
          <Link key={n.path} href={`${app}${n.path}`} className="rounded-card bg-surface p-6 shadow-card outline-none hover:shadow-pop focus-visible:shadow-focus">
            <p className="text-[11px] font-semibold uppercase tracking-[.18em] text-violet">Next</p>
            <h3 className="display mt-2 text-lg font-bold">{n.title}</h3>
            <p className="mt-2 text-sm text-grey-600">{n.body}</p>
          </Link>
        ))}
      </div>
      <p className="text-xs text-grey-600">
        Your app or game needs a meaningful GoodDollar (G$) integration. Each builder enters one hackathon. The winner shows they’re a
        FUTMinna student before the scholarship is paid.
      </p>
    </div>
  );
}
