import { cn } from "@/lib/utils";
import { SectionHeading } from "./section-heading";

const STEPS = [
  {
    n: "01",
    title: "Describe",
    body: "“A tip jar for our football club that splits G$ 70/30 between coach and kit fund.”",
  },
  {
    n: "02",
    title: "Refine",
    body: "The contract and the front end are written and checked together. Try the live preview and ask for changes in the chat.",
  },
  {
    n: "03",
    title: "Sign & deploy",
    body: "Your wallet signs each contract onto Celo Sepolia. GoodBuild never holds your keys.",
  },
  {
    n: "04",
    title: "Publish",
    body: "Put the app on its own address, your-app.goodbuildit.xyz, and share the link.",
    emphasis: true,
  },
];

/** "From sentence to smart contract": four steps, the last one the single violet card. */
export function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-title" className="mt-24 scroll-mt-24">
      <SectionHeading id="how-title" eyebrow="How it works" title="From sentence to smart contract in one sitting">
        You own the code and the keys. GoodBuild writes, tests and packages. Your wallet does the signing.
      </SectionHeading>
      <ol className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s) => (
          <li
            key={s.n}
            className={cn("flex flex-col rounded-card p-8 shadow-card", s.emphasis ? "bg-violet text-white" : "bg-surface")}
          >
            <span className={cn("display text-2xl", s.emphasis ? "text-pink" : "text-violet")} aria-hidden>
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
