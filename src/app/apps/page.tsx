import { Suspense } from "react";

import { PublishedAppsDirectory, PublishedAppsSkeleton } from "@/components/landing/published-apps";
import { SiteFooter } from "@/components/landing/site-footer";
import { SiteNav } from "@/components/landing/site-nav";

export const metadata = { title: "Live apps · GoodBuild" };

/** Public directory of apps published by the GoodBuild community. */
export default function AppsPage() {
  return (
    <>
      <SiteNav />
      <main className="mx-auto min-h-[60vh] max-w-[1360px] px-4 py-8 sm:px-8 sm:py-12">
        <Suspense fallback={<PublishedAppsSkeleton />}>
          <PublishedAppsDirectory />
        </Suspense>
        <SiteFooter />
      </main>
    </>
  );
}
