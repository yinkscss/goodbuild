"use client";

import * as React from "react";
import { AlertTriangle, Check, ChevronDown, Copy, ExternalLink, Loader2 } from "lucide-react";
import { formatUnits } from "viem";

import { BuyDialog } from "@/components/buy/buy-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useElapsed } from "@/components/ui/wait";
import { useAuth } from "@/lib/auth/context";
import { chainLabel, explorerAddressUrl, explorerTxUrl } from "@/lib/deploy/explorer";
import type { StepPart, StepPhase } from "@/lib/deploy/run";
import { CAN_BE_CHANGED_LABEL, isUpgradeableChain } from "@/lib/deploy/upgradeable";
import { shortAddress } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useDeploy, type DeployState, type StepView } from "./use-deploy";

type Deploy = ReturnType<typeof useDeploy>;

/** Once someone chooses to skip the Sepolia suggestion, it stays skipped until the page reloads. */
let mainnetAcknowledged = false;

const PHASE_COPY: Record<StepPhase, string> = {
  waiting: "Waiting",
  reused: "Already deployed",
  simulating: "Checking on Celo…",
  signing: "Confirm in your wallet",
  broadcasting: "Sending to Celo…",
  recording: "Saving…",
  unsaved: "Sent, not saved yet",
  uncertain: "Waiting on Celo",
  done: "Deployed",
  failed: "Failed",
};

/** A contract behind a proxy takes two transactions (D33), and the first changes nothing anyone uses. */
const PART_COPY: Record<StepPart, string> = {
  code: "Step 1 of 2, putting the new code on Celo",
  proxy: "Step 2 of 2, creating its permanent address",
  switch: "Step 2 of 2, switching to the new code",
};

/** Sign → Broadcast → Verified for the contract being deployed (DESIGN_SYSTEM §4). */
export function stageIndex(step: StepView | undefined): { active: number; done: number } {
  if (!step) return { active: 0, done: 0 };
  switch (step.phase) {
    case "simulating":
    case "signing":
      return { active: 0, done: 0 };
    case "broadcasting":
    case "recording":
      return { active: 1, done: 1 };
    case "unsaved":
      // Signed and mined. Only GoodBuild's record is missing, so nothing is marked as failed.
      return { active: -1, done: 2 };
    case "uncertain":
      // Sent and not confirmed (GB-03): it sits on Broadcast, not failed.
      return { active: 1, done: 1 };
    case "done":
    case "reused":
      return step.verify === "verified" ? { active: 3, done: 3 } : { active: 2, done: 2 };
    case "failed":
      // With a transaction it got past signing, so the failure belongs on Broadcast.
      return step.txHash ? { active: 1, done: 1 } : { active: 0, done: 0 };
    default:
      return { active: -1, done: 0 };
  }
}

/** Sign → Broadcast → Verified as a rail with a token that travels (wait-state pick D3). */
function Stepper({ step }: { step: StepView | undefined }) {
  const { active, done } = stageIndex(step);
  const failed = step?.phase === "failed";
  const verifying = step && (step.phase === "done" || step.phase === "reused") && step.verify !== "verified";
  const labels = ["Sign", "Broadcast", "Verified"];
  const at = Math.min(Math.max(active, 0), 2);
  const all = done >= 3;
  return (
    <ol className="relative mx-3 mt-1 mb-7 flex items-start justify-between" aria-label="Deploy progress">
      <span className="absolute top-3 right-3 left-3 h-[3px] -translate-y-1/2 rounded-full bg-ink/10" aria-hidden />
      <span
        className="absolute top-3 left-3 h-[3px] -translate-y-1/2 rounded-full bg-violet transition-[width] duration-500 ease-gb"
        style={{ width: `calc((100% - 1.5rem) * ${all ? 1 : done / 2})` }}
        aria-hidden
      />
      {!all && !failed && active >= 0 && (
        <span
          className="absolute top-3 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet shadow-focus transition-[left] duration-500 ease-gb"
          style={{ left: `calc(0.75rem + (100% - 1.5rem) * ${at / 2})` }}
          aria-hidden
        />
      )}
      {labels.map((label, i) => {
        const complete = i < done;
        const current = i === active && !complete;
        return (
          <li key={label} className="relative flex w-6 flex-col items-center" aria-current={current ? "step" : undefined}>
            <span
              className={cn(
                "relative grid size-6 place-items-center rounded-full text-[11px] font-semibold transition-colors duration-200 ease-gb",
                complete ? "bg-success text-white" : current && failed ? "bg-danger text-white" : current ? "bg-surface text-violet shadow-card" : "bg-tint text-grey-600",
              )}
            >
              {complete ? <Check className="size-3.5" /> : current && failed ? "!" : current && (i < 2 || verifying) ? <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" /> : i + 1}
            </span>
            <span className={cn("absolute top-8 text-sm whitespace-nowrap", complete || current ? "font-medium text-ink" : "text-grey-600")}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 text-sm">
      <dt className="text-grey-600">{label}</dt>
      <dd className="min-w-0 text-right font-medium">{children}</dd>
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="grid size-7 place-items-center rounded-full bg-canvas text-grey-600 outline-none hover:bg-tint hover:text-violet focus-visible:shadow-focus"
      aria-label={copied ? "Copied" : "Copy address"}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}

function VerifyChip({ status }: { status: StepView["verify"] }) {
  if (status === "verified") return <span className="rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success">Verified on Sourcify</span>;
  if (status === "failed" || status === "unsupported") return <span className="rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-semibold text-warning">Not verified yet</span>;
  return <span className="rounded-full bg-tint px-2 py-0.5 text-[11px] font-semibold text-violet">Verifying…</span>;
}

const FAUCET_URL = "https://faucet.celo.org/celo-sepolia";

/** Step-by-step: copy your wallet address, open the faucet, paste it, come back. Test CELO is free. */
export function FaucetGuide({ className }: { className?: string }) {
  const { wallet } = useAuth();
  const steps = [
    {
      title: "Copy your wallet address",
      body: (
        <>
          {wallet ? (
            <span className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-full bg-canvas px-3 py-1.5 font-mono text-xs">{wallet.address}</code>
              <CopyButton value={wallet.address} />
            </span>
          ) : (
            <span className="mt-1 block text-grey-600">Connect your wallet from the top bar first.</span>
          )}
          <span className="mt-1 block text-xs text-grey-600">You can also click your wallet button in the top bar and choose Copy address.</span>
        </>
      ),
    },
    {
      title: "Open the Celo Sepolia faucet",
      body: (
        <a className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-violet hover:underline" href={FAUCET_URL} target="_blank" rel="noreferrer">
          faucet.celo.org/celo-sepolia <ExternalLink className="size-3" aria-hidden />
        </a>
      ),
    },
    { title: "Paste your address and request CELO", body: <span className="mt-1 block text-xs text-grey-600">Pick Celo Sepolia, paste the address, and confirm. The test CELO arrives in under a minute.</span> },
    { title: "Come back and try again", body: <span className="mt-1 block text-xs text-grey-600">Test CELO has no value. It only pays the network fee on Sepolia.</span> },
  ];
  return (
    <ol className={cn("space-y-3 rounded-tip bg-surface p-3 text-sm", className)} aria-label="Get free test CELO">
      {steps.map((st, i) => (
        <li key={st.title} className="flex gap-3">
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-tint text-xs font-bold text-violet">{i + 1}</span>
          <div className="min-w-0 flex-1">
            <p className="font-medium">{st.title}</p>
            {st.body}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Where to send CELO: email wallets start empty, and their owners may not know the address. */
function FundWallet({ chainId }: { chainId: number }) {
  const { wallet } = useAuth();
  const [buying, setBuying] = React.useState(false);
  if (!wallet) return null;
  if (chainId !== 42220) return <FaucetGuide className="mt-3" />;
  return (
    <div className="mt-3 rounded-tip bg-surface p-3 text-sm">
      <p className="text-grey-600">Send a little CELO to your wallet, then try again.</p>
      <div className="mt-2 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate font-mono text-xs">{wallet.address}</code>
        <CopyButton value={wallet.address} />
      </div>
      <Button variant="secondary" className="mt-3 w-full" onClick={() => setBuying(true)}>
        Buy CELO with naira
      </Button>
      <BuyDialog open={buying} onOpenChange={setBuying} defaultAsset="celo" />
    </div>
  );
}

function ErrorCard({ deploy, onFix, chainId }: { deploy: Deploy; onFix: (prompt: string) => void; chainId: number }) {
  const { state } = deploy;
  const error = state.error;
  if (!error) return null;
  const fromBuilder = error.at === "prepare" && ["manifest_missing", "manifest_invalid", "compile_failed"].includes(error.code ?? "");
  const opcode = error.kind === "opcode";
  const refused = error.code === "upgrade_refused";
  const notReady = error.code === "upgradeable_not_ready";
  const review = error.code === "needs_owner_review";
  const exploitTests = error.code === "exploit_tests_failed";
  // Waiting on the network, not a failure: nothing was lost, and Try again is the whole fix.
  const waiting = error.kind === "not_saved" || error.kind === "timeout";
  if (review) return <OwnerReview deploy={deploy} />;
  if (error.kind === "uncertain") return <WaitingOnCelo deploy={deploy} chainId={chainId} />;
  const heading = refused
    ? "We can't upgrade this safely"
    : notReady
      ? "Not ready to be upgradeable"
      : opcode
        ? "Celo can't run this contract yet"
        : error.kind === "not_saved"
          ? `${error.at} isn't saved yet`
          : error.kind === "timeout"
            ? "Celo didn't answer"
            : error.at === "prepare"
              ? "We couldn't prepare the deploy"
              : `Couldn't deploy ${error.at}`;
  return (
    <div className="mt-5 rounded-block bg-canvas p-4" role="alert">
      <div className="flex items-start gap-3">
        <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", waiting ? "bg-warning" : "bg-danger")} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{heading}</p>
          <p className="mt-1 text-sm text-grey-600">{error.message}</p>
          {opcode && (
            <p className="mt-1 text-sm text-grey-600">
              {error.opcodes.length ? `It uses ${error.opcodes.join(", ")}. ` : ""}Rebuilding for an older Celo-compatible setting usually fixes it, and nothing has been spent.
            </p>
          )}
          {state.stage === "error" && state.steps.some((s) => s.phase === "done" || s.phase === "reused") && !opcode && (
            <p className="mt-1 text-sm text-grey-600">Contracts already deployed stay deployed. Trying again continues from where it stopped.</p>
          )}
          {error.kind === "insufficient_funds" && <FundWallet chainId={state.plan?.chainId ?? chainId} />}
          <div className="mt-3 flex flex-wrap gap-2">
            {opcode && state.evmVersion === "cancun" && (
              <Button variant="chipSelected" size="chip" onClick={() => void deploy.prepare("paris")}>
                Rebuild for older Celo
              </Button>
            )}
            {fromBuilder && (
              <Button
                variant="chipSelected"
                size="chip"
                onClick={() => onFix(`The deploy failed: ${error.message}\n${error.logs.join("\n")}\nFix contracts/deploy.json (and the contracts if needed) so every contract deploys. Follow the deploy manifest rule.`)}
              >
                Try fix
              </Button>
            )}
            {refused && (
              <>
                <Button variant="chipSelected" size="chip" onClick={() => void deploy.prepare(state.evmVersion, { fresh: true })}>
                  Deploy as a new contract
                </Button>
                <Button
                  variant="chip"
                  size="chip"
                  onClick={() => onFix(`GoodBuild refused to upgrade the live contract: ${error.message}\n${error.logs.join("\n")}\nChange the contract so its existing state variables keep the same name, type and order, and new ones go after them. Follow the upgradeable rules.`)}
                >
                  Ask the builder to keep the data
                </Button>
              </>
            )}
            {notReady && (
              <>
                <Button
                  variant="chipSelected"
                  size="chip"
                  onClick={() => onFix(`Make this project's contracts ready to be upgradeable. Follow the upgradeable rules in the project context.\n${error.logs.join("\n")}`)}
                >
                  Ask the builder to convert them
                </Button>
                <Button variant="chip" size="chip" onClick={() => void deploy.setUpgradeable(false)}>
                  Turn upgrades off
                </Button>
              </>
            )}
            {exploitTests && (
              <Button
                variant="chipSelected"
                size="chip"
                onClick={() => onFix(`The deploy to Celo was stopped because the contract holds other people's money and its exploit tests don't all pass:\n${error.logs.join("\n")}\nAdd or fix the exploit tests (contracts/test/<Name>.t.sol) and fix the contract if a test shows a real problem. Call add_kit("dao-vault") for how to write them.`)}
              >
                Ask the builder to fix them
              </Button>
            )}
            {!opcode && !fromBuilder && !refused && !notReady && !exploitTests && (
              <Button variant="chipSelected" size="chip" onClick={() => (error.at === "prepare" ? void deploy.prepare(state.evmVersion) : deploy.retry())}>
                Try again
              </Button>
            )}
          </div>
          {error.logs.length > 0 && (
            <details className="group mt-3">
              <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-violet">
                Logs <ChevronDown className="size-3 transition-transform group-open:rotate-180" />
              </summary>
              <pre className="mt-2 max-h-40 overflow-auto rounded-tip bg-surface p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-grey-600">{error.logs.join("\n")}</pre>
            </details>
          )}
        </div>
      </div>
      <span className="sr-only">{chainLabel(chainId)}</span>
    </div>
  );
}

/**
 * GB-02: the contract takes in other people's money in a way GoodBuild's vault and DAO tests weren't
 * written for. Its general exploit tests passed; the owner must confirm they reviewed it before mainnet,
 * and the server records when they did. Nothing here calls the contract safe.
 */
function OwnerReview({ deploy }: { deploy: Deploy }) {
  const { state } = deploy;
  const [checked, setChecked] = React.useState(false);
  const error = state.error!;
  return (
    <div className="mt-5 rounded-block bg-warning/10 p-4" role="alert">
      <p className="text-sm font-semibold">Review this contract before it goes to Celo</p>
      <p className="mt-1 text-sm text-grey-600">{error.message}</p>
      {error.logs.length > 0 && (
        <>
          <p className="mt-3 text-sm font-medium">Where it takes in money</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-grey-600">
            {error.logs.map((line) => (
              <li key={line} className="break-words">{line}</li>
            ))}
          </ul>
        </>
      )}
      <p className="mt-3 text-sm text-grey-600">Check who can take money out, and when, and that nobody else can change the rules. If anything is unclear, ask the builder to explain it before you deploy.</p>
      <label className="mt-3 flex cursor-pointer items-start gap-3 text-sm">
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-violet" />
        <span className="text-grey-600">I&apos;ve reviewed where money goes in and out, and I understand GoodBuild hasn&apos;t audited this contract.</span>
      </label>
      <Button variant="primary" className="mt-3 w-full" disabled={!checked} onClick={() => void deploy.prepare(state.evmVersion, { ownerReviewed: true })}>
        Continue
      </Button>
    </div>
  );
}

/**
 * GB-03: a deploy transaction was sent and Celo hasn't confirmed it. It may still go through, so the
 * first answer is Check again, which signs nothing unless the chain shows it was dropped. Deploying again
 * anyway is possible, behind a warning, so an odd chain state can't leave the owner stuck.
 */
function WaitingOnCelo({ deploy, chainId }: { deploy: Deploy; chainId: number }) {
  const { state } = deploy;
  const [confirming, setConfirming] = React.useState(false);
  const error = state.error!;
  const step = state.steps.find((s) => s.name === error.at);
  const hash = step?.txHash;
  const network = state.plan?.chainId ?? chainId;
  return (
    <div className="mt-5 rounded-block bg-canvas p-4" role="alert">
      <div className="flex items-start gap-3">
        <span className="mt-1.5 size-2 shrink-0 rounded-full bg-warning" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Waiting on Celo</p>
          <p className="mt-1 text-sm text-grey-600">{error.message}</p>
          {hash && (
            <a href={explorerTxUrl(network, hash)} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-violet hover:underline">
              See the transaction on the explorer
            </a>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="chipSelected" size="chip" onClick={() => deploy.checkAgain()}>
              Check again
            </Button>
            {hash && !confirming && (
              <Button variant="chip" size="chip" onClick={() => setConfirming(true)}>
                Deploy again anyway
              </Button>
            )}
          </div>
          {hash && confirming && (
            <div className="mt-3 rounded-tip bg-warning/10 p-3 text-sm">
              <p className="text-grey-600">This asks your wallet for a new transaction. If the first one still goes through, you&apos;ll have two contracts and pay the network fee twice.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button variant="chipSelected" size="chip" onClick={() => deploy.deployAgain(hash)}>
                  Deploy again
                </Button>
                <Button variant="chip" size="chip" onClick={() => setConfirming(false)}>
                  Keep waiting
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** What a contract left behind still holds, in words. Null balance: we couldn't read it. */
export function keepsLine(gdBalance: string | null): string {
  if (gdBalance === null) return "keeps any funds it holds and its history";
  if (BigInt(gdBalance) === BigInt(0)) return "keeps its history and holds no G$";
  const amount = Number(formatUnits(BigInt(gdBalance), 18)).toLocaleString("en-US", { maximumFractionDigits: 2 });
  return `keeps its ${amount} G$ and its history`;
}

function ReplaceNotice({ state }: { state: DeployState }) {
  const replaces = state.plan?.replaces ?? [];
  if (!replaces.length) return null;
  const many = replaces.length > 1;
  return (
    <div className="mt-3 rounded-block bg-warning/10 p-4 text-sm" role="status">
      <p className="flex items-start gap-2 font-semibold">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        This creates {many ? "new contracts" : "a new contract"}. Deployed contracts can&apos;t be changed.
      </p>
      <ul className="mt-2 space-y-1 text-grey-600">
        {replaces.map((r) => (
          <li key={r.address}>
            The old {r.name} at <code className="font-mono text-xs">{shortAddress(r.address)}</code> {keepsLine(r.gdBalance)}. Nothing moves across.
          </li>
        ))}
      </ul>
      <p className="mt-2 text-grey-600">Your project switches to the new {many ? "contracts" : "contract"}. A published app stays on the old {many ? "ones" : "one"} until you publish again. If the old {many ? "ones hold" : "one holds"} funds, the chat will show what you can do next.</p>
    </div>
  );
}

/** The trial option, on testnet only. The server enforces that too (D33). */
function UpgradeableRow({ deploy }: { deploy: Deploy }) {
  const { state } = deploy;
  const on = Boolean(state.plan?.upgradeable);
  return (
    <Row label="Can be changed later">
      <span className="flex flex-wrap items-center justify-end gap-2">
        <span className="rounded-full bg-tint px-2 py-0.5 text-[11px] font-semibold text-violet">Testnet trial</span>
        {on ? "On" : "Off"}
        <Button variant="chip" size="chip" disabled={state.stage !== "ready"} onClick={() => void deploy.setUpgradeable(!on)}>
          {on ? "Turn off" : "Turn on"}
        </Button>
      </span>
    </Row>
  );
}

/** Before an upgradeable deploy: what stays, what changes and what will be asked of the wallet. */
function UpgradeNotice({ state }: { state: DeployState }) {
  if (!state.plan?.upgradeable) return null;
  const upgrades = state.plan.upgrades ?? [];
  const firsts = state.steps.filter((s) => s.phase !== "reused").length - upgrades.length;
  if (!upgrades.length && firsts <= 0) return null;
  return (
    <div className="mt-3 rounded-block bg-tint p-4 text-sm text-violet-ink" role="status">
      {upgrades.length > 0 ? (
        <>
          <p className="font-semibold">This upgrades {upgrades.map((u) => u.name).join(", ")}. The address stays the same.</p>
          <ul className="mt-2 space-y-1">
            {upgrades.map((u) => (
              <li key={u.address}>
                {u.name} at <code className="font-mono text-xs">{shortAddress(u.address)}</code> keeps its funds and data.
              </li>
            ))}
          </ul>
          <p className="mt-2">You&apos;ll confirm twice for each: first to put the new code on Celo, which changes nothing yet, then to switch to it. A published app keeps working at the same address; publish again to show new features.</p>
        </>
      ) : (
        <>
          <p className="font-semibold">Your wallet will be able to change this contract later, at the same address.</p>
          <p className="mt-2">You&apos;ll confirm twice for each contract: once for the code and once for its permanent address. Only your wallet can change it, and you can lock it for good. Published apps show &quot;{CAN_BE_CHANGED_LABEL}&quot;.</p>
        </>
      )}
    </div>
  );
}

/** Give up the right to change a contract. It can't be undone, so it asks twice. */
function LockContract({ name, deploy }: { name: string; deploy: Deploy }) {
  const [step, setStep] = React.useState<"idle" | "confirm" | "locking" | "failed">("idle");
  if (step === "idle") {
    return (
      <button type="button" className="mt-1.5 block text-[11px] font-medium text-violet hover:underline" onClick={() => setStep("confirm")}>
        Lock it so it can never change
      </button>
    );
  }
  return (
    <div className="mt-2 rounded-tip bg-warning/10 p-3 text-sm" role="alert">
      <p>Nobody, including you, will ever be able to change {name} again. This can&apos;t be undone.</p>
      {step === "failed" && <p className="mt-1 text-grey-600">That didn&apos;t go through. Nothing changed.</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          variant="chipSelected"
          size="chip"
          disabled={step === "locking"}
          onClick={() => {
            setStep("locking");
            deploy.lockContract(name).catch(() => setStep("failed"));
          }}
        >
          {step === "locking" ? "Check your wallet" : "Lock it for good"}
        </Button>
        <Button variant="chip" size="chip" disabled={step === "locking"} onClick={() => setStep("idle")}>
          Keep it changeable
        </Button>
      </div>
    </div>
  );
}

function Success({ state, chainId, deploy }: { state: DeployState; chainId: number; deploy: Deploy }) {
  const upgraded = (state.plan?.upgrades ?? []).length > 0;
  return (
    <div className="mt-5">
      <div className="relative mx-auto grid size-14 place-items-center">
        <span className="gb-burst absolute inset-0 rounded-full bg-pink/40" aria-hidden />
        <span className="relative grid size-14 place-items-center rounded-full bg-success text-white">
          <Check className="size-7" />
        </span>
      </div>
      <p className="mt-3 text-center text-sm text-grey-600">
        {upgraded ? "Upgraded. Same address, and its funds and data are where they were. " : ""}
        {state.steps.length > 1 ? "All contracts are live" : "Your contract is live"} on {chainLabel(chainId)}. Your app now uses {state.steps.length > 1 ? "these addresses" : "this address"}.
      </p>
      <ul className="mt-4 space-y-2">
        {state.steps.map((s) => (
          <li key={s.name} className="rounded-block bg-canvas p-3.5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold">{s.name}</span>
              <VerifyChip status={s.verify} />
            </div>
            {s.address && (
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate font-mono text-xs text-grey-600">{s.address}</code>
                <CopyButton value={s.address} />
                <a
                  href={explorerAddressUrl(chainId, s.address)}
                  target="_blank"
                  rel="noreferrer"
                  className="grid size-7 place-items-center rounded-full bg-canvas text-grey-600 outline-none hover:bg-tint hover:text-violet focus-visible:shadow-focus"
                  aria-label={`View ${s.name} on the explorer`}
                >
                  <ExternalLink className="size-3.5" />
                </a>
              </div>
            )}
            {state.plan?.proxies?.[s.name]?.authority === "locked" ? (
              <p className="mt-1.5 text-[11px] text-grey-600">Locked: nobody can change this contract now.</p>
            ) : state.plan?.proxies?.[s.name]?.authority === "you" || (state.plan?.upgradeable && s.phase === "done") ? (
              <p className="mt-1.5 text-[11px] text-grey-600">{CAN_BE_CHANGED_LABEL}, by your wallet only.</p>
            ) : null}
            {s.txHash && (
              <a href={explorerTxUrl(chainId, s.txHash)} target="_blank" rel="noreferrer" className="mt-1.5 inline-block text-[11px] text-violet hover:underline">
                Transaction {shortAddress(s.txHash)}
              </a>
            )}
            {state.plan?.proxies?.[s.name]?.authority === "you" && <LockContract name={s.name} deploy={deploy} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Deploy modal (DESIGN_SYSTEM §4): 560px, summary list, Sign → Broadcast → Verified. */
export function DeployModal({
  open,
  onOpenChange,
  deploy,
  chainId,
  onFix,
  onPublish,
  switching = false,
  onSwitchNetwork,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deploy: Deploy;
  chainId: number;
  onFix: (prompt: string) => void;
  onPublish?: () => void;
  switching?: boolean;
  /** Moves the project to another network. Without it the network is fixed for the project. */
  onSwitchNetwork?: (chainId: number) => Promise<void>;
}) {
  const auth = useAuth();
  const { state } = deploy;
  const running = state.stage === "running";
  const wrongAccount = Boolean(auth.user && auth.wallet && auth.wallet.address.toLowerCase() !== auth.user.wallet.toLowerCase());
  const [faucet, setFaucet] = React.useState<"idle" | "claiming" | "claimed" | "failed">("idle");
  const [confirmMainnet, setConfirmMainnet] = React.useState(false);
  const [testTip, setTestTip] = React.useState(false);
  const [showFaucet, setShowFaucet] = React.useState(false);
  const isMainnet = (state.plan?.chainId ?? chainId) === 42220;
  const todo = state.steps.filter((s) => s.phase !== "reused" && s.phase !== "done").length;
  const current = state.steps.find((s) => !["waiting", "reused", "done"].includes(s.phase)) ?? [...state.steps].reverse().find((s) => s.phase === "done" || s.phase === "reused") ?? state.steps[0];
  const upgrading = (state.plan?.upgrades ?? []).length > 0;
  const waited = useElapsed(running, `${current?.name}:${current?.phase}`);
  // "Nothing was charged" is true only before this run's first transaction; a second contract or
  // the second step of a proxied one follows a transaction that already cost gas.
  const nothingSentYet = current?.phase === "signing" && (!current.part || current.part === "code") && !state.steps.some((s) => s.phase === "done" || s.phase === "reused");
  const waitHint =
    current?.phase === "signing"
      ? waited >= 30
        ? `Still nothing? Open your wallet app and look for a pending request.${nothingSentYet ? " Nothing has been sent, so nothing has been charged." : ""}`
        : waited >= 8
          ? "Still waiting for your signature. If you don't see a request, open your wallet app."
          : null
      : current?.phase === "broadcasting" && waited >= 60
        ? "Celo is taking longer than usual. Your transaction is sent, so it is safe to wait."
        : null;

  function handleOpenChange(next: boolean) {
    if (!next && running) return; // a signature is pending; don't strand it
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:w-[560px]" onInteractOutside={(e) => running && e.preventDefault()}>
        <p className="eyebrow pr-10">{state.stage === "done" ? "Done" : "You sign, we build"}</p>
        <DialogTitle className="display mt-2 pr-10 text-[28px] font-extrabold">{state.stage === "done" ? "Live on Celo" : upgrading ? "Upgrade on Celo" : "Deploy to Celo"}</DialogTitle>
        <DialogDescription className="mt-2 text-sm text-grey-600">
          {state.stage === "done" ? "Everything is deployed and saved to your project." : "Your own wallet signs and pays the network fee. GoodBuild never holds your keys."}
        </DialogDescription>

        {state.stage === "preparing" && (
          <div className="mt-6 space-y-3" aria-label="Preparing">
            <div className="skeleton h-10 rounded-block motion-reduce:animate-none" />
            <div className="skeleton h-10 rounded-block motion-reduce:animate-none" />
            <div className="skeleton h-10 rounded-block motion-reduce:animate-none" />
          </div>
        )}

        {onSwitchNetwork && !running && state.stage !== "done" && (
          <div role="radiogroup" aria-label="Network" className="mt-5 flex rounded-full bg-tint p-1 text-sm font-medium">
            {([[42220, "Celo mainnet"], [11142220, "Celo Sepolia (testnet)"]] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={(state.plan?.chainId ?? chainId) === id}
                disabled={switching || state.stage === "preparing"}
                onClick={() => (state.plan?.chainId ?? chainId) !== id && void onSwitchNetwork(id)}
                className={cn("flex-1 rounded-full px-3 py-2 transition-colors", (state.plan?.chainId ?? chainId) === id ? "bg-surface text-ink shadow-card" : "text-grey-600")}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {state.plan && state.stage !== "done" && state.stage !== "preparing" && (
          <>
            <dl className="mt-5 divide-y divide-ink/5 rounded-block bg-canvas px-4">
              <Row label={state.steps.length > 1 ? "Contracts, in order" : "Contract"}>
                <ol className="space-y-1">
                  {state.steps.map((s, i) => (
                    <li key={s.name} className="flex items-center justify-end gap-2">
                      <span>
                        {state.steps.length > 1 && <span className="mr-1.5 text-grey-400">{i + 1}.</span>}
                        {s.name}
                      </span>
                      <StepBadge step={s} />
                    </li>
                  ))}
                </ol>
              </Row>
              <Row label="Network">
                {chainLabel(state.plan.chainId)}
                {state.plan.chainId !== 42220 && <span className="ml-2 rounded-full bg-tint px-2 py-0.5 text-[11px] font-semibold text-violet">Testnet</span>}
              </Row>
              <Row label="Estimated network fee">{state.feeCelo ? `≈ ${state.feeCelo} CELO` : "Calculated as you sign"}</Row>
              <Row label="Built with">
                solc {state.plan.compilerVersion.split("+")[0]} · EVM {state.evmVersion}
                {state.evmVersion === "paris" && <span className="block text-xs font-normal text-grey-600">OpenZeppelin {state.plan.openZeppelin}</span>}
              </Row>
              <Row label="Review">
                <span className="rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-semibold text-warning">Unaudited</span>
                {state.plan.chainId === 42220 && <span className="block text-xs font-normal text-grey-600">Passing GoodBuild&apos;s checks isn&apos;t an audit</span>}
              </Row>
              {isUpgradeableChain(state.plan.chainId) && <UpgradeableRow deploy={deploy} />}
            </dl>

            <UpgradeNotice state={state} />
            <ReplaceNotice state={state} />

            {state.needsTestGd && (
              <div className="mt-3 flex items-center justify-between gap-3 rounded-block bg-tint px-4 py-3 text-sm">
                <span className="text-violet-ink">Uses GoodBuild&apos;s test G$ on Sepolia. Claim 1,000 free, once a day.</span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={faucet === "claiming" || faucet === "claimed" || running}
                  onClick={() => {
                    setFaucet("claiming");
                    deploy.claimTestGd().then(
                      () => setFaucet("claimed"),
                      () => setFaucet("failed"),
                    );
                  }}
                >
                  {faucet === "claiming" ? "Claiming…" : faucet === "claimed" ? "Claimed" : faucet === "failed" ? "Try again" : "Get test G$"}
                </Button>
              </div>
            )}

            <div className="mt-5">
              <Stepper step={current} />
              {current && state.stage === "running" && (
                <p className="mt-2 text-xs text-grey-600" aria-live="polite">
                  {state.steps.length > 1 && `${current.name}: `}
                  {current.part && `${PART_COPY[current.part]}. `}
                  {PHASE_COPY[current.phase]}
                  {waitHint && <span className="mt-1 block text-ink">{waitHint}</span>}
                </p>
              )}
            </div>
          </>
        )}

        {state.stage === "done" && <Success state={state} chainId={state.plan?.chainId ?? chainId} deploy={deploy} />}
        {state.stage === "error" && <ErrorCard deploy={deploy} onFix={onFix} chainId={chainId} />}

        {wrongAccount && (
          <p className="mt-4 flex items-start gap-2 text-sm text-warning">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            Your wallet is on a different account than the one you signed in with. Switch back to deploy.
          </p>
        )}
        {state.plan && auth.wallet && auth.wallet.chainId !== state.plan.chainId && state.stage === "ready" && (
          <p className="mt-4 text-sm text-grey-600">We&apos;ll ask your wallet to switch to {chainLabel(state.plan.chainId)} first.</p>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-grey-600">
            {state.stage === "done" ? "You can find these addresses in the Contract tab." : (state.plan?.chainId ?? chainId) === 42220 ? "You pay the network fee in CELO." : "Testnet deploys are free of real money."}
          </p>
          {state.stage === "done" ? (
            <div className="flex gap-2">
              {onPublish && (
                <Button variant="secondary" onClick={onPublish}>
                  Publish app
                </Button>
              )}
              <Button variant="primary" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </div>
          ) : (
            <Button
              variant="primary"
              disabled={state.stage !== "ready" || !auth.user || !auth.wallet || wrongAccount || todo === 0}
              onClick={() => {
                if (isMainnet && !mainnetAcknowledged) setConfirmMainnet(true);
                else void deploy.start();
              }}
            >
              {running ? (
                <>
                  <Loader2 className="animate-spin motion-reduce:animate-none" /> Check your wallet
                </>
              ) : upgrading ? (
                "Sign & upgrade"
              ) : todo > 1 ? (
                `Sign & deploy ${todo} contracts`
              ) : (
                "Sign & deploy"
              )}
            </Button>
          )}
        </div>
        {!auth.wallet && state.stage === "ready" && <p className="mt-3 text-right text-xs text-grey-600">Connect your wallet from the top bar to continue.</p>}
        {!isMainnet && state.plan && state.stage === "ready" && (
          <div className="mt-3 text-right">
            <button type="button" className="text-xs font-medium text-violet hover:underline" aria-expanded={showFaucet} onClick={() => setShowFaucet((v) => !v)}>
              {showFaucet ? "Hide the faucet guide" : "Need free test CELO? See how"}
            </button>
            {showFaucet && <FaucetGuide className="mt-2 text-left" />}
          </div>
        )}
      </DialogContent>
      <Dialog open={confirmMainnet} onOpenChange={(v) => { setConfirmMainnet(v); if (!v) setTestTip(false); }}>
        <DialogContent className="sm:w-[460px]">
          <p className="eyebrow pr-10">{testTip ? "How to test first" : "Before you sign"}</p>
          <DialogTitle className="display mt-2 pr-10 text-[24px] font-extrabold">{testTip ? "Try it on Celo Sepolia" : "This deploys to Celo mainnet"}</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-grey-600">
            {testTip
              ? "Go to Home, pick Celo Sepolia beside the prompt box, and build the same idea. It deploys with free test money. When it works, come back and deploy here."
              : "Mainnet uses real CELO, and a deployed contract can\u2019t be taken back. We recommend trying it on Celo Sepolia first, where test money is free, to check that everything works. One tap switches this project to Sepolia, and you can switch back here. You can skip this."}
          </DialogDescription>
          {testTip && <FaucetGuide className="mt-4" />}
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            {testTip ? (
              <Button
                variant="primary"
                onClick={() => {
                  setConfirmMainnet(false);
                  setTestTip(false);
                  onOpenChange(false);
                }}
              >
                Got it
              </Button>
            ) : (
              <>
                <Button
                  variant="secondary"
                  onClick={() => {
                    if (!onSwitchNetwork) return setTestTip(true);
                    setConfirmMainnet(false);
                    void onSwitchNetwork(11142220);
                  }}
                >
                  Test on Sepolia first
                </Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    mainnetAcknowledged = true;
                    setConfirmMainnet(false);
                    void deploy.start();
                  }}
                >
                  Skip, deploy on mainnet
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}

function StepBadge({ step }: { step: StepView }) {
  if (step.phase === "waiting") return null;
  const done = step.phase === "done" || step.phase === "reused";
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", done ? "bg-success/10 text-success" : step.phase === "failed" ? "bg-danger/10 text-danger" : step.phase === "unsaved" ? "bg-warning/10 text-warning" : "bg-tint text-violet")}>
      {PHASE_COPY[step.phase]}
    </span>
  );
}
