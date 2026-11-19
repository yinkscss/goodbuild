"use client";

import { ArrowRight, Gamepad2 } from "lucide-react";

import type { StarterTemplate } from "@/config/templates";
import { fillLandingPrompt } from "./landing-prompt";
import { SectionHeading } from "./section-heading";

/** The playable game starters, separate from the website design gallery. */
export function GameTemplateGallery({ templates }: { templates: StarterTemplate[] }) {
  function pick(template: StarterTemplate) {
    fillLandingPrompt(template.id);
    document.getElementById("build")?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  return (
    <section aria-labelledby="game-templates-heading" className="mt-20 scroll-mt-24">
      <SectionHeading id="game-templates-heading" eyebrow="Game templates" title="Start with a game that already plays">
        {templates.length} tested starting points for action, puzzle and quiz games. Pick one, then describe the theme and changes you want.
      </SectionHeading>

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {templates.map((template, index) => (
          <li key={template.id} className="flex">
            <button
              type="button"
              onClick={() => pick(template)}
              aria-label={`Use the ${template.label} game template`}
              className="group flex w-full flex-col overflow-hidden rounded-card bg-surface text-left shadow-card outline-none transition-shadow duration-200 ease-gb hover:shadow-pop focus-visible:shadow-focus"
            >
              <span className="relative flex h-36 items-center justify-center overflow-hidden bg-gradient-to-br from-violet/15 via-tint to-canvas">
                <span className="absolute -right-8 -bottom-16 size-48 rounded-full border border-violet/15" />
                <span className="absolute -right-2 -bottom-10 size-32 rounded-full border border-violet/20" />
                <span className="grid size-16 place-items-center rounded-[22px] bg-surface text-violet shadow-card transition-transform duration-200 ease-gb group-hover:-translate-y-1">
                  <Gamepad2 className="size-8" aria-hidden />
                </span>
                <span className="absolute top-3 left-3 rounded-full bg-surface/90 px-2.5 py-1 text-[11px] font-semibold text-grey-600">
                  {template.game?.dims.toUpperCase() ?? "GAME"} · {template.game?.style ?? "STARTER"}
                </span>
                <span className="absolute top-3 right-3 font-mono text-xs text-grey-400">{String(index + 1).padStart(2, "0")}</span>
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
          </li>
        ))}
      </ul>
    </section>
  );
}
