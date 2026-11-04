import Image from "next/image";
import cube from "../../../public/assets/chrome-cube.jpg";

/**
 * Right bento card. DESIGN_SYSTEM §8 fix 2: the cube is enlarged to fill the card and
 * the text is anchored to the bottom (justify-between), so there's no dead white gap.
 */
export function TemplateCard() {
  return (
    <section aria-labelledby="templates-title" className="flex flex-col justify-between rounded-card bg-surface p-6 shadow-card">
      <div className="relative -mx-2 -mt-2 flex flex-1 items-center justify-center">
        <Image
          src={cube}
          alt=""
          priority={false}
          sizes="(min-width: 1024px) 300px, 80vw"
          className="aspect-square w-full max-w-[320px] object-contain mix-blend-multiply lg:max-w-none"
        />
      </div>
      <div>
        <p className="eyebrow">Audited building blocks</p>
        <h3 id="templates-title" className="mt-2 text-xl leading-snug font-semibold">
          Every contract starts from battle-tested blocks.
        </h3>
        <p className="mt-2 text-sm text-grey-600">
          Savings circles, tip jars, ticketing and G$ payouts, built on audited OpenZeppelin contracts, then shaped to
          your prompt.
        </p>
      </div>
    </section>
  );
}
