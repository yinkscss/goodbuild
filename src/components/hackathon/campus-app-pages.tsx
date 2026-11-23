import { SubmissionForm } from "./community";
import { Ladder } from "./ladder";
import { VoteList } from "./vote-list";
import { campusOf, campusPicking, HACKATHON_EVENTS, type CampusEvent } from "@/lib/hackathon-events";

/** In-app tab titles of a campus hackathon (D160, D166). */
export function campusTitle(event: CampusEvent, tab: string) {
  return { title: `${tab} · ${HACKATHON_EVENTS[event].name} · GoodBuild` };
}

export function CampusProject({ event }: { event: CampusEvent }) {
  return (
    <section aria-labelledby="hk-project">
      <h2 id="hk-project" className="display text-[22px] font-bold">My {campusOf(event).short} project</h2>
      <p className="mt-2 text-sm text-grey-600">
        Enter your app or game now and come back to add your live link and source code. Add the live link to open approvals. Each
        builder enters one hackathon.
      </p>
      <div className="mt-5">
        <SubmissionForm />
      </div>
    </section>
  );
}

export function CampusLeaderboard({ event }: { event: CampusEvent }) {
  return (
    <section aria-labelledby="hk-ladder">
      <h2 id="hk-ladder" className="display text-[22px] font-bold">{campusOf(event).short} leaderboard</h2>
      <p className="mt-2 text-sm text-grey-600">
        {campusPicking(event)} Approvals close at the end of {HACKATHON_EVENTS[event].closesLabel}.
      </p>
      <div className="mt-5 rounded-card bg-surface p-6 shadow-card">
        <Ladder mode="app" />
      </div>
    </section>
  );
}

export function CampusVote({ event }: { event: CampusEvent }) {
  const short = campusOf(event).short;
  return (
    <section aria-labelledby="hk-vote" id="vote">
      <h2 id="hk-vote" className="display text-[22px] font-bold">Vote on {short} projects</h2>
      <p className="mt-2 text-sm text-grey-600">You have 3 approvals for {short}, separate from the main hackathon’s.</p>
      <div className="mt-5">
        <VoteList />
      </div>
    </section>
  );
}
