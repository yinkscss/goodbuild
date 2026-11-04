import BlurText from "@/components/react-bits/BlurText";
import { BuildingBlocks } from "@/components/landing/building-blocks";

/**
 * Centre bento card: radial violet gradient, the "building" visual and the display
 * headline. React Bits (BlurText) is used here only, per DESIGN_SYSTEM §5.
 */
export function HeroCard() {
  return (
    <section
      aria-labelledby="hero-title"
      className="relative isolate flex min-h-[460px] flex-col overflow-hidden rounded-card shadow-card lg:min-h-0"
      style={{ background: "radial-gradient(70% 70% at 50% 40%, #FFFFFF 0%, #EFE6F7 60%, #E2D2F0 100%)" }}
    >
      <span className="absolute top-6 left-6 z-10 rounded-full bg-white/70 px-3 py-1.5 text-xs font-semibold text-violet">
        AI dApp builder · Celo
      </span>

      <div className="flex flex-1 items-start justify-center px-6 pt-6 pb-0">
        <BuildingBlocks className="h-[280px] w-auto max-w-full animate-bob motion-reduce:animate-none sm:h-[320px] lg:h-[340px]" />
      </div>

      <div className="p-6 pt-0 sm:p-8 sm:pt-0">
        <h1 id="hero-title" className="sr-only">
          Say it. Sign it. Ship it.
        </h1>
        <div
          aria-hidden
          className="display text-[40px] font-extrabold text-violet-ink sm:text-[52px] xl:text-[58px]"
        >
          <BlurText text="Say it." trigger="load" delay={120} />
          <div className="flex flex-wrap gap-x-[0.3em]">
            <BlurText text="Sign it." trigger="load" delay={120} />
            <BlurText text="Ship it." trigger="load" delay={160} color="#592E81" />
          </div>
        </div>
      </div>
    </section>
  );
}
