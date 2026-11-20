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

/**
 * Whether this person is a FUTMinna member (D161): they registered from a FUTMinna page, joined with the
 * button, or entered a FUTMinna project. The record is their FUTMinna signup row. `null` while loading.
 */
function useFutminnaMember(userId: string) {
  const [member, setMember] = React.useState<boolean | null>(null);
  const check = React.useCallback(async () => {
    const row = await fetch("/api/hackathon/participants?event=futminna", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    // The route answers with the main signup when there is no FUTMinna one, so check whose row it is.
    setMember(row?.hackathon === HACKATHON_EVENTS.futminna.id);
  }, []);
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads membership after mount
    void check();
  }, [check, userId]);
  return { member, recheck: check };
}

function Signed({ userId }: { userId: string }) {
  const claim = useHackathonClaim(userId, () => undefined);
  const router = useRouter();
  // FUTMinna members land on their own hackathon's tabs (D161); the switch brings them back here.
  const { member } = useFutminnaMember(userId);
  // `?stay` is set by the hackathon switch: someone who picked the main hackathon stays on it.
  const [stay] = React.useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("stay"));
  const toFutminna = Boolean(member) && !stay;
  React.useEffect(() => {
    if (toFutminna) router.replace(HACKATHON_EVENTS.futminna.app);
  }, [toFutminna, router]);
  if (toFutminna) return <p role="status">Opening your FUTMinna hackathon…</p>;
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
 * person), so the steps are the same, and registering here makes the person a FUTMinna member. Someone
 * registered for the main hackathon only joins with a button, so just looking at this tab changes
 * nothing about where their hackathon opens (D161).
 */
function FutminnaSigned({ userId }: { userId: string }) {
  const claim = useHackathonClaim(userId, () => undefined);
  const { member, recheck } = useFutminnaMember(userId);
  const [joining, setJoining] = React.useState(false);
  const [joinError, setJoinError] = React.useState("");
  const app = HACKATHON_EVENTS.futminna.app;
  async function join() {
    setJoining(true);
    setJoinError("");
    try {
      const res = await fetch("/api/hackathon/participants?event=futminna&join=1", { method: "POST" });
      const row = res.ok ? await res.json() : null;
      if (!row) throw new Error("Add your email on the main hackathon’s Get started first, then join here.");
      await recheck();
    } catch (e) {
      setJoinError((e as Error).message);
    } finally {
      setJoining(false);
    }
  }
  if (!claim.status || member === null) return <p role="status">Loading your hackathon status…</p>;
  if (!claim.status.registered) return <RegisterSteps />;
  if (!member)
    return (
      <div className="rounded-card bg-surface p-8 shadow-card">
        <p className="text-[11px] font-semibold uppercase tracking-[.18em] text-violet">FUTMinna hackathon</p>
        <h2 className="display mt-3 text-[24px] font-extrabold sm:text-[32px]">FUTMinna student? Join this hackathon.</h2>
        <p className="mt-3 max-w-xl text-grey-600">
          You’re registered for the main hackathon. FUTMinna has its own leaderboard and a ₦
          {FUTMINNA.scholarshipNaira.toLocaleString("en-US")} scholarship. Your credits carry over. Once you join, your hackathon
          opens here, and you can still switch back.
        </p>
        <button
          type="button"
          disabled={joining}
          onClick={() => void join()}
          className="mt-5 rounded-full bg-violet px-6 py-3 text-sm font-medium text-white outline-none focus-visible:shadow-focus disabled:opacity-60"
        >
          {joining ? "Joining…" : "Join the FUTMinna hackathon"}
        </button>
        {joinError && <p role="alert" className="mt-3 text-sm text-danger">{joinError}</p>}
      </div>
    );
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
