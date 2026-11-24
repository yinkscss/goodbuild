"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { HACKATHON } from "@/lib/hackathon-events";

const SECTIONS = [
  { path: "", label: "Get started" },
  { path: "/project", label: "My project" },
  { path: "/leaderboard", label: "Leaderboard" },
  { path: "/vote", label: "Vote" },
];

/** Link to the hackathon's public page: its rules and prizes. */
export function HackathonRulesLink() {
  return (
    <Link href={HACKATHON.page} className="font-medium text-violet underline-offset-4 hover:underline">
      Rules and prizes
    </Link>
  );
}

/** The hackathon inside the app (D155): four sections, each its own page. One hackathon since D170. */
export function HackathonTabs() {
  const path = usePathname().replace(/\/$/, "");
  return (
    <nav aria-label="Hackathon sections" className="sticky top-3 z-10 mt-8 flex w-fit max-w-full gap-1 overflow-x-auto rounded-full bg-surface p-1 shadow-card">
      {SECTIONS.map((t) => {
        const href = `${HACKATHON.app}${t.path}`;
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
  );
}
