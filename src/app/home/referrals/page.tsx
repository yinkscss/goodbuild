import { AppShell } from "@/components/home/app-shell";
import { AmbassadorDashboard } from "@/components/referral/ambassador-dashboard";
import { ReferralsHub } from "@/components/referral/referrals-hub";

export const metadata = { title: "Referrals · GoodBuild" };

export default function ReferralsPage() {
  return (
    <AppShell active="referrals">
      <h1 className="display text-3xl font-bold">Referrals</h1>
      <p className="mt-3 text-grey-600">Invite friends. You both get credits.</p>
      <ReferralsHub />
      <h2 className="display mt-14 text-xl font-bold">Ambassador earnings</h2>
      <p className="mt-2 text-sm text-grey-600">G$ earned from referrals, and your payout requests.</p>
      <AmbassadorDashboard />
    </AppShell>
  );
}
