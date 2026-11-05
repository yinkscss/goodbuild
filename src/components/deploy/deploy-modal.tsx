"use client";

import * as React from "react";
import { AlertTriangle, Check, ChevronDown, Copy, ExternalLink, Loader2 } from "lucide-react";
import { formatUnits } from "viem";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth/context";
import { chainLabel, explorerAddressUrl, explorerTxUrl } from "@/lib/deploy/explorer";
import type { StepPhase } from "@/lib/deploy/run";
import { shortAddress } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useDeploy, type DeployState, type StepView } from "./use-deploy";

type Deploy = ReturnType<typeof useDeploy>;

const PHASE_COPY: Record<StepPhase, string> = {
  waiting: "Waiting",
  reused: "Already deployed",
  simulating: "Checking on Celo…",
  signing: "Confirm in your wallet",
  broadcasting: "Sending to Celo…",
  recording: "Saving…",
  done: "Deployed",
  failed: "Failed",
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

function Stepper({ step }: { step: StepView | undefined }) {
  const { active, done } = stageIndex(step);
  const failed = step?.phase === "failed";
  const verifying = step && (step.phase === "done" || step.phase === "reused") && step.verify !== "verified";
  const labels = ["Sign", "Broadcast", "Verified"];
  return (
    <ol className="flex items-center gap-2" aria-label="Deploy progress">
      {labels.map((label, i) => {
        const complete = i < done;
        const current = i === active && !complete;
        return (
          <React.Fragment key={label}>
            <li className="flex items-center gap-2" aria-current={current ? "step" : undefined}>
              <span
                className={cn(
                  "grid size-6 place-items-center rounded-full text-[11px] font-semibold transition-colors duration-200 ease-gb",
                  complete ? "bg-success text-white" : current && failed ? "bg-danger text-white" : current ? "bg-violet text-white" : "bg-tint text-grey-600",
                )}
              >
                {complete ? (
                  <Check className="size-3.5" />
                ) : current && failed ? (
                  "!"
                ) : current && (i < 2 || verifying) ? (
                  <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
                ) : (
                  i + 1
                )}
              </span>
              <span className={cn("text-sm", complete || current ? "font-medium text-ink" : "text-grey-600")}>{label}</span>
            </li>
            {i < labels.length - 1 && <span className={cn("h-px flex-1", i < done - 0 ? "bg-success/50" : "bg-ink/10")} aria-hidden />}
          </React.Fragment>
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

/** Where to send CELO: email wallets start empty, and their owners may not know the address. */
function FundWallet({ chainId }: { chainId: number }) {
  const { wallet } = useAuth();
  if (!wallet) return null;
  return (
    <div className="mt-3 rounded-tip bg-surface p-3 text-sm">
      <p className="text-grey-600">Send a little CELO to your wallet, then try again.</p>
      <div className="mt-2 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate font-mono text-xs">{wallet.address}</code>
        <CopyButton value={wallet.address} />
      </div>
      {chainId !== 42220 && (
        <a className="mt-2 inline-block text-xs font-medium text-violet hover:underline" href="https://faucet.celo.org/celo-sepolia" target="_blank" rel="noreferrer">
          Get free test CELO from the faucet
        </a>
      )}
    </div>
  );
}

function ErrorCard({ deploy, onFix, chainId }: { deploy: Deploy; onFix: (prompt: string) => void; chainId: number }) {
  const { state } = deploy;
  const error = state.error;
  if (!error) return null;
  const fromBuilder = error.at === "prepare" && ["manifest_missing", "manifest_invalid", "compile_failed"].includes(error.code ?? "");
  const opcode = error.kind === "opcode";
  return (
    <div className="mt-5 rounded-block bg-canvas p-4" role="alert">
      <div className="flex items-start gap-3">
        <span className="mt-1.5 size-2 shrink-0 rounded-full bg-danger" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{opcode ? "Celo can't run this contract yet" : error.at === "prepare" ? "We couldn't prepare the deploy" : `Couldn't deploy ${error.at}`}</p>
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
            {!opcode && !fromBuilder && (
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
      <p className="mt-2 text-grey-600">Your project switches to the new {many ? "contracts" : "contract"}. A published app stays on the old {many ? "ones" : "one"} until you publish again.</p>
    </div>
  );
}

function Success({ state, chainId }: { state: DeployState; chainId: number }) {
  return (
    <div className="mt-5">
      <div className="relative mx-auto grid size-14 place-items-center">
        <span className="gb-burst absolute inset-0 rounded-full bg-pink/40" aria-hidden />
        <span className="relative grid size-14 place-items-center rounded-full bg-success text-white">
          <Check className="size-7" />
        </span>
      </div>
      <p className="mt-3 text-center text-sm text-grey-600">
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
            {s.txHash && (
              <a href={explorerTxUrl(chainId, s.txHash)} target="_blank" rel="noreferrer" className="mt-1.5 inline-block text-[11px] text-violet hover:underline">
                Transaction {shortAddress(s.txHash)}
              </a>
            )}
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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deploy: Deploy;
  chainId: number;
  onFix: (prompt: string) => void;
  onPublish?: () => void;
}) {
  const auth = useAuth();
  const { state } = deploy;
  const running = state.stage === "running";
  const wrongAccount = Boolean(auth.user && auth.wallet && auth.wallet.address.toLowerCase() !== auth.user.wallet.toLowerCase());
  const [faucet, setFaucet] = React.useState<"idle" | "claiming" | "claimed" | "failed">("idle");
  const todo = state.steps.filter((s) => s.phase !== "reused" && s.phase !== "done").length;
  const current = state.steps.find((s) => !["waiting", "reused", "done"].includes(s.phase)) ?? [...state.steps].reverse().find((s) => s.phase === "done" || s.phase === "reused") ?? state.steps[0];

  function handleOpenChange(next: boolean) {
    if (!next && running) return; // a signature is pending; don't strand it
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:w-[560px]" onInteractOutside={(e) => running && e.preventDefault()}>
        <p className="eyebrow pr-10">{state.stage === "done" ? "Done" : "You sign, we build"}</p>
        <DialogTitle className="display mt-2 pr-10 text-[28px] font-extrabold">{state.stage === "done" ? "Live on Celo" : "Deploy to Celo"}</DialogTitle>
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
              </Row>
            </dl>

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
                  {PHASE_COPY[current.phase]}
                </p>
              )}
            </div>
          </>
        )}

        {state.stage === "done" && <Success state={state} chainId={state.plan?.chainId ?? chainId} />}
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
            {state.stage === "done" ? "You can find these addresses in the Contract tab." : (state.plan?.chainId ?? chainId) === 42220 ? "This deploy spends real CELO." : "Testnet deploys are free of real money."}
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
              onClick={() => void deploy.start()}
            >
              {running ? (
                <>
                  <Loader2 className="animate-spin motion-reduce:animate-none" /> Check your wallet
                </>
              ) : todo > 1 ? (
                `Sign & deploy ${todo} contracts`
              ) : (
                "Sign & deploy"
              )}
            </Button>
          )}
        </div>
        {!auth.wallet && state.stage === "ready" && <p className="mt-3 text-right text-xs text-grey-600">Connect your wallet from the top bar to continue.</p>}
      </DialogContent>
    </Dialog>
  );
}

function StepBadge({ step }: { step: StepView }) {
  if (step.phase === "waiting") return null;
  const done = step.phase === "done" || step.phase === "reused";
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", done ? "bg-success/10 text-success" : step.phase === "failed" ? "bg-danger/10 text-danger" : "bg-tint text-violet")}>
      {PHASE_COPY[step.phase]}
    </span>
  );
}
