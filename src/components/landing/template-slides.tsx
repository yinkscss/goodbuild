"use client";

import * as React from "react";
import Image from "next/image";

import { getPageTemplate } from "@/config/page-template-data";
import { thumbnailsFor, type PageTemplate } from "@/config/page-templates";
import { cn } from "@/lib/utils";

/** Time each screenshot stays up while the slideshow plays. */
export const SLIDE_MS = 1100;

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  } catch {
    return false;
  }
}

/**
 * A template's screenshots as a slideshow that plays while `playing` is true (hover or focus on the
 * card) and rests on the first screenshot otherwise. The other slides load only once it first plays,
 * so a page of cards fetches one image each. With reduced motion it never cycles.
 */
export function TemplateSlides({ template, playing, sizes, className }: { template: Pick<PageTemplate, "id" | "label">; playing: boolean; sizes: string; className?: string }) {
  const urls = thumbnailsFor(template);
  const [index, setIndex] = React.useState(0);
  const [started, setStarted] = React.useState(false);
  const cycle = playing && urls.length > 1 && !prefersReducedMotion();
  // Start fetching the other screenshots the first time it plays (a state update during render is allowed here).
  if (cycle && !started) setStarted(true);
  // When it isn't playing the first screenshot shows, whatever the timer last reached.
  const shown = cycle ? index : 0;

  React.useEffect(() => {
    if (!cycle) return;
    // Move on right away so the hover shows something new, then every SLIDE_MS.
    const first = setTimeout(() => setIndex(1 % urls.length), 250);
    const timer = setInterval(() => setIndex((i) => (i + 1) % urls.length), SLIDE_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [cycle, urls.length]);

  return (
    <span className={cn("relative block aspect-[8/5] overflow-hidden rounded-block bg-tint", className)} data-slide={shown}>
      {urls.map((src, i) =>
        i === 0 || started ? (
          <Image
            key={src}
            src={src}
            alt={i === 0 ? `${template.label} template preview` : ""}
            aria-hidden={i === 0 ? undefined : true}
            width={960}
            height={600}
            sizes={sizes}
            className={cn("absolute inset-0 size-full object-cover transition-opacity duration-500 ease-gb", i === shown ? "opacity-100" : "opacity-0")}
          />
        ) : null,
      )}
      {urls.length > 1 && (
        <span className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center gap-1" aria-hidden>
          {urls.map((src, i) => (
            <span key={src} className={cn("h-1 rounded-full bg-white/80 shadow-sm transition-all duration-300", i === shown ? "w-4 opacity-100" : "w-1.5 opacity-50")} />
          ))}
        </span>
      )}
    </span>
  );
}

/** The template a project started from, shown at the top of its chat. Renders nothing for other projects. */
export function TemplateBanner({ templateId }: { templateId: string | null | undefined }) {
  const [hover, setHover] = React.useState(false);
  const template = getPageTemplate(templateId);
  if (!template) return null;
  return (
    <div
      className="flex flex-col gap-3 rounded-block bg-canvas p-2 sm:flex-row sm:items-center sm:pr-4"
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
    >
      <TemplateSlides template={template} playing={hover} sizes="(min-width: 640px) 160px, 100vw" className="w-full shrink-0 sm:w-40" />
      <div className="min-w-0 px-1 pb-1 sm:px-0 sm:pb-0">
        <p className="eyebrow">Template</p>
        <p className="truncate text-sm font-semibold">{template.label}</p>
        <p className="text-xs text-grey-600">Started from this design. Ask for any change.</p>
      </div>
    </div>
  );
}
