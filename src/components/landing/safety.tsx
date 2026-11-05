import { ShieldAlert } from "lucide-react";

import { SectionHeading } from "./section-heading";

const BLOCKED = ["delegatecall", "selfdestruct", "inline assembly", "tx.origin auth"];

export function Safety() {
  return (
    <section id="safety" aria-labelledby="safety-heading" className="mt-24 scroll-mt-24">
      <SectionHeading id="safety-heading" eyebrow="Safety" title="Careful by default, honest about the limits">
        Real money deserves plain answers about what GoodBuild does and doesn&apos;t protect you from.
      </SectionHeading>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr]">
        <article className="flex flex-col justify-between gap-12 rounded-card bg-surface p-8 shadow-card md:col-span-2 lg:col-span-1">
          <p className="display text-[28px] font-bold text-violet-ink">Your keys never leave your wallet</p>
          <p className="text-sm text-grey-600">
            GoodBuild prepares the transaction and your wallet signs it. We can&apos;t deploy, move funds or act for you, because we
            never hold your private key.
          </p>
        </article>
        <article className="flex flex-col justify-between gap-8 rounded-card bg-surface p-8 shadow-card">
          <ul className="flex flex-wrap gap-2" aria-label="Blocked in generated contracts">
            {BLOCKED.map((b) => (
              <li key={b} className="rounded-full bg-tint px-3.5 py-1.5 font-mono text-xs text-violet">
                {b}
              </li>
            ))}
          </ul>
          <div>
            <h3 className="text-lg font-semibold">Risky patterns are refused</h3>
            <p className="mt-2 text-sm text-grey-600">
              A compiler check rejects these in generated contracts, which build on OpenZeppelin&apos;s audited libraries.
            </p>
          </div>
        </article>
        <article className="flex flex-col justify-between gap-8 rounded-card bg-surface p-8 shadow-card">
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-warning/10 px-3 py-1.5 text-xs font-medium text-warning">
            <ShieldAlert className="size-3.5" aria-hidden /> Unaudited
          </span>
          <div>
            <h3 className="text-lg font-semibold">Generated code isn&apos;t audited</h3>
            <p className="mt-2 text-sm text-grey-600">
              The libraries are audited. The contract written for you isn&apos;t, so we label it clearly. Review it before it handles
              real funds.
            </p>
          </div>
        </article>
      </div>
    </section>
  );
}
