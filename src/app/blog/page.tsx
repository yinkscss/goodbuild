import type { Metadata } from "next";
import Link from "next/link";

import { SiteFooter } from "@/components/landing/site-footer";
import { SiteNav } from "@/components/landing/site-nav";
import { SITE_URL } from "@/config/site-url";
import { POSTS } from "@/content/blog";
import { CLUSTERS, type PostCluster } from "@/content/blog/types";

export const metadata: Metadata = {
  title: { absolute: "Blog: build apps with AI on Celo · GoodBuild" },
  description: "Guides to building MiniPay apps, blockchain apps and dApps with AI, free AI builders compared, and app ideas you can run with G$.",
  alternates: { canonical: `${SITE_URL}/blog` },
};

export default function BlogIndexPage() {
  const clusters = Object.keys(CLUSTERS) as PostCluster[];
  return (
    <>
      <SiteNav />
      <main className="mx-auto max-w-[1360px] px-4 sm:px-8">
        <div className="rounded-card bg-surface p-8 shadow-card md:p-12">
          <p className="eyebrow">Blog</p>
          <h1 className="display mt-3 max-w-4xl text-[28px] font-bold sm:text-[40px]">Build apps with AI, on Celo</h1>
          <p className="mt-4 max-w-xl text-base text-grey-600">
            Guides to MiniPay apps, blockchain apps, free AI builders and app ideas you can run with G$. {POSTS.length} posts, no jargon.
          </p>
          <nav aria-label="Topics" className="mt-6 flex flex-wrap gap-2">
            {clusters.map((c) => (
              <a key={c} href={`#${c}`} className="rounded-full bg-surface-tint px-3.5 py-1.5 text-[13px] font-medium text-violet">
                {CLUSTERS[c].label}
              </a>
            ))}
          </nav>
        </div>
        {clusters.map((c) => (
          <section key={c} id={c} aria-labelledby={`${c}-h`} className="mt-4 scroll-mt-24 rounded-card bg-surface p-8 shadow-card md:p-12">
            <p className="eyebrow">{CLUSTERS[c].label}</p>
            <h2 id={`${c}-h`} className="mt-2 max-w-xl text-base text-grey-600">
              {CLUSTERS[c].blurb}
            </h2>
            <ul className="mt-6 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {POSTS.filter((p) => p.cluster === c).map((p) => (
                <li key={p.slug}>
                  <Link href={`/blog/${p.slug}`} className="flex h-full flex-col justify-between gap-3 rounded-inner bg-surface-tint p-5 transition-colors duration-200 ease-gb hover:text-violet">
                    <span className="text-sm font-semibold">{p.title}</span>
                    <span className="text-xs text-grey-600">{p.description}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <SiteFooter />
      </main>
    </>
  );
}
