import { Suspense } from "react";

import { AppShell } from "@/components/home/app-shell";
import { LandingPrompt } from "@/components/landing/landing-prompt";
import { TemplateGallery } from "@/components/landing/template-gallery";
import { loadSession } from "@/server/home-data";

export const metadata = { title: "Templates · GoodBuild" };

/** Signed out goes to the landing page. Reading the session has to sit inside Suspense so the shell can stream. */
async function RequireSession() {
  await loadSession();
  return null;
}

/** Signed-in templates: the same gallery as the landing page. One click starts a build from the template. */
export default function TemplatesPage() {
  return (
    <AppShell active="templates" width="max-w-[1100px]">
      <Suspense fallback={null}>
        <RequireSession />
      </Suspense>
      <p className="eyebrow">Templates</p>
      <h1 className="display mt-3 mb-8 text-[32px] font-extrabold sm:text-[44px]">Start from a design, or describe your own</h1>
      <LandingPrompt />
      <div className="[&>section]:mt-14">
        <TemplateGallery />
      </div>
    </AppShell>
  );
}
