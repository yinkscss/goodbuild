"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Gamepad2 } from "lucide-react";
import Image from "next/image";

import { Button } from "@/components/ui/button";
import { PAGE_TEMPLATES } from "@/config/page-template-data";
import { TEMPLATE_CATEGORIES, type PageTemplate, type TemplateCategory } from "@/config/page-templates";
import type { StarterTemplate } from "@/config/templates";
import { fillLandingPrompt } from "./landing-prompt";
import { SectionHeading } from "./section-heading";
import { TemplateSlides } from "./template-slides";

/** Cards shown before "Show all", so the section stays a section and not the whole page. */
const FIRST_PAGE = 9;

function TemplateTile({ t, onPick }: { t: PageTemplate; onPick: (id: string) => void }) {
  const [playing, setPlaying] = React.useState(false);
  return (
    <button
      type="button"
      onClick={() => onPick(t.id)}
      onPointerEnter={() => setPlaying(true)}
      onPointerLeave={() => setPlaying(false)}
      onFocus={() => setPlaying(true)}
      onBlur={() => setPlaying(false)}
      aria-label={`Use the ${t.label} template`}
      className="group flex w-full flex-col gap-4 rounded-card bg-surface p-3 text-left shadow-card outline-none transition-shadow duration-200 ease-gb hover:shadow-pop focus-visible:shadow-focus"
    >
      <TemplateSlides template={t} playing={playing} sizes="(min-width: 1024px) 420px, (min-width: 640px) 50vw, 100vw" />
      <span className="flex flex-1 flex-col justify-between gap-4 px-3 pb-3">
        <span>
          <span className="flex items-center justify-between gap-3">
            <span className="text-lg font-semibold">{t.label}</span>
            <span className="rounded-full bg-tint px-2.5 py-0.5 text-[12px] font-medium text-violet">{t.kind === "dapp" ? `${t.category}, on-chain` : t.category}</span>
          </span>
          <span className="mt-1 block text-sm text-grey-600">{t.description}</span>
          {t.pages && <span className="mt-2 block text-xs text-grey-400">{t.pages.length + 1} pages: Home, {t.pages.map((p) => p.name).join(", ")}</span>}
        </span>
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-violet">
          Use this template
          <ArrowRight className="size-3.5 transition-transform duration-200 ease-gb group-hover:translate-x-0.5" aria-hidden />
        </span>
      </span>
    </button>
  );
}

function GameTemplateTile({ template, onPick }: { template: StarterTemplate; onPick: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onPick(template.id)}
      aria-label={`Use the ${template.label} game template`}
      className="group flex w-full flex-col overflow-hidden rounded-card bg-surface text-left shadow-card outline-none transition-shadow duration-200 ease-gb hover:shadow-pop focus-visible:shadow-focus"
    >
      <span className="relative block aspect-video w-full overflow-hidden bg-grey-800">
        {template.thumbnail ? <Image src={template.thumbnail} alt="" fill sizes="(min-width: 1024px) 420px, (min-width: 640px) 50vw, 100vw" className="object-cover transition-transform duration-300 ease-gb group-hover:scale-105" /> : <Gamepad2 className="absolute top-1/2 left-1/2 size-8 -translate-x-1/2 -translate-y-1/2 text-white" aria-hidden />}
        <span className="absolute inset-0 bg-gradient-to-t from-black/35 to-transparent" />
        <span className="absolute top-3 left-3 rounded-full bg-black/50 px-2.5 py-1 text-[11px] font-semibold text-white">
          {template.game?.dims.toUpperCase() ?? "GAME"} · {template.game?.style ?? "STARTER"}
        </span>
      </span>
      <span className="flex flex-1 flex-col gap-4 p-5">
        <span>
          <span className="block text-lg font-semibold">{template.label}</span>
          <span className="mt-1 block text-sm leading-relaxed text-grey-600">{template.description}</span>
        </span>
        <span className="mt-auto inline-flex items-center gap-1.5 text-sm font-medium text-violet">
          Use this game template
          <ArrowRight className="size-3.5 transition-transform duration-200 ease-gb group-hover:translate-x-0.5" aria-hidden />
        </span>
      </span>
    </button>
  );
}

/**
 * Template gallery. Website cards show screenshots of the page they build; game cards show preview
 * art. Clicking either attaches the template to the prompt box above without submitting it.
 */
export function TemplateGallery({ fullPage = false, gameTemplates = [] }: { fullPage?: boolean; gameTemplates?: StarterTemplate[] }) {
  const [category, setCategory] = React.useState<TemplateCategory | "All" | "Games">("All");
  const [showAll, setShowAll] = React.useState(false);

  React.useEffect(() => {
    if (window.location.hash === "#games") setCategory("Games");
  }, []);

  const filtered = category === "All" ? PAGE_TEMPLATES : category === "Games" ? [] : PAGE_TEMPLATES.filter((t) => t.category === category);
  const visible = fullPage || category !== "All" || showAll ? filtered : filtered.slice(0, FIRST_PAGE);

  function pick(id: string) {
    fillLandingPrompt(id);
    document.getElementById("build")?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  return (
    <section id="templates" aria-labelledby="templates-heading" className="mt-24 scroll-mt-24">
      <SectionHeading id="templates-heading" eyebrow="Templates" title={category === "Games" ? "Start with a game that already plays" : "Start from a design you like"}>
        {category === "Games"
          ? `${gameTemplates.length} tested game starters. Pick one, describe the theme and changes you want, and GoodBuild builds it your way.`
          : `${PAGE_TEMPLATES.length} designs to start from. Pick one, say what you want to change, and GoodBuild builds it your way.`}
      </SectionHeading>

      <div id="template-categories" className="mb-5 flex flex-wrap gap-2" role="group" aria-label="Template categories">
        {(["All", ...TEMPLATE_CATEGORIES, "Games"] as const).map((c) => (
          <Button id={c === "Games" ? "games" : undefined} key={c} type="button" size="chip" variant={category === c ? "chipSelected" : "chip"} aria-pressed={category === c} onClick={() => setCategory(c)}>
            {c}
          </Button>
        ))}
      </div>

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {category === "Games"
          ? gameTemplates.map((template) => (
              <li key={template.id} className="flex">
                <GameTemplateTile template={template} onPick={pick} />
              </li>
            ))
          : visible.map((t) => (
              <li key={t.id} className="flex">
                <TemplateTile t={t} onPick={pick} />
              </li>
            ))}
      </ul>

      {!fullPage && category === "All" && !showAll && filtered.length > FIRST_PAGE && (
        <div className="mt-6 flex justify-center">
          <Button type="button" variant="secondary" onClick={() => setShowAll(true)}>
            Show all {filtered.length} templates
          </Button>
        </div>
      )}
      {!fullPage && (
        <div className="mt-6 flex justify-center">
          <Link href="/templates" className="rounded-full px-5 py-3 text-sm font-medium text-violet transition-colors hover:bg-tint focus-visible:outline-none focus-visible:shadow-focus">
            Browse all templates
          </Link>
        </div>
      )}
    </section>
  );
}
