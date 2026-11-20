"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { EVENTS, HACKATHON_EVENTS } from "@/lib/hackathon-events";
import { useHackathonEvent } from "./use-event";

const SECTIONS = [
  { path: "", label: "Get started" },
  { path: "/project", label: "My project" },
  { path: "/leaderboard", label: "Leaderboard" },
  { path: "/vote", label: "Vote" },
];

const EVENT_LABEL = { main: "Main hackathon", futminna: "FUTMinna" } as const;

/** Link to the public page of the hackathon being shown: its rules and prizes. */
export function HackathonRulesLink() {
  const { config } = useHackathonEvent();
  return (
    <Link href={config.page} className="font-medium text-violet underline-offset-4 hover:underline">
      Rules and prizes
    </Link>
  );
}

/**
 * The hackathon inside the app (D155): a switch between the hackathons (D160), then the four sections
 * of the one being shown, each its own page under that hackathon's path.
 */
export function HackathonTabs() {
  const path = usePathname().replace(/\/$/, "");
  const { event, config } = useHackathonEvent();
  return (
    <>
      <nav aria-label="Hackathons" className="mt-8 flex w-fit max-w-full gap-1 overflow-x-auto rounded-full bg-tint p-1">
        {EVENTS.map((e) => {
          const on = e === event;
          return (
            <Link
              key={e}
              href={e === "main" ? `${HACKATHON_EVENTS.main.app}?stay=1` : HACKATHON_EVENTS[e].app}
              aria-current={on ? "page" : undefined}
              className={`shrink-0 rounded-full px-4 py-1.5 text-[13px] font-medium outline-none focus-visible:shadow-focus ${on ? "bg-surface text-violet shadow-card" : "text-violet/70 hover:text-violet"}`}
            >
              {EVENT_LABEL[e]}
            </Link>
          );
        })}
      </nav>
      <nav aria-label="Hackathon sections" className="sticky top-3 z-10 mt-3 flex w-fit max-w-full gap-1 overflow-x-auto rounded-full bg-surface p-1 shadow-card">
        {SECTIONS.map((t) => {
          const href = `${config.app}${t.path}`;
          const on = path === href;
          return (
            <Link
              key={href}
              href={href}
              aria-current={on ? "page" : undefined}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium outline-none focus-visible:shadow-focus ${on ? "bg-violet text-white" : "text-ink/70 hover:bg-tint hover:text-violet"}`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
