import { VoteList } from "@/components/hackathon/vote-list";

export const metadata = { title: "Vote · FUTMinna Hackathon · GoodBuild" };

export default function FutminnaVotePage() {
  return (
    <section aria-labelledby="hk-vote" id="vote">
      <h2 id="hk-vote" className="display text-[22px] font-bold">Vote on FUTMinna projects</h2>
      <p className="mt-2 text-sm text-grey-600">You have 3 approvals for FUTMinna, separate from the main hackathon’s.</p>
      <div className="mt-5">
        <VoteList />
      </div>
    </section>
  );
}
