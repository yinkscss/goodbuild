import { connection } from "next/server";
import { headers } from "next/headers";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { SectionHeading } from "@/components/landing/section-heading";
import { publishedAppUrl, publishedAppsDomain } from "@/lib/published-host";
import { getDb } from "@/server/db/client";
import { latestPublishedApps } from "@/server/publish/showcase";

type ShowcaseApps = Awaited<ReturnType<typeof latestPublishedApps>>;

async function loadShowcaseData(): Promise<{ apps: ShowcaseApps; requestHost: string | null } | null> {
  try {
    const db = await getDb();
    const [apps, requestHeaders] = await Promise.all([latestPublishedApps(db), headers()]);
    return { apps, requestHost: requestHeaders.get("host") };
  } catch (error) {
    console.error("published app showcase unavailable", error);
    return null;
  }
}

function ShowcaseContent({ apps, requestHost }: { apps: ShowcaseApps; requestHost: string | null }) {
  const domain = publishedAppsDomain();

  return (
    <section id="apps" aria-labelledby="apps-heading" className="mt-24 scroll-mt-24">
      <SectionHeading id="apps-heading" eyebrow="Made by builders" title="Live apps, built with GoodBuild">
        Visit real projects published by the community. Each app is created by its builder, not by GoodBuild.
      </SectionHeading>

      {apps.length > 0 ? (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {apps.map((app) => {
            const href = publishedAppUrl(app.slug, requestHost, domain);
            const address = new URL(href).host;

            return (
              <li key={app.slug}>
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open ${app.name}, opens in a new tab`}
                  className="group flex min-h-52 flex-col justify-between gap-8 rounded-card bg-surface p-6 shadow-card transition-shadow duration-200 ease-gb hover:shadow-pop focus-visible:outline-none focus-visible:shadow-focus"
                >
                  <span className="flex items-start justify-between gap-4">
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-grey-600">{address}</span>
                      <span className="mt-4 block text-xl font-semibold leading-snug">{app.name}</span>
                    </span>
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-tint text-violet transition-colors duration-200 ease-gb group-hover:bg-violet group-hover:text-white">
                      <ArrowUpRight className="size-4" aria-hidden="true" />
                    </span>
                  </span>
                  <span className="text-sm font-medium text-violet">Open app</span>
                </a>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="rounded-card bg-surface p-6 shadow-card sm:p-8">
          <h3 className="text-xl font-semibold">No live apps just yet</h3>
          <p className="mt-2 max-w-xl text-sm text-grey-600">Build something useful, then publish it here for people to try.</p>
          <Link href="/#build" className="mt-5 inline-flex rounded-full bg-ink px-5 py-3 text-sm font-medium text-white transition-shadow hover:shadow-focus focus-visible:outline-none focus-visible:shadow-focus">
            Build the first app
          </Link>
        </div>
      )}

      <p className="mt-4 text-xs text-grey-600">
        Apps are made by users and aren&apos;t reviewed or endorsed by GoodBuild. <Link href="/report" className="text-violet underline-offset-4 hover:underline">Report an app</Link> that looks harmful or breaks the terms.
      </p>
    </section>
  );
}

/** Request-time read, streamed separately so the landing hero doesn't wait on the database. */
export async function PublishedApps() {
  await connection();
  const data = await loadShowcaseData();
  return data ? <ShowcaseContent apps={data.apps} requestHost={data.requestHost} /> : <ShowcaseUnavailable />;
}

function ShowcaseUnavailable() {
  return (
    <section id="apps" aria-labelledby="apps-heading" className="mt-24 scroll-mt-24">
      <SectionHeading id="apps-heading" eyebrow="Made by builders" title="Live apps, built with GoodBuild">
        The community app list is temporarily unavailable. Please try again later.
      </SectionHeading>
    </section>
  );
}

export function PublishedAppsSkeleton() {
  return (
    <section id="apps" aria-labelledby="apps-loading-heading" aria-busy="true" className="mt-24 scroll-mt-24">
      <SectionHeading id="apps-loading-heading" eyebrow="Made by builders" title="Live apps, built with GoodBuild">
        Loading community apps.
      </SectionHeading>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Loading published apps">
        {Array.from({ length: 3 }, (_, i) => (
          <li key={i} className="min-h-52 rounded-card bg-surface p-6 shadow-card">
            <div className="h-4 w-2/3 rounded-full bg-tint" />
            <div className="mt-5 h-6 w-1/2 rounded-full bg-tint" />
            <div className="mt-20 h-4 w-20 rounded-full bg-tint" />
          </li>
        ))}
      </ul>
    </section>
  );
}
