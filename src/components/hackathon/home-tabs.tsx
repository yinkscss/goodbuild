"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/home/hackathon", label: "Get started" },
  { href: "/home/hackathon/project", label: "My project" },
  { href: "/home/hackathon/leaderboard", label: "Leaderboard" },
  { href: "/home/hackathon/vote", label: "Vote" },
];

/** The four sections of the hackathon inside the app (D155). Each one is its own page under /home/hackathon. */
export function HackathonTabs() {
  const path = usePathname().replace(/\/$/, "");
  return (
    <nav aria-label="Hackathon sections" className="sticky top-3 z-10 mt-8 flex w-fit max-w-full gap-1 overflow-x-auto rounded-full bg-surface p-1 shadow-card">
      {TABS.map((t) => {
        const on = path === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
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
