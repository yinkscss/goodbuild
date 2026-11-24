import { Ladder } from "@/components/hackathon/ladder";

export const metadata = { title: "Leaderboard · Hackathon · GoodBuild" };

export default function HackathonLeaderboardPage() {
  return (
    <section aria-labelledby="hk-ladder">
      <h2 id="hk-ladder" className="display text-[22px] font-bold">Leaderboard</h2>
      <p className="mt-2 text-sm text-grey-600">The top 20 share the rank prizes. Approvals close at the end of 31 Dec.</p>
      <div className="mt-5 rounded-card bg-surface p-6 shadow-card">
        <Ladder mode="app" />
      </div>
    </section>
  );
}
