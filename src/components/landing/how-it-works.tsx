import { cn } from "@/lib/utils";

const STEPS = [
  {
    n: "01",
    title: "Describe",
    body: "“A tip jar for our football club that splits G$ 70/30 between coach and kit fund.”",
  },
  {
    n: "02",
    title: "Refine",
    body: "Solidity and React appear side by side. Tweak with follow-ups, preview on Celo Sepolia.",
  },
  {
    n: "03",
    title: "Sign & deploy",
    body: "One signature from your wallet puts it on Celo. Share the link, done.",
    emphasis: true,
  },
];

/** "From sentence to smart contract": three steps, the last one the single violet card. */
export function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-title" className="mt-24 scroll-mt-24">
      <div className="mb-6 flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <h2 id="how-title" className="display max-w-[820px] text-[28px] font-bold sm:text-[40px]">
          From sentence to smart contract in one sitting
        </h2>
        <p className="max-w-sm text-base text-grey-600">
          You own the code and the keys. GoodBuild writes, tests and packages. Your wallet does the signing.
        </p>
      </div>
      <ol className="grid gap-4 md:grid-cols-3">
        {STEPS.map((s) => (
          <li
            key={s.n}
            className={cn("rounded-card p-8 shadow-card", s.emphasis ? "bg-violet text-white" : "bg-surface")}
          >
            <span className="display text-2xl text-pink" aria-hidden>
              {s.n}
            </span>
            <h3 className="mt-5 text-lg font-semibold">{s.title}</h3>
            <p className={cn("mt-2 text-sm", s.emphasis ? "text-white/70" : "text-grey-600")}>{s.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
