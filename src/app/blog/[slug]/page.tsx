import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { RichText } from "@/components/blog/rich-text";
import { SiteFooter } from "@/components/landing/site-footer";
import { SiteNav } from "@/components/landing/site-nav";
import { SITE_URL } from "@/config/site-url";
import { getPost, POSTS, readMinutes, relatedPosts } from "@/content/blog";
import { CLUSTERS } from "@/content/blog/types";

export const dynamicParams = false;

export function generateStaticParams() {
  return POSTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: PageProps<"/blog/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return {};
  const url = `${SITE_URL}/blog/${post.slug}`;
  return {
    title: { absolute: post.title },
    description: post.description,
    alternates: { canonical: url },
    openGraph: { type: "article", url, title: post.title, description: post.description, publishedTime: post.date, siteName: "GoodBuild" },
    twitter: { card: "summary", title: post.title, description: post.description },
  };
}

export default async function BlogPostPage({ params }: PageProps<"/blog/[slug]">) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) notFound();
  const url = `${SITE_URL}/blog/${post.slug}`;
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: post.title,
      description: post.description,
      datePublished: post.date,
      dateModified: post.date,
      mainEntityOfPage: url,
      author: { "@type": "Organization", name: "GoodBuild" },
      publisher: { "@type": "Organization", name: "GoodBuild", url: SITE_URL },
    },
    ...(post.faq?.length
      ? [
          {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: post.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") } })),
          },
        ]
      : []),
  ];
  const related = relatedPosts(post);

  return (
    <>
      <SiteNav />
      <main className="mx-auto max-w-[1360px] px-4 sm:px-8">
        {/* "<" can't end the script tag early: the JSON is ours, but escape it anyway. */}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
        <article>
          <header className="rounded-card bg-surface p-8 shadow-card md:p-12">
            <p className="eyebrow">
              <Link href="/blog" className="hover:underline">
                Blog
              </Link>{" "}
              · {CLUSTERS[post.cluster].label}
            </p>
            <h1 className="display mt-3 max-w-4xl text-[28px] font-bold sm:text-[40px]">{post.title}</h1>
            <p className="mt-4 max-w-2xl text-base text-grey-600">
              <RichText text={post.intro} />
            </p>
            <p className="mt-5 text-xs text-grey-400">
              <time dateTime={post.date}>{new Date(post.date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</time> · {readMinutes(post)} min read
            </p>
          </header>
          <div className="mt-4 rounded-card bg-surface p-8 shadow-card md:p-12">
            <div className="max-w-2xl space-y-4 text-base text-ink/80 [&_h2]:pt-4 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-ink [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">
              {post.sections.map((s) => (
                <section key={s.heading} className="space-y-4">
                  <h2>{s.heading}</h2>
                  {s.paragraphs?.map((t) => (
                    <p key={t}>
                      <RichText text={t} />
                    </p>
                  ))}
                  {s.bullets && (
                    <ul>
                      {s.bullets.map((t) => (
                        <li key={t}>
                          <RichText text={t} />
                        </li>
                      ))}
                    </ul>
                  )}
                  {s.steps && (
                    <ol>
                      {s.steps.map((t) => (
                        <li key={t}>
                          <RichText text={t} />
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
              ))}
              {post.faq && (
                <section className="space-y-4">
                  <h2>Questions people ask</h2>
                  {post.faq.map((f) => (
                    <div key={f.q}>
                      <h3 className="font-semibold text-ink">{f.q}</h3>
                      <p className="mt-1">
                        <RichText text={f.a} />
                      </p>
                    </div>
                  ))}
                </section>
              )}
            </div>
          </div>
        </article>

        <aside className="mt-4 flex flex-col items-start justify-between gap-6 rounded-card bg-violet p-8 text-white shadow-card md:flex-row md:items-center md:p-12">
          <div className="max-w-xl">
            <p className="display text-[28px] font-bold">Describe it. Sign it. Ship it.</p>
            <p className="mt-3 text-sm text-white/80">New accounts get $0.20 of AI free during the beta. For people 18 and over, not available to US persons.</p>
          </div>
          <Link href="/#build" className="rounded-full bg-ink px-6 py-3 text-sm font-medium text-white">
            Start building
          </Link>
        </aside>

        {related.length > 0 && (
          <section aria-labelledby="related" className="mt-4 rounded-card bg-surface p-8 shadow-card md:p-12">
            <h2 id="related" className="eyebrow">
              Keep reading
            </h2>
            <ul className="mt-4 grid gap-3 md:grid-cols-3">
              {related.map((r) => (
                <li key={r.slug}>
                  <Link href={`/blog/${r.slug}`} className="block rounded-inner bg-surface-tint p-5 text-sm font-semibold transition-colors duration-200 ease-gb hover:text-violet">
                    {r.title}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        <SiteFooter />
      </main>
    </>
  );
}
