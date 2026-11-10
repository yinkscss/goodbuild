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
    a: "Celo mainnet or Celo Sepolia, your choice for each project. Mainnet uses real money. Sepolia uses test tokens with no value, a safe place to try ideas.",
  },
  {
    q: "Can I deploy and share my app today?",
    a: "Yes, on Celo mainnet or Celo Sepolia, by signing from your own wallet. Then publish the front end to its own address, your-app.goodbuildit.xyz, and share the link.",
  },
  {
    q: "What does publishing do?",
    a: "GoodBuild builds your latest saved version into a website on its own address. Anyone with the link can open it and connect their own wallet. You can update or unpublish it at any time.",
  },
  {
    q: "Can I build games?",
    a: "Yes. Describe the game and GoodBuild builds it to play on a phone or a computer, with sound, a best score and a leaderboard if you want one. Games can charge a G$ entry and pay prizes when the winner is decided by play.",
  },
  {
    q: "Can I build a DAO or a vault?",
    a: "Yes: a club treasury where members vote on spending, or a vault where people deposit and take their money back. Because these hold other people's money, GoodBuild builds them from audited parts, writes tests that try to break them, and won't put one on Celo mainnet until those tests pass. That catches the common attacks, but it isn't a full audit, so get one before a vault holds a lot of real money.",
  },
  {
    q: "Can I build a dashboard?",
    a: "Yes. Describe the numbers you want to see and GoodBuild builds a page with stat cards, charts and tables that read from your contract on Celo or from your app's saved data, and update while the page is open. It works well on a phone.",
  },
  {
    q: "Can my app work inside MiniPay?",
    a: "Yes. MiniPay is Opera's phone wallet for dollar coins (USDT, USDC and USDm). It has no sign-up: it connects the person's wallet on its own, so there is no login to build. Say you want it for MiniPay and GoodBuild builds a phone-sized app that takes payments in dollars, with plain wording and the footer MiniPay asks for. Once it is published, you can submit it to MiniPay's app list.",
  },
  {
    q: "Who can use GoodBuild?",
    a: "You must be 18 or over. GoodBuild isn't available to US persons or in comprehensively sanctioned regions.",
  },
  {
    q: "Is there anything I can't build?",
    a: "Yes. Sports betting and games of chance for money are out of scope. GoodBuild builds dApps, games and websites, but for now there is no separate server behind them.",
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
