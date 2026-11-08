import { Suspense, cache } from "react";
import { redirect } from "next/navigation";

import { Logo } from "@/components/brand/logo";
import { Greeting, HomePrompt, HomePromptProvider, NetworkNotice, NewBuildButton } from "@/components/home/home-prompt";
import {
  ProjectGrid,
  ProjectGridSkeleton,
  ProjectsEmpty,
  ProjectsError,
  RecentBuilds,
  RecentBuildsSkeleton,
  type ProjectSummary,
} from "@/components/home/projects";
import { HomeTopBar } from "@/components/home/top-bar";
import { currentSession } from "@/server/auth/http";
import { getCredits } from "@/server/credits";
import { getDb } from "@/server/db/client";
import { listProjects } from "@/server/projects";
import { inferKind } from "@/lib/contract-kind";

export const metadata = { title: "Home · GoodBuild" };

/** One session lookup and one projects query per request, shared by every section. */
const loadSession = cache(async () => {
  const session = await currentSession();
  if (!session) redirect("/");
  return session;
});

const loadProjects = cache(async (): Promise<{ projects: ProjectSummary[] } | { error: string }> => {
  const session = await loadSession();
  try {
    const rows = await listProjects(await getDb(), session.user.id, 500);
    return {
      projects: rows.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        chainId: p.chainId,
        updatedAt: p.updatedAt,
        kind: inferKind({ templateId: p.templateId, text: p.name }),
      })),
    };
  } catch (error) {
    console.error(error);
    return { error: error instanceof Error ? error.message : "Unknown error" };
  }
});

const NAV = [
  { label: "Templates", hint: "Soon" },
  { label: "Deployments", hint: "Soon" },
  { label: "Credits", hint: "M6" },
];

/** Logged-in home (design/app/b-home.html). */
export default function HomePage() {
  return (
    <HomePromptProvider>
      <div className="flex min-h-dvh">
        <aside className="sticky top-0 hidden h-dvh w-[260px] shrink-0 flex-col p-5 lg:flex">
          <div className="px-2">
            <Logo href="/home" />
          </div>
          <div className="mt-7">
            <NewBuildButton />
          </div>
          <nav aria-label="App" className="mt-7 space-y-0.5 text-sm">
            <span className="block rounded-[12px] bg-surface px-3 py-2 font-medium shadow-card" aria-current="page">
              Home
            </span>
            {NAV.map((item) => (
              <span
                key={item.label}
                aria-disabled="true"
                className="flex items-center justify-between px-3 py-2 text-ink/45"
                title="Coming soon"
              >
                {item.label}
                <span className="text-[11px] text-grey-400">{item.hint}</span>
              </span>
            ))}
          </nav>
          <p className="mt-7 px-3 text-[11px] font-semibold tracking-[.18em] text-grey-400 uppercase">Recent builds</p>
          <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
            <Suspense fallback={<RecentBuildsSkeleton />}>
              <SidebarRecent />
            </Suspense>
          </div>
          <NetworkNotice />
        </aside>

        <main className="flex min-w-0 flex-1 flex-col px-4 py-5 sm:px-6 lg:pr-6 lg:pl-0">
          <Suspense fallback={<div className="h-11" />}>
            <TopBar />
          </Suspense>

          <div className="mx-auto mt-10 w-full max-w-[920px] lg:mt-16">
            <Greeting />
            <h1 className="display mt-3 text-[36px] font-extrabold sm:text-[48px]">
              What are we
              <br />
              building today?
            </h1>
            <Suspense fallback={<div className="skeleton mt-8 h-[176px] rounded-card motion-reduce:animate-none" />}>
              <Prompt />
            </Suspense>

            <div className="mt-12 flex items-end justify-between">
              <h2 className="display text-[20px] font-bold">Your projects</h2>
            </div>
            <Suspense fallback={<ProjectGridSkeleton />}>
              <Projects />
            </Suspense>
          </div>
        </main>
      </div>
    </HomePromptProvider>
  );
}

async function TopBar() {
  const session = await loadSession();
  const credits = await getCredits(session.user.id);
  return <HomeTopBar balanceGd={credits.balanceGd} usdPerGd={credits.usdPerGd} balanceMicro={credits.balanceMicro} />;
}

async function Prompt() {
  const session = await loadSession();
  const credits = await getCredits(session.user.id);
  return <HomePrompt balanceGd={credits.balanceGd} />;
}

async function Projects() {
  const result = await loadProjects();
  if ("error" in result) return <ProjectsError detail={result.error} />;
  if (result.projects.length === 0) return <ProjectsEmpty />;
  return <ProjectGrid projects={result.projects} />;
}

async function SidebarRecent() {
  const result = await loadProjects();
  return <RecentBuilds projects={"error" in result ? [] : result.projects} />;
}
