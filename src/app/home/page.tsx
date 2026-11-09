import { Suspense } from "react";

import { AppShell } from "@/components/home/app-shell";
import { Greeting, HomePrompt, HomePromptProvider, NewBuildButton } from "@/components/home/home-prompt";
import { ProjectGrid, ProjectGridSkeleton, ProjectsEmpty, ProjectsError } from "@/components/home/projects";
import { getCredits } from "@/server/credits";
import { loadProjects, loadSession } from "@/server/home-data";

export const metadata = { title: "Home · GoodBuild" };

/** Logged-in home (design/app/b-home.html). */
export default function HomePage() {
  return (
    <HomePromptProvider>
      <AppShell active="home" newBuild={<NewBuildButton />}>
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
      </AppShell>
    </HomePromptProvider>
  );
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
