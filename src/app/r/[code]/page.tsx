import { Suspense } from "react";
import { redirect } from "next/navigation";

import { SiteFooter } from "@/components/landing/site-footer";
import { SiteNav } from "@/components/landing/site-nav";
import { InviteSteps } from "@/components/referral/invite-steps";
import { cleanReferralCode } from "@/lib/referral";

export const metadata = {
  title: "You're invited · GoodBuild",
  description: "A friend invited you to GoodBuild. Verify with GoodDollar, vote for us in one tap, and get free credits to build.",
  robots: { index: false },
};

/** The code is read per request, inside Suspense, so the rest of the page can be prerendered. */
async function Steps({ params }: { params: Promise<{ code: string }> }) {
  const code = cleanReferralCode((await params).code);
  if (!code) redirect("/");
  return <InviteSteps code={code} />;
}

/** Where an invite link lands (D155): sign in, verify with GoodDollar, one-tap vote. Works signed out. */
export default function InvitePage({ params }: { params: Promise<{ code: string }> }) {
  return (
    <>
      <SiteNav />
      <main className="mx-auto max-w-[760px] px-4 sm:px-8">
        <div className="rounded-card bg-surface p-8 shadow-card md:p-12">
          <p className="eyebrow">You&rsquo;re invited</p>
          <h1 className="display mt-3 text-[32px] font-extrabold sm:text-[44px]">A friend invited you to GoodBuild</h1>
          <p className="mt-4 max-w-xl text-base text-grey-600">
            Build your own app by describing it. Do two quick things and you both get free credits.
          </p>
          <Suspense fallback={<div className="skeleton mt-8 h-[260px] rounded-card motion-reduce:animate-none" />}>
            <Steps params={params} />
          </Suspense>
          <p className="mt-8 text-xs text-grey-600">18+ · Not open to US persons</p>
        </div>
        <SiteFooter />
      </main>
    </>
  );
}
