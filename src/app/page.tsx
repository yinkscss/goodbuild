import { Suspense } from "react";

import { SITE_URL } from "@/config/site-url";

import { Faq } from "@/components/landing/faq";
import { FinalCta } from "@/components/landing/final-cta";
import { HeroCard } from "@/components/landing/hero-card";
import { HowItWorks } from "@/components/landing/how-it-works";
import { InsideBuilder } from "@/components/landing/inside-builder";
import { LandingPrompt } from "@/components/landing/landing-prompt";
import { BetaCard } from "@/components/landing/beta-card";
import { Pricing } from "@/components/landing/pricing";
import { Safety } from "@/components/landing/safety";
import { SignedInRedirect } from "@/components/landing/signed-in-redirect";
import { SiteFooter } from "@/components/landing/site-footer";
import { SiteNav } from "@/components/landing/site-nav";
import { PublishedApps, PublishedAppsSkeleton } from "@/components/landing/published-apps";
import { TemplateCard } from "@/components/landing/template-card";
import { TemplateGallery } from "@/components/landing/template-gallery";

/**
 * Landing (design/landing/index.html). Bento order per DESIGN_SYSTEM §2:
 * desktop  metric | hero | template, prompt full width below;
 * tablet   hero spans both columns, then prompt, metric, template;
 * mobile   hero, prompt, metric, template.
 * The read-through sections follow, each anchored from the top nav.
 */
const SITE_JSON_LD = [
  { "@context": "https://schema.org", "@type": "Organization", name: "GoodBuild", url: SITE_URL, logo: `${SITE_URL}/icon.png` },
  { "@context": "https://schema.org", "@type": "WebSite", name: "GoodBuild", url: SITE_URL },
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "GoodBuild",
    url: SITE_URL,
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Web",
    description: "An AI app builder that writes the smart contract and front end for dApps, MiniPay apps, games and websites on Celo. You sign the deploy from your own wallet.",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD", description: "New accounts get $0.20 of AI free during the testnet beta." },
  },
];

export default function LandingPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(SITE_JSON_LD).replace(/</g, "\\u003c") }} />
      <SignedInRedirect />
      <SiteNav />
      <main className="mx-auto max-w-[1360px] px-4 sm:px-8">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-[1fr_2.1fr_1fr] lg:grid-rows-[520px_auto]">
          <div className="order-1 md:col-span-2 lg:order-2 lg:col-span-1 lg:flex lg:flex-col [&>*]:flex-1">
            <HeroCard />
          </div>
          <div id="build" className="order-2 scroll-mt-24 md:col-span-2 lg:order-4 lg:col-span-3">
            <LandingPrompt />
          </div>
          <div className="order-3 flex lg:order-1 [&>*]:flex-1">
            <BetaCard />
          </div>
          <div className="order-4 flex lg:order-3 [&>*]:flex-1">
            <TemplateCard />
          </div>
        </div>

        <HowItWorks />
        <TemplateGallery />
        <Suspense fallback={<PublishedAppsSkeleton />}>
          <PublishedApps />
        </Suspense>
        <InsideBuilder />
        <Safety />
        <Pricing />
        <Faq />
        <FinalCta />
        <SiteFooter />
      </main>
    </>
  );
}
