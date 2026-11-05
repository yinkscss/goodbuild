import { ArrowRight } from "lucide-react";

export function FinalCta() {
  return (
    <section aria-labelledby="cta-heading" className="mt-24 flex flex-col justify-between gap-8 rounded-card bg-violet p-8 text-white shadow-card md:flex-row md:items-end md:p-12">
      <div className="max-w-3xl">
        <h2 id="cta-heading" className="display text-[28px] font-bold sm:text-[40px]">
          What would your community build?
        </h2>
        <p className="mt-4 text-base text-white/70">One sentence is enough to start, and it&apos;s free during the testnet beta.</p>
      </div>
      <a
        href="#build"
        className="inline-flex w-fit shrink-0 items-center gap-2 rounded-full bg-white py-2 pr-2 pl-5 text-[15px] font-medium text-violet outline-none transition-opacity duration-200 ease-gb hover:opacity-90 focus-visible:shadow-focus"
      >
        Start building
        <span className="grid size-8 place-items-center rounded-full bg-pink text-violet-ink">
          <ArrowRight className="size-3.5" strokeWidth={2.6} aria-hidden />
        </span>
      </a>
    </section>
  );
}
