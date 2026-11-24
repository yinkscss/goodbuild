import { SiteFooter } from "@/components/landing/site-footer";
import { SiteNav } from "@/components/landing/site-nav";
import { VoteSteps } from "@/components/vote/vote-steps";

export const metadata = {
  title: "Vote for GoodBuild · GoodBuild",
  description: "Vote for GoodBuild on FlowState in one tap. Sign in, verify with GoodDollar, and vote.",
};

/** The vote link (D168): the project, then the three steps. Separate from invite links, which are for signing up. */
export default function VotePage() {
  return (
    <>
      <SiteNav />
      <main className="mx-auto max-w-[760px] px-4 sm:px-8">
        <div className="rounded-card bg-surface p-8 shadow-card md:p-12">
          <p className="eyebrow">Vote on FlowState</p>
          <h1 className="display mt-3 text-[32px] font-extrabold sm:text-[44px]">Vote for GoodBuild</h1>
          <p className="mt-4 max-w-xl text-base text-grey-600">
            GoodBuild turns a plain description into a working app on Celo, and anyone can use it, no coding needed. Your vote helps it get funded. It takes three quick steps.
          </p>
          <VoteSteps />
          <p className="mt-8 text-xs text-grey-600">18+ · Not open to US persons</p>
        </div>
        <SiteFooter />
      </main>
    </>
  );
}
