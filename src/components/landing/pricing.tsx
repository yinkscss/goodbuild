import { SectionHeading } from "./section-heading";

export function Pricing() {
  return (
    <section id="pricing" aria-labelledby="pricing-heading" className="mt-24 scroll-mt-24">
      <SectionHeading id="pricing-heading" eyebrow="Pricing" title="Pay for what a build costs">
        You see an estimate before each build, so the cost is never a surprise.
      </SectionHeading>
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <article className="flex flex-col justify-between gap-12 rounded-card bg-surface p-8 shadow-card">
          <div>
            <p className="eyebrow">Free start</p>
            <p className="display mt-3 text-[58px] font-extrabold text-violet">Free</p>
          </div>
          <p className="max-w-md text-sm text-grey-600">
            Every new account gets 20 credits of AI free, which covers a few small builds or one
            larger one. On a test network, tokens are free and nothing spends real money.
          </p>
        </article>
        <article className="flex flex-col justify-between gap-12 rounded-card bg-surface p-8 shadow-card">
          <div>
            <p className="eyebrow">After that</p>
            <p className="display mt-3 text-[40px] font-bold">Cost + 25%</p>
          </div>
          <div className="space-y-2 text-sm text-grey-600">
            <p>You pay the actual AI cost of each build plus 25%, shown in US dollars with the G$ amount alongside.</p>
            <p>Network fees for deploys go to the network, from your own wallet.</p>
          </div>
        </article>
      </div>
    </section>
  );
}
