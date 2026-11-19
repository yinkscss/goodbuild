import { SiteFooter } from "@/components/landing/site-footer";
import { LandingPrompt } from "@/components/landing/landing-prompt";
import { SiteNav } from "@/components/landing/site-nav";
import { TemplateGallery } from "@/components/landing/template-gallery";
import { GameTemplateGallery } from "@/components/landing/game-template-gallery";
import { gameTemplateStarters } from "@/server/agent/game-templates";

export const metadata = { title: "Templates · GoodBuild" };

/** Public template library, also reachable from the app sidebar when signed in. */
export default function TemplatesPage() {
  const gameTemplates = gameTemplateStarters();
  return (
    <>
      <SiteNav />
      <main className="mx-auto max-w-[1360px] px-4 py-8 sm:px-8 sm:py-12">
        <p className="eyebrow">Template library</p>
        <h1 className="display mt-3 text-[32px] font-extrabold sm:text-[48px]">Build your next idea from a template</h1>
        <p className="mt-3 max-w-2xl text-base text-grey-600">
          Browse website designs and tested game starting points, then tell GoodBuild what you want to build or change.
        </p>
        <div id="build" className="mt-8">
          <LandingPrompt gameTemplates={gameTemplates} />
        </div>
        <div className="[&>section]:mt-12">
          <GameTemplateGallery templates={gameTemplates} />
          <TemplateGallery fullPage />
        </div>
        <SiteFooter />
      </main>
    </>
  );
}
