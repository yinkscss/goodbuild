"use client";

import { ArrowRight } from "lucide-react";

import { TEMPLATES } from "@/config/templates";
import { cn } from "@/lib/utils";
import { fillLandingPrompt } from "./landing-prompt";
import { SectionHeading } from "./section-heading";

/** Wide cards at opposite corners, so the grid doesn't read as a row of identical tiles (DESIGN_SYSTEM §7). */
const WIDE = new Set(["savings-circle", "event-badges"]);

export function TemplateGallery() {
  function pickBrief(id: string) {
    fillLandingPrompt(id);
    document.getElementById("build")?.scrollIntoView({ block: "center" });
  }

  return (
    <section id="templates" aria-labelledby="templates-heading" className="mt-24 scroll-mt-24">
      <SectionHeading id="templates-heading" eyebrow="What you can build" title="Start from a brief that already works">
        Pick one and change the details, or describe something new in your own words.
      </SectionHeading>
      <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {TEMPLATES.map((t) => (
          <li key={t.id} className={cn("flex", WIDE.has(t.id) && "lg:col-span-2")}>
            <button
              type="button"
              onClick={() => pickBrief(t.id)}
              className="group flex w-full flex-col justify-between gap-8 rounded-card bg-surface p-6 text-left shadow-card outline-none transition-shadow duration-200 ease-gb hover:shadow-pop focus-visible:shadow-focus"
            >
              <span>
                <span className="block text-lg font-semibold">{t.label}</span>
                <span className="mt-1 block text-sm text-grey-600">{t.description}</span>
                <span className="mt-4 block text-sm text-ink/80">“{t.examplePrompt}”</span>
              </span>
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-violet">
                Use this brief
                <ArrowRight className="size-3.5 transition-transform duration-200 ease-gb group-hover:translate-x-0.5" aria-hidden />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
