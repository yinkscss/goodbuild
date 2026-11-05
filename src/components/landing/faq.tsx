import { ChevronDown } from "lucide-react";

import { SectionHeading } from "./section-heading";

const QUESTIONS = [
  {
    q: "Do I need to know how to code?",
    a: "No. Describe what you want in everyday words and refine it in the chat. The code stays visible if you want to read it.",
  },
  {
    q: "What is G$?",
    a: "G$ is GoodDollar, a token on the Celo network. Generated apps can collect, split and pay out G$, and GoodBuild treats it as a standard ERC-20 token.",
  },
  {
    q: "Which network do apps run on?",
    a: "Celo Sepolia, Celo's test network, during the beta. Test tokens have no real value, so it is a safe place to try ideas.",
  },
  {
    q: "Can I deploy and share my app today?",
    a: "You can deploy to Celo Sepolia by signing from your own wallet. Publishing your app to your-app.goodbuild.app is coming next.",
  },
  {
    q: "Who can use GoodBuild?",
    a: "You must be 18 or over. GoodBuild isn't available to US persons or in comprehensively sanctioned regions.",
  },
  {
    q: "Is there anything I can't build?",
    a: "Yes. Sports betting is out of scope. GoodBuild builds dApps and websites, but for now there is no separate server or database behind them.",
  },
];

export function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-heading" className="mt-24 scroll-mt-24">
      <SectionHeading id="faq-heading" eyebrow="FAQ" title="Questions people ask first">
        Want the longer version? The docs walk through everything step by step.
      </SectionHeading>
      <div className="rounded-card bg-surface px-8 py-2 shadow-card">
        {QUESTIONS.map((item) => (
          <details key={item.q} className="group border-b border-hairline last:border-0">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-tip py-5 font-medium [&::-webkit-details-marker]:hidden">
              {item.q}
              <ChevronDown className="size-4 shrink-0 text-grey-600 transition-transform duration-200 ease-gb group-open:rotate-180" aria-hidden />
            </summary>
            <p className="max-w-2xl pb-5 text-sm text-grey-600">{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
