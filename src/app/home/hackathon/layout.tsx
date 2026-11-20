import { HackathonRulesLink, HackathonTabs } from "@/components/hackathon/home-tabs";
import { styles } from "@/components/hackathon/styles";
import { AppShell } from "@/components/home/app-shell";
import "@/components/hackathon/hackathon.css";

/**
 * The hackathon inside the app (D155): Get started, My project, Leaderboard, Vote, each its own page.
 * FUTMinna (D160) has the same four under /home/hackathon/futminna, with a switch between the two.
 */
export default function HackathonLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell active="hackathon" width="max-w-[1000px]">
      <p className="eyebrow">Hackathon</p>
      <h1 className="display mt-3 text-[32px] font-extrabold sm:text-[44px]">Your hackathon</h1>
      <p className="mt-3 max-w-xl text-base text-grey-600">
        Get started, publish your project, watch the leaderboard and vote for other builders.{" "}
        <HackathonRulesLink />
      </p>
      <HackathonTabs />
      <div className={`${styles.page} hk-embed pt-8`}>{children}</div>
    </AppShell>
  );
}
