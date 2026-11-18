import { VoteList } from "@/components/hackathon/vote-list";

export const metadata = { title: "Vote · Hackathon · GoodBuild" };

export default function HackathonVotePage() {
  return (
    <section aria-labelledby="hk-vote" id="vote">
      <h2 id="hk-vote" className="display text-[22px] font-bold">Vote on projects</h2>
      <div className="mt-5">
        <VoteList />
      </div>
    </section>
  );
}
