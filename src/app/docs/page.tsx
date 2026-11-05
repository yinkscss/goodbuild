import type { ReactNode } from "react";

import { SiteFooter } from "@/components/landing/site-footer";
import { SiteNav } from "@/components/landing/site-nav";

export const metadata = {
  title: "Docs · GoodBuild",
  description: "How to describe, preview and refine a dApp on Celo with GoodBuild, what's live today and what's coming next.",
};

const SECTIONS: Array<{ id: string; title: string; body: ReactNode }> = [
  {
    id: "getting-started",
    title: "Getting started",
    body: (
      <>
        <ol className="list-decimal space-y-2 pl-5">
          <li>Write what you want on the home page, or pick a template. Plain words work best: who uses it, what they do, and how much G$ moves.</li>
          <li>Press Build it, then connect a wallet or sign in with email. Your prompt is kept while you do.</li>
          <li>Confirm you are 18 or over and not a US person. You only do this once.</li>
          <li>Watch the build in the chat. The app appears in the preview when the first build finishes.</li>
        </ol>
        <p>
          A useful first prompt: “A weekly G$ savings circle for 12 members. Everyone deposits 50 G$ every Friday and the pot rotates to one
          member each week.”
        </p>
      </>
    ),
  },
  {
    id: "workspace",
    title: "The workspace",
    body: (
      <>
        <p>Each project has a chat on the left and three tabs on the right.</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong className="font-semibold">Preview</strong> runs your app in the browser, in desktop and mobile sizes. The arrow button opens it in its
            own tab, which follows your build as it happens.
          </li>
          <li>
            <strong className="font-semibold">Code</strong> shows the React front end. It is read-only, so ask for changes in the chat.
          </li>
          <li>
            <strong className="font-semibold">Contract</strong> shows the Solidity, its compiled size and an Unaudited label.
          </li>
        </ul>
        <p>
          Every prompt saves a version. Use the version menu beside the project name to go back. Reverting restores your files, and leaves the chat
          and any deployed contracts as they are.
        </p>
      </>
    ),
  },
  {
    id: "contract-rules",
    title: "Contract rules",
    body: (
      <>
        <p>Generated contracts have to pass a compiler check before a build counts as finished. The check enforces these rules:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>No delegatecall or callcode, selfdestruct, inline assembly, or tx.origin for authorisation.</li>
          <li>Custom errors only, so failures are clear and cheap.</li>
          <li>G$ is an ERC-20 token, never native CELO. Payments use onTokenTransfer or safeTransferFrom.</li>
        </ul>
        <p>
          Contracts build on OpenZeppelin&apos;s audited libraries, but the contract written for you has not been audited. Review it before it handles
          real funds.
        </p>
      </>
    ),
  },
  {
    id: "deploying",
    title: "Deploying and publishing",
    body: (
      <>
        <p>
          <strong className="font-semibold">Deploy</strong> puts your contracts on Celo Sepolia. GoodBuild simulates the deploy first, shows you a summary, and
          your own wallet signs once per contract. If one fails, try again and finished contracts aren&apos;t signed twice. GoodBuild never holds your keys.
        </p>
        <p>
          On Celo Sepolia, apps use a test G$ with a faucet, so nothing has real value. After deploying, GoodBuild submits the contract for public source
          verification on Sourcify.
        </p>
        <p>
          <strong className="font-semibold">Publish is coming next.</strong> It will put your front end on its own address, your-app.goodbuild.app, so you can
          share it.
        </p>
      </>
    ),
  },
  {
    id: "credits",
    title: "Credits and cost",
    body: (
      <>
        <p>Building is free during the testnet beta on Celo Sepolia, and each build shows an estimate of what it would cost.</p>
        <p>
          After the beta, the plan is to bill the actual AI cost of each build plus 25%, shown in US dollars with G$ alongside. Network fees are separate
          and are paid from your own wallet.
        </p>
      </>
    ),
  },
  {
    id: "eligibility",
    title: "Who can use GoodBuild",
    body: (
      <ul className="list-disc space-y-2 pl-5">
        <li>You must be 18 or over.</li>
        <li>GoodBuild isn&apos;t available to US persons or in comprehensively sanctioned regions.</li>
        <li>Sports betting apps aren&apos;t allowed.</li>
        <li>GoodBuild builds dApps and websites. For now there is no separate server or database behind them.</li>
      </ul>
    ),
  },
];

/** Public read-through guide. Say plainly what's live and what isn't. */
export default function DocsPage() {
  return (
    <>
      <SiteNav />
      <main className="mx-auto max-w-[1360px] px-4 sm:px-8">
        <div className="rounded-card bg-surface p-8 shadow-card md:p-12">
          <p className="eyebrow">Docs</p>
          <h1 className="display mt-3 max-w-[820px] text-[28px] font-bold sm:text-[40px]">How GoodBuild works</h1>
          <p className="mt-4 max-w-xl text-base text-grey-600">
            Everything you need to go from an idea to a working dApp on Celo, including what isn&apos;t ready yet.
          </p>
        </div>

        <div className="mt-4 grid items-start gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
          <nav aria-label="On this page" className="rounded-card bg-surface p-6 shadow-card lg:sticky lg:top-24">
            <p className="eyebrow">On this page</p>
            <ul className="mt-4 space-y-2.5 text-sm text-grey-600">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="rounded-full transition-colors duration-200 ease-gb hover:text-violet">
                    {s.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="space-y-4">
            {SECTIONS.map((s) => (
              <section key={s.id} id={s.id} aria-labelledby={`${s.id}-title`} className="scroll-mt-24 rounded-card bg-surface p-8 shadow-card">
                <h2 id={`${s.id}-title`} className="text-xl font-semibold">
                  {s.title}
                </h2>
                <div className="mt-4 max-w-2xl space-y-4 text-base text-ink/80">{s.body}</div>
              </section>
            ))}
          </div>
        </div>
        <SiteFooter />
      </main>
    </>
  );
}
