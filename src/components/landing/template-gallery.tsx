"use client";

import * as React from "react";
import Image from "next/image";
import { ArrowRight, Loader2 } from "lucide-react";

import { useSendGate } from "@/components/auth/send-gate";
import { Button } from "@/components/ui/button";
import { DEFAULT_NETWORK } from "@/config/networks";
import { PAGE_TEMPLATES } from "@/config/page-template-data";
import { TEMPLATE_CATEGORIES, templateRequest, thumbnailFor, type PageTemplate, type TemplateCategory } from "@/config/page-templates";
import { SectionHeading } from "./section-heading";

/** Cards shown before "Show all", so the section stays a section and not the whole page. */
const FIRST_PAGE = 9;

/**
 * Template gallery. Each card is a real screenshot of the page it builds. One click sends the
 * template's short request through the same gate as the prompt box (signed out: sign in first,
 * then it is sent once), and the server adds the full design brief to the first build.
 */
export function TemplateGallery() {
  const { send, sendError } = useSendGate();
  const [category, setCategory] = React.useState<TemplateCategory | "All">("All");
  const [showAll, setShowAll] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);

  const filtered = category === "All" ? PAGE_TEMPLATES : PAGE_TEMPLATES.filter((t) => t.category === category);
  const visible = category === "All" && !showAll ? filtered.slice(0, FIRST_PAGE) : filtered;

  async function build(t: PageTemplate) {
    if (busy) return;
    setBusy(t.id);
    try {
      await send({ prompt: templateRequest(t), templateId: t.id, network: DEFAULT_NETWORK, attachment: null });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section id="templates" aria-labelledby="templates-heading" className="mt-24 scroll-mt-24">
      <SectionHeading id="templates-heading" eyebrow="Templates" title="Pick a page, we build it">
        {PAGE_TEMPLATES.length} designs to start from. One click and GoodBuild writes it, then you change anything in the chat.
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
            <button
              type="button"
              onClick={() => void build(t)}
              disabled={busy !== null}
              aria-label={`Build the ${t.label} template`}
              className="group flex w-full flex-col gap-4 rounded-card bg-surface p-3 text-left shadow-card outline-none transition-shadow duration-200 ease-gb hover:shadow-pop focus-visible:shadow-focus disabled:cursor-wait disabled:opacity-70"
            >
              <span className="relative block aspect-[8/5] overflow-hidden rounded-block bg-tint">
                <Image
                  src={thumbnailFor(t)}
                  alt={`${t.label} template preview`}
                  width={960}
                  height={600}
                  sizes="(min-width: 1024px) 420px, (min-width: 640px) 50vw, 100vw"
                  className="size-full object-cover transition-transform duration-300 ease-gb group-hover:scale-[1.02]"
                />
              </span>
              <span className="flex flex-1 flex-col justify-between gap-4 px-3 pb-3">
                <span>
                  <span className="flex items-center justify-between gap-3">
                    <span className="text-lg font-semibold">{t.label}</span>
                    <span className="rounded-full bg-tint px-2.5 py-0.5 text-[12px] font-medium text-violet">{t.kind === "dapp" ? `${t.category}, on-chain` : t.category}</span>
                  </span>
                  <span className="mt-1 block text-sm text-grey-600">{t.description}</span>
                </span>
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-violet">
                  {busy === t.id ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                      Starting your build
                    </>
                  ) : (
                    <>
                      Build this template
                      <ArrowRight className="size-3.5 transition-transform duration-200 ease-gb group-hover:translate-x-0.5" aria-hidden />
                    </>
                  )}
                </span>
              </span>
            </button>
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
      {sendError && (
        <p role="alert" className="mt-4 text-center text-sm text-danger">
          {sendError}
        </p>
      )}
    </section>
  );
}
