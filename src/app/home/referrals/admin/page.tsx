import { Suspense } from "react";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/home/app-shell";
import { AmbassadorDashboard } from "@/components/referral/ambassador-dashboard";
import { requireSession } from "@/server/auth/http";
import { isAdminWallet } from "@/server/settings/mainnet-access";
export const metadata = { title: "Ambassador admin · GoodBuild" };
async function Admin() {
  const session = await requireSession();
  if (!isAdminWallet(session.user.wallet)) notFound();
  return <AmbassadorDashboard admin />;
}
export default function AdminPage() {
  return <AppShell active="home"><h1 className="display text-3xl font-bold">Ambassador payouts</h1><Suspense fallback={<p>Loading…</p>}><Admin /></Suspense></AppShell>;
}
