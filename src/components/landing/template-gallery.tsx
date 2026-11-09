"use client";

import * as React from "react";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PAGE_TEMPLATES } from "@/config/page-template-data";
import { TEMPLATE_CATEGORIES, type PageTemplate, type TemplateCategory } from "@/config/page-templates";
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

/**
 * Template gallery. Each card is a slideshow of real screenshots of the page it builds (plays on
 * hover). Clicking attaches the template to the prompt box above: its thumbnail shows there, the
 * design brief stays out of sight, and the person writes what they want before anything is sent.
 */
export function TemplateGallery() {
  const [category, setCategory] = React.useState<TemplateCategory | "All">("All");
  const [showAll, setShowAll] = React.useState(false);

  const filtered = category === "All" ? PAGE_TEMPLATES : PAGE_TEMPLATES.filter((t) => t.category === category);
  const visible = category === "All" && !showAll ? filtered.slice(0, FIRST_PAGE) : filtered;

  function pick(id: string) {
    fillLandingPrompt(id);
    document.getElementById("build")?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  return (
    <section id="templates" aria-labelledby="templates-heading" className="mt-24 scroll-mt-24">
      <SectionHeading id="templates-heading" eyebrow="Templates" title="Start from a design you like">
        {PAGE_TEMPLATES.length} designs to start from. Pick one, say what you want to change, and GoodBuild builds it your way.
      </SectionHeading>

      <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label="Template categories">
        {(["All", ...TEMPLATE_CATEGORIES] as const).map((c) => (
          <Button key={c} type="button" size="chip" variant={category === c ? "chipSelected" : "chip"} aria-pressed={category === c} onClick={() => setCategory(c)}>
            {c}
          </Button>
        ))}
      </div>

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((t) => (
          <li key={t.id} className="flex">
            <TemplateTile t={t} onPick={pick} />
          </li>
        ))}
      </ul>

      {category === "All" && !showAll && filtered.length > FIRST_PAGE && (
        <div className="mt-6 flex justify-center">
          <Button type="button" variant="secondary" onClick={() => setShowAll(true)}>
            Show all {filtered.length} templates
          </Button>
        </div>
      )}
    </section>
  );
}
