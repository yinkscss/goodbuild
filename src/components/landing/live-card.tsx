import { Check } from "lucide-react";

const FACTS = [
  { title: "Free to start", body: "$0.20 of AI on every new account, then add credits with G$." },
  { title: "Your wallet signs", body: "GoodBuild never holds your keys." },
  { title: "Your own address", body: "Publish your app with one link to share." },
];

/** Left bento card: true facts about GoodBuild, until GoodBuild has real usage numbers to show. */
export function LiveCard() {
  return (
    <section aria-label="Mainnet live" className="flex flex-col rounded-card bg-surface p-6 shadow-card">
      <p className="flex items-center gap-2 text-sm font-medium text-grey-600">
        <span className="size-2 rounded-full bg-success" aria-hidden />
        Live on Celo mainnet
      </p>
      <p className="display mt-4 text-[32px] font-bold">Build on mainnet or testnet</p>
      <ul className="mt-auto space-y-4 pt-8">
        {FACTS.map((fact) => (
          <li key={fact.title} className="flex gap-3">
            <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-tint text-violet" aria-hidden>
              <Check className="size-3.5" />
            </span>
            <span className="text-sm">
              <b className="block font-semibold">{fact.title}</b>
              <span className="text-grey-600">{fact.body}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
