import { Ladder } from "@/components/hackathon/ladder";
import { FUTMINNA } from "@/lib/hackathon-events";

export const metadata = { title: "Leaderboard · FUTMinna Hackathon · GoodBuild" };

export default function FutminnaLeaderboardPage() {
  return (
    <section aria-labelledby="hk-ladder">
      <h2 id="hk-ladder" className="display text-[22px] font-bold">FUTMinna leaderboard</h2>
      <p className="mt-2 text-sm text-grey-600">
        The top {FUTMINNA.shortlist} make the shortlist, and {FUTMINNA.judges} pick the ₦
        {FUTMINNA.scholarshipNaira.toLocaleString("en-US")} scholarship winner. Approvals close at the end of 10 Dec.
      </p>
      <div className="mt-5 rounded-card bg-surface p-6 shadow-card">
        <Ladder mode="app" />
      </div>
    </section>
  );
}
