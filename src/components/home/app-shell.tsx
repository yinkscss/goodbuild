import { Suspense } from "react";
import Link from "next/link";

import { Logo } from "@/components/brand/logo";
import { NetworkNotice } from "@/components/home/home-prompt";
import { RecentBuilds, RecentBuildsSkeleton } from "@/components/home/projects";
import { HomeTopBar } from "@/components/home/top-bar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getCredits } from "@/server/credits";
import { availableMicro } from "@/server/credits/available";
import { getDb } from "@/server/db/client";
import { loadProjects, loadSession } from "@/server/home-data";

export type NavKey = "home" | "templates" | "deployments" | "credits" | "settings";

const NAV: { key: NavKey; label: string; href: string }[] = [
  { key: "home", label: "Home", href: "/home" },
  { key: "templates", label: "Templates", href: "/templates" },
  { key: "deployments", label: "Deployments", href: "/deployments" },
  { key: "credits", label: "Credits", href: "/credits" },
  { key: "settings", label: "Settings", href: "/settings" },
];

const ITEM = "flex items-center justify-between rounded-[12px] px-3 py-2 outline-none focus-visible:shadow-focus";

/** The credit balance next to "Credits" in the nav. Nothing shows until the ledger answers. */
async function CreditsHint() {
  const session = await loadSession();
  const balanceMicro = await availableMicro(await getDb(), session.user.id, (await getCredits(session.user.id)).balanceMicro);
  if (balanceMicro === null) return null;
  return <span className="text-[11px] font-medium text-grey-600">${(balanceMicro / 1_000_000).toFixed(2)}</span>;
}

async function SidebarRecent() {
  const result = await loadProjects();
  return <RecentBuilds projects={"error" in result ? [] : result.projects} />;
}

async function TopBar() {
  const session = await loadSession();
  const credits = await getCredits(session.user.id);
  return <HomeTopBar balanceGd={credits.balanceGd} usdPerGd={credits.usdPerGd} balanceMicro={await availableMicro(await getDb(), session.user.id, credits.balanceMicro)} />;
}

/**
 * The signed-in frame (mockup b): sidebar with the app's four places and recent builds, and the top bar.
 * `newBuild` lets the home screen focus its own prompt box; elsewhere it goes back to Home.
 */
export function AppShell({ active, newBuild, children, width = "max-w-[920px]" }: { active: NavKey; newBuild?: React.ReactNode; children: React.ReactNode; width?: string }) {
  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-[260px] shrink-0 flex-col p-5 lg:flex">
        <div className="px-2">
          <Logo href="/home" />
        </div>
        <div className="mt-7">
          {newBuild ?? (
            <Button variant="primary" className="w-full" asChild>
              <Link href="/home">+ New build</Link>
            </Button>
          )}
        </div>
        <nav aria-label="App" className="mt-7 space-y-0.5 text-sm">
          {NAV.map((item) => {
            const current = item.key === active;
            return (
              <Link
                key={item.key}
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={cn(ITEM, current ? "bg-surface font-medium shadow-card" : "text-ink/65 hover:bg-tint hover:text-violet")}
              >
                {item.label}
                {item.key === "credits" && (
                  <Suspense fallback={null}>
                    <CreditsHint />
                  </Suspense>
                )}
              </Link>
            );
          })}
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
        <div className={cn("mx-auto mt-10 w-full lg:mt-16", width)}>{children}</div>
      </main>
    </div>
  );
}
