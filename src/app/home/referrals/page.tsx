import { AppShell } from "@/components/home/app-shell";
import { AmbassadorDashboard } from "@/components/referral/ambassador-dashboard";
export const metadata = { title: "Your referrals · GoodBuild" };
export default function ReferralsPage() {
  return <AppShell active="home"><h1 className="display text-3xl font-bold">Your referrals</h1><p className="mt-3 text-grey-600">Track the people you invite and your ambassador earnings.</p><AmbassadorDashboard /></AppShell>;
}
