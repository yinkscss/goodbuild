import type { ReactNode } from "react";

import { SiteFooter } from "@/components/landing/site-footer";
import { SiteNav } from "@/components/landing/site-nav";
import { CONTACT_EMAIL } from "@/config/site-links";

/** Contact line for legal pages. Says so plainly while no address is set. */
export function ContactLine() {
  return CONTACT_EMAIL ? (
    <a className="text-violet hover:underline" href={`mailto:${CONTACT_EMAIL}`}>
      {CONTACT_EMAIL}
    </a>
  ) : (
    <span>a contact address, which will be listed here before launch</span>
  );
}

export function LegalPage({ eyebrow, title, intro, draft = true, children }: { eyebrow: string; title: string; intro: string; draft?: boolean; children: ReactNode }) {
  return (
    <>
      <SiteNav />
      <main className="mx-auto max-w-[1360px] px-4 sm:px-8">
        <div className="rounded-card bg-surface p-8 shadow-card md:p-12">
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="display mt-3 text-[28px] font-bold sm:text-[40px]">{title}</h1>
          <p className="mt-4 max-w-xl text-base text-grey-600">{intro}</p>
          {draft && (
            <p className="mt-4 w-fit rounded-full bg-warning/10 px-3 py-1 text-xs font-semibold text-warning">Draft. Not yet reviewed by a lawyer.</p>
          )}
        </div>
        <div className="mt-4 rounded-card bg-surface p-8 shadow-card md:p-12">
          <div className="max-w-2xl space-y-4 text-base text-ink/80 [&_h2]:pt-4 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-ink [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">{children}</div>
        </div>
        <SiteFooter />
      </main>
    </>
  );
}
