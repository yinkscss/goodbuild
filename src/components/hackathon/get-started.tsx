"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CAMPUS_EVENTS, campusOf, campusPicking, HACKATHON_EVENTS, type CampusEvent } from "@/lib/hackathon-events";
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
  if (event !== "main") return <CampusSigned key={`${event}:${user.id}`} event={event} userId={user.id} />;
  return <Signed key={user.id} userId={user.id} />;
}

/** Whether this person has a signup row for this campus hackathon. */
async function isMember(event: CampusEvent): Promise<boolean> {
  const row = await fetch(`/api/hackathon/participants?event=${event}`, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  // The route answers with the main signup when there is no campus one, so check whose row it is.
  return row?.hackathon === HACKATHON_EVENTS[event].id;
}

/**
 * Whether this person is a member of a campus hackathon (D161): they registered from its page, joined
 * with the button, or entered a project there. The record is their signup row for it. `null` while loading.
 */
function useCampusMember(userId: string, event: CampusEvent) {
  const [member, setMember] = React.useState<boolean | null>(null);
  const check = React.useCallback(async () => setMember(await isMember(event)), [event]);
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads membership after mount
    void check();
  }, [check, userId]);
  return { member, recheck: check };
}

/**
 * The campus hackathon this person belongs to, if any (D161, D167). Someone in more than one opens on
 * the first in HACKATHON_EVENTS order. `undefined` while loading.
 */
function useCampusHome(userId: string) {
  const [home, setHome] = React.useState<CampusEvent | null | undefined>(undefined);
  React.useEffect(() => {
    let stopped = false;
    void Promise.all(CAMPUS_EVENTS.map(isMember)).then((found) => {
      if (!stopped) setHome(CAMPUS_EVENTS.find((_, i) => found[i]) ?? null);
    });
    return () => {
      stopped = true;
    };
  }, [userId]);
  return home;
}

function Signed({ userId }: { userId: string }) {
  const claim = useHackathonClaim(userId, () => undefined);
  const router = useRouter();
  // Campus members land on their own hackathon's tabs (D161); the switch brings them back here.
  const home = useCampusHome(userId);
  // `?stay` is set by the hackathon switch: someone who picked the main hackathon stays on it.
  const [stay] = React.useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("stay"));
  const toCampus = home && !stay ? home : null;
  React.useEffect(() => {
    if (toCampus) router.replace(HACKATHON_EVENTS[toCampus].app);
  }, [toCampus, router]);
  if (toCampus) return <p role="status">Opening your {campusOf(toCampus).short} hackathon…</p>;
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

function campusNext(event: CampusEvent) {
  const c = campusOf(event);
  const { zone } = HACKATHON_EVENTS[event];
  return [
    { path: "/project", title: "My project", body: "Enter your app or game and publish it so people can approve it." },
    {
      path: "/leaderboard",
      title: "Leaderboard",
      body: c.judged
        ? `The top ${zone} by approvals make the shortlist.`
        : `The top ${c.winners} by approvals win; the next ${zone - c.winners} are waitlisted.`,
    },
    { path: "/vote", title: "Vote", body: `Use your 3 ${c.short} approvals on the projects you like best.` },
  ];
}

/**
 * A campus hackathon's Get started (D160, D167). Registration and credits are the main hackathon's (one
 * grant per person), so the steps are the same, and registering here makes the person a member. Someone
 * registered for the main hackathon only joins with a button, so just looking at this tab changes
 * nothing about where their hackathon opens (D161).
 */
function CampusSigned({ event, userId }: { event: CampusEvent; userId: string }) {
  const claim = useHackathonClaim(userId, () => undefined);
  const { member, recheck } = useCampusMember(userId, event);
  const [joining, setJoining] = React.useState(false);
  const [joinError, setJoinError] = React.useState("");
  const app = HACKATHON_EVENTS[event].app;
  const c = campusOf(event);
  async function join() {
    setJoining(true);
    setJoinError("");
    try {
      const res = await fetch(`/api/hackathon/participants?event=${event}&join=1`, { method: "POST" });
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
        <p className="text-[11px] font-semibold uppercase tracking-[.18em] text-violet">{c.short} hackathon</p>
        <h2 className="display mt-3 text-[24px] font-extrabold sm:text-[32px]">{c.short} student? Join this hackathon.</h2>
        <p className="mt-3 max-w-xl text-grey-600">
          You’re registered for the main hackathon. {c.short} has its own leaderboard, and you could win {c.prize}. Your credits carry over. Once you join, your hackathon
          opens here, and you can still switch back.
        </p>
        <button
          type="button"
          disabled={joining}
          onClick={() => void join()}
          className="mt-5 rounded-full bg-violet px-6 py-3 text-sm font-medium text-white outline-none focus-visible:shadow-focus disabled:opacity-60"
        >
          {joining ? "Joining…" : `Join the ${c.short} hackathon`}
        </button>
        {joinError && <p role="alert" className="mt-3 text-sm text-danger">{joinError}</p>}
      </div>
    );
  const { startCredits, deployCredits, deployPending } = claim.status;
  return (
    <div className="grid gap-4">
      <div className="rounded-card bg-violet p-8 text-white shadow-card">
        <p className="text-[11px] font-semibold uppercase tracking-[.18em] text-white/70">{c.short} hackathon</p>
        <h2 className="display mt-3 text-[28px] font-extrabold leading-[.95] sm:text-[40px]">
          You’re in. Build to win {c.winners === 1 ? "the scholarship" : "a scholarship"}.
        </h2>
        <p className="mt-3 max-w-xl text-white/80">
          {c.prizeLine} {campusPicking(event)}
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
        {campusNext(event).map((n) => (
          <Link key={n.path} href={`${app}${n.path}`} className="rounded-card bg-surface p-6 shadow-card outline-none hover:shadow-pop focus-visible:shadow-focus">
            <p className="text-[11px] font-semibold uppercase tracking-[.18em] text-violet">Next</p>
            <h3 className="display mt-2 text-lg font-bold">{n.title}</h3>
            <p className="mt-2 text-sm text-grey-600">{n.body}</p>
          </Link>
        ))}
      </div>
      <p className="text-xs text-grey-600">
        Your app or game needs a meaningful GoodDollar (G$) integration. Each builder enters one hackathon.{" "}
        {c.winners === 1
          ? `The winner shows they’re a ${c.short} student before the scholarship is paid.`
          : `Winners show they’re ${c.short} students before the scholarship is paid.`}
      </p>
    </div>
  );
}
