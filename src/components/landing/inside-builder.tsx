import { Check, Monitor, RotateCcw, Smartphone } from "lucide-react";

import { SectionHeading } from "./section-heading";

const STEPS = [
  { title: "Writing TipJar.sol", detail: "one contract" },
  { title: "Writing App.tsx", detail: "one page" },
  { title: "Compiling with solc 0.8.28", detail: "0 errors · 0 warnings" },
  { title: "Checking the app", detail: "imports and syntax ok" },
];

const CONTRACT = `contract TipJar {
    using SafeERC20 for IERC20;

    error ZeroTip();

    function tip(uint256 amount) external {
        if (amount == 0) revert ZeroTip();
        uint256 toCoach = (amount * coachShare) / 100;
        gd.safeTransferFrom(msg.sender, coach, toCoach);
        gd.safeTransferFrom(msg.sender, kitFund, amount - toCoach);
    }
}`;

/** The workspace, drawn with real UI patterns rather than a screenshot so it stays sharp at any width. */
export function InsideBuilder() {
  return (
    <section id="builder" aria-labelledby="builder-heading" className="mt-24 scroll-mt-24">
      <SectionHeading id="builder-heading" eyebrow="Inside the builder" title="See every step, read every line">
        Chat on one side, your running app on the other. Nothing happens behind a curtain.
      </SectionHeading>
      <div className="grid gap-4 lg:grid-cols-[1fr_1.5fr]">
        <article className="flex flex-col justify-between gap-8 rounded-card bg-surface p-8 shadow-card">
          <div className="space-y-3" aria-hidden>
            <p className="ml-auto w-fit max-w-[85%] rounded-block bg-tint px-4 py-3 text-sm">
              A tip jar for Ikeja FC that splits G$ 70/30 between the coach and the kit fund
            </p>
            <ul className="space-y-3 rounded-block bg-canvas p-4">
              {STEPS.map((s) => (
                <li key={s.title} className="flex items-start gap-3 text-sm">
                  <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-violet text-white">
                    <Check className="size-2.5" strokeWidth={3.5} />
                  </span>
                  <span>
                    <span className="block font-medium">{s.title}</span>
                    <span className="block text-xs text-grey-600">{s.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-lg font-semibold">It checks its own work</h3>
            <p className="mt-2 text-sm text-grey-600">
              Each build compiles the contract and checks the app. If something fails, the agent reads the error and fixes
              it, up to three times, before handing back to you.
            </p>
          </div>
        </article>

        <article className="flex min-w-0 flex-col justify-between gap-8 rounded-card bg-surface p-8 shadow-card">
          <pre className="overflow-x-auto rounded-block bg-canvas p-5 font-mono text-[13px] leading-5" aria-label="Example of a generated contract">
            <code>{CONTRACT}</code>
          </pre>
          <div>
            <h3 className="text-lg font-semibold">The contract is yours to read</h3>
            <p className="mt-2 text-sm text-grey-600">
              The Contract tab shows the Solidity GoodBuild wrote, with G$ handled as an ERC-20 token and clear custom errors.
              The Code tab shows the React front end.
            </p>
          </div>
        </article>

        <article className="rounded-card bg-surface p-8 shadow-card">
          <div className="flex w-fit gap-1 rounded-full bg-tint p-1" aria-hidden>
            <span className="rounded-full bg-surface p-2 text-violet shadow-card">
              <Monitor className="size-4" />
            </span>
            <span className="rounded-full p-2 text-grey-600">
              <Smartphone className="size-4" />
            </span>
          </div>
          <h3 className="mt-6 text-lg font-semibold">A preview that really runs</h3>
          <p className="mt-2 text-sm text-grey-600">
            Your app runs in the browser as you build it, in desktop and mobile sizes. If it crashes, one click sends the error
            to the agent.
          </p>
        </article>

        <article className="rounded-card bg-surface p-8 shadow-card">
          <span className="grid size-9 place-items-center rounded-full bg-tint text-violet" aria-hidden>
            <RotateCcw className="size-4" />
          </span>
          <h3 className="mt-6 text-lg font-semibold">Every prompt saves a version</h3>
          <p className="mt-2 text-sm text-grey-600">
            Try a bold change without worrying. Go back to any earlier version in two clicks. Reverting your files never touches a
            contract you have already deployed.
          </p>
        </article>
      </div>
    </section>
  );
}
