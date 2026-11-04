import { HeroCard } from "@/components/landing/hero-card";
import { HowItWorks } from "@/components/landing/how-it-works";
import { LandingPrompt } from "@/components/landing/landing-prompt";
import { MetricCard } from "@/components/landing/metric-card";
import { SignedInRedirect } from "@/components/landing/signed-in-redirect";
import { SiteNav } from "@/components/landing/site-nav";
import { TemplateCard } from "@/components/landing/template-card";
import { landingStats } from "@/config/landing-stats";

/**
 * Landing (design/landing/index.html). Bento order per DESIGN_SYSTEM §2:
 * desktop  metric | hero | template, prompt full width below;
 * tablet   hero spans both columns, then prompt, metric, template;
 * mobile   hero, prompt, metric, template.
 */
export default function LandingPage() {
  return (
    <>
      <SignedInRedirect />
      <SiteNav />
      <main className="mx-auto max-w-[1360px] px-4 sm:px-8">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-[1fr_2.1fr_1fr] lg:grid-rows-[520px_auto]">
          <div className="order-1 md:col-span-2 lg:order-2 lg:col-span-1 lg:flex lg:flex-col [&>*]:flex-1">
            <HeroCard />
          </div>
          <div id="build" className="order-2 md:col-span-2 lg:order-4 lg:col-span-3">
            <LandingPrompt />
          </div>
          <div className="order-3 flex lg:order-1 [&>*]:flex-1">
            <MetricCard stats={landingStats} />
          </div>
          <div id="templates" className="order-4 flex scroll-mt-24 lg:order-3 [&>*]:flex-1">
            <TemplateCard />
          </div>
        </div>

        <HowItWorks />

        <footer className="flex flex-col justify-between gap-2 py-14 text-sm text-grey-400 sm:flex-row">
          <span>© 2026 GoodBuild · Made for the GoodDollar community</span>
          <span>Celo · G$ · Open source templates</span>
        </footer>
      </main>
    </>
  );
}
