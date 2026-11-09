import { Suspense } from "react";

import { AppShell } from "@/components/home/app-shell";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { loadSession } from "@/server/home-data";

export const metadata = { title: "Settings · GoodBuild" };

/** Everything the signed-in user has built and deployed, in one place (D62). */
export default function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  return (
    <AppShell active="settings" width="max-w-[1000px]">
      <p className="eyebrow">Settings</p>
      <h1 className="display mt-3 text-[32px] font-extrabold sm:text-[44px]">Your apps, contracts and data</h1>
      <p className="mt-3 max-w-xl text-base text-grey-600">Manage what you have built, see the controls on your contracts and look at what visitors saved. Anything that changes a contract is signed in your own wallet.</p>
      <Suspense fallback={<div className="skeleton mt-8 h-[220px] rounded-card motion-reduce:animate-none" />}>
        <Tabs searchParams={searchParams} />
      </Suspense>
    </AppShell>
  );
}

async function Tabs({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await loadSession(); // signed out goes to the landing page; every tab's data comes from owner-scoped API routes
  const { tab } = await searchParams;
  return <SettingsTabs initialTab={tab} />;
}
