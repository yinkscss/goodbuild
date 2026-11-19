import Link from "next/link";

import { ProjectGallery, SubmissionForm } from "@/components/hackathon/community";
import { Ladder } from "@/components/hackathon/ladder";
import { RegisterSteps } from "@/components/hackathon/register-steps";
import { styles } from "@/components/hackathon/styles";
import { AppShell } from "@/components/home/app-shell";
import "@/components/hackathon/hackathon.css";

export const metadata = { title: "Hackathon · GoodBuild" };

const SECTIONS = [
  { id: "progress", label: "Progress" },
  { id: "ladder", label: "Leaderboard" },
  { id: "project", label: "My project" },
  { id: "vote", label: "Vote on projects" },
];

/**
 * The hackathon inside the app: progress (verify, vote, credits), submit or update your project, and
 * approve other people's projects, without going back to the public /hackathon page.
 */
export default function HackathonDashboardPage() {
  return (
    <AppShell active="hackathon" width="max-w-[1000px]">
      <p className="eyebrow">Hackathon</p>
      <h1 className="display mt-3 text-[32px] font-extrabold sm:text-[44px]">Your hackathon</h1>
      <p className="mt-3 max-w-xl text-base text-grey-600">
        Unlock your free credits, submit or update your project, and vote for other builders.{" "}
        <Link href="/hackathon" className="font-medium text-violet underline-offset-4 hover:underline">
          Rules and prizes
        </Link>
      </p>
      <nav aria-label="Hackathon sections" className="sticky top-3 z-10 mt-8 flex w-fit max-w-full gap-1 overflow-x-auto rounded-full bg-surface p-1 shadow-card">
        {SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="shrink-0 rounded-full px-4 py-2 text-sm font-medium text-ink/70 outline-none hover:bg-tint hover:text-violet focus-visible:shadow-focus"
          >
            {s.label}
          </a>
        ))}
      </nav>
      <div className={`${styles.page} hk-embed`}>
        <section id="progress" aria-labelledby="hk-progress" className="scroll-mt-20 pt-10">
          <h2 id="hk-progress" className="display text-[22px] font-bold">
            Progress
          </h2>
          <div className="mt-5">
            <RegisterSteps />
          </div>
        </section>
        <section id="ladder" aria-labelledby="hk-ladder" className="scroll-mt-20 pt-14">
          <h2 id="hk-ladder" className="display text-[22px] font-bold">
            Leaderboard
          </h2>
          <p className="mt-2 text-sm text-grey-600">The top 20 share the rank prizes. Approvals close at the end of 10 Dec.</p>
          <div className="mt-5 rounded-card bg-surface p-6 shadow-card">
            <Ladder mode="app" />
          </div>
        </section>
        <section id="project" aria-labelledby="hk-project" className="scroll-mt-20 pt-14">
          <h2 id="hk-project" className="display text-[22px] font-bold">
            My project
          </h2>
          <p className="mt-2 text-sm text-grey-600">Submit it now and come back to add your live app and source code.</p>
          <div className="mt-5">
            <SubmissionForm />
          </div>
        </section>
        <section id="vote" aria-labelledby="hk-vote" className="scroll-mt-20 pt-14">
          <h2 id="hk-vote" className="display text-[22px] font-bold">
            Vote on projects
          </h2>
          <div className="mt-5">
            <ProjectGallery />
          </div>
        </section>
      </div>
    </AppShell>
  );
}
