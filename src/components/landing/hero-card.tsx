import BlurText from "@/components/react-bits/BlurText";
import { HeroRender } from "@/components/landing/hero-render";

/**
 * Centre bento card: radial violet gradient, the chrome/violet hero render
 * (design/landing/assets/hero-b.jpg) and the display headline, as in
 * design/landing/index.html. React Bits (BlurText) is used here only (DESIGN_SYSTEM §5).
 */
export function HeroCard() {
  return (
    <section
      aria-labelledby="hero-title"
      className="relative isolate min-h-[460px] overflow-hidden rounded-card shadow-card sm:min-h-[520px] lg:min-h-0"
      style={{ background: "radial-gradient(70% 70% at 50% 40%, #FFFFFF 0%, #EFE6F7 60%, #E2D2F0 100%)" }}
    >
      <div className="absolute inset-x-0 -top-4 flex justify-center">
        <HeroRender />
      </div>

      <span className="absolute top-6 left-6 z-10 rounded-full bg-white/70 px-3 py-1.5 text-xs font-semibold text-violet">
        AI dApp builder · Celo
      </span>

      <div className="absolute inset-x-0 bottom-0 p-6 sm:p-8">
        <h1 id="hero-title" className="sr-only">
          Say it. Sign it. Ship it.
        </h1>
        <div aria-hidden className="display text-[40px] font-extrabold text-violet-ink sm:text-[52px] xl:text-[58px]">
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
