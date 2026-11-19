"use client";
import * as React from "react";
import { celo } from "viem/chains";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth/context";
import {
  FLOWSTATE_ABI,
  FLOWSTATE_CHAIN_ID,
  FLOWSTATE_COUNCIL,
  GOODBUILDIT_RECIPIENT,
  flowstateClaimMessage,
  type FlowstateStatus,
} from "@/lib/flowstate/config";
import { styles } from "./styles";
// The dialog is also used outside /hackathon (the free-credits card, D125). Every rule here is hk- scoped.
import "./hackathon.css";

type Review = FlowstateStatus & {
  additional: string;
  after: string;
  gas: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  feeCapWei: string;
  /** Set when GoodBuild just covered the network fee from its gas wallet. */
  gasGrant?: { amountWei: string; txHash: string };
};
class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly telegram?: string,
  ) {
    super(message);
  }
}
async function request(body?: unknown) {
  const res = await fetch(
    "/api/hackathon/flowstate",
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : { cache: "no-store" },
  );
  const data = await res.json();
  if (!res.ok)
    throw new RequestError(
      data.message ?? "We couldn’t reach FlowState. Please try again.",
      res.status,
      typeof data.telegram === "string" ? data.telegram : undefined,
    );
  return data;
}
export function FlowstateVote({ onConfirmed }: { onConfirmed?: () => void }) {
  const auth = useAuth();
  const [open, setOpen] = React.useState(false);
  const [status, setStatus] = React.useState<FlowstateStatus | null>(null);
  const [quantity, setQuantity] = React.useState("1");
  const [busy, setBusy] = React.useState("");
  const [error, setError] = React.useState("");
  const [helpLink, setHelpLink] = React.useState<string | undefined>();
  const [txHash, setTxHash] = React.useState<string | null>(null);
  const [discardArmed, setDiscardArmed] = React.useState(false);
  const [confirmed, setConfirmed] = React.useState(false);
  const wallet = auth.user?.wallet;
  const storageKey = `gb:flowstate:pending:${wallet}`;
  function applyStatus(next: FlowstateStatus) {
    setStatus(next);
    setQuantity(
      BigInt(next.available) > BigInt(Number.MAX_SAFE_INTEGER)
        ? String(Number.MAX_SAFE_INTEGER)
        : BigInt(next.available) > BigInt(0)
          ? next.available
          : "1",
    );
  }
  async function check(hash: string) {
    let next;
    try {
      next = await request({ action: "confirm", hash });
    } catch (e) {
      if (e instanceof RequestError && (e.status === 410 || e.status === 400)) {
        localStorage.removeItem(storageKey);
        setTxHash(null);
      }
      throw e;
    }
    applyStatus(next);
    setConfirmed(true);
    setTxHash(null);
    localStorage.removeItem(storageKey);
    onConfirmed?.();
  }
  async function perform(label: string, action: () => Promise<void>) {
    setBusy(label);
    setError("");
    setHelpLink(undefined);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
      if (e instanceof RequestError) setHelpLink(e.telegram);
    } finally {
      setBusy("");
    }
  }
  async function load() {
    setOpen(true);
    setConfirmed(false);
    setStatus(null);
    setTxHash(null);
    setError("");
    setDiscardArmed(false);
    await perform("Checking your wallet…", async () => {
      const saved = localStorage.getItem(storageKey);
      if (saved && /^0x[0-9a-fA-F]{64}$/.test(saved)) {
        setTxHash(saved);
        await check(saved);
        return;
      }
      const next: FlowstateStatus = await request();
      // Already voted for us (here, on /hackathon, or on FlowState itself)? Don't ask again: confirm it.
      if (next.verified && BigInt(next.support) > BigInt(0)) await confirmExisting();
      else applyStatus(next);
    });
  }
  /** Confirms the vote already on-chain and marks it done. Throws if it isn't settled yet. */
  async function confirmExisting() {
    const next = await request({ action: "existing" });
    setStatus(next);
    setConfirmed(true);
    setTxHash(null);
    localStorage.removeItem(storageKey);
    onConfirmed?.();
  }
  async function acceptExisting() {
    await perform("Checking your vote…", confirmExisting);
  }
  async function checkEligibilityAgain() {
    await perform("Checking your available votes…", async () => {
      const next: FlowstateStatus = await request();
      applyStatus(next);
      if (
        next.verified &&
        next.registered &&
        BigInt(next.available) > BigInt(0)
      ) {
        setConfirmed(false);
      }
    });
  }
  async function signer() {
    if (!wallet) throw new Error("Connect with your email first.");
    await auth.switchChain(FLOWSTATE_CHAIN_ID);
    const client = await auth.getWalletClient();
    const [account] = await client.getAddresses();
    if (account?.toLowerCase() !== wallet.toLowerCase())
      throw new Error("Switch back to the wallet you signed in with.");
    return { client, account };
  }
  async function enable() {
    await perform("Enabling voting…", async () => {
      const { client, account } = await signer();
      const issuedAt = Date.now();
      const signature = await client.signMessage({
        account,
        message: flowstateClaimMessage(account, issuedAt),
      });
      applyStatus(
        await request({ action: "eligibility", signature, issuedAt }),
      );
    });
  }
  /**
   * One button: switch to Celo, then price the vote (and cover the network fee if the wallet is short),
   * then the wallet's own confirmation. Pricing runs after every wallet prompt that can move the ballot,
   * so what the wallet shows is what the server just checked.
   */
  async function vote(e: React.FormEvent) {
    e.preventDefault();
    await perform("Getting your vote ready… this can take up to 30 seconds.", async () => {
      if (!/^[1-9]\d{0,28}$/.test(quantity))
        throw new Error("Choose at least 1 point.");
      const { client, account } = await signer();
      const ready: Review = await request({ action: "prepare", additional: quantity });
      setBusy("Confirm the vote in your wallet…");
      const hash = await client.writeContract({
        account,
        chain: celo,
        address: FLOWSTATE_COUNCIL,
        abi: FLOWSTATE_ABI,
        functionName: "vote",
        args: [[{ recipient: GOODBUILDIT_RECIPIENT, amount: BigInt(ready.after) }]],
        gas: BigInt(ready.gas),
        maxFeePerGas: BigInt(ready.maxFeePerGas),
        maxPriorityFeePerGas: BigInt(ready.maxPriorityFeePerGas),
      });
      setTxHash(hash);
      localStorage.setItem(storageKey, hash);
      setBusy("Confirming your vote…");
      // The server confirms sender, target, successful receipt, calldata and live allocation.
      for (let i = 0; i < 12; i++) {
        try {
          await check(hash);
          return;
        } catch (e) {
          if (e instanceof RequestError && (e.status === 400 || e.status === 410)) throw e;
          if (i === 11)
            throw new Error("Your vote was sent and is still being checked. Press Check again in a moment; don’t vote again.");
        }
        await new Promise((resolve) => setTimeout(resolve, 2500));
      }
    });
  }
  const max = status ? Math.min(Number.MAX_SAFE_INTEGER, Number(status.available)) : 1;
  const canVote =
    status !== null &&
    BigInt(status.available) > BigInt(0) &&
    (!status.spreadFull || BigInt(status.support) > BigInt(0));
  const hasSupport = status !== null && BigInt(status.support) > BigInt(0);
  return (
    <>
      <button
        type="button"
        className={styles.btnV}
        disabled={!wallet}
        onClick={() => void load()}
      >
        {confirmed ? "✓ Vote confirmed" : "Vote here with your wallet"}
      </button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!busy) setOpen(next);
        }}
      >
        <DialogContent
          className="hk-page hk-flowstate-dialog sm:max-w-[480px] max-h-[90dvh] overflow-y-auto"
          onInteractOutside={(e) => {
            if (busy) e.preventDefault();
          }}
        >
          <DialogTitle className="pr-8 text-2xl font-bold">
            Support our project
          </DialogTitle>
          <DialogDescription className="sr-only">
            Vote for GoodBuildIt on FlowState with your signed-in wallet.
          </DialogDescription>
          {busy && (
            <p role="status" className="rounded-block bg-tint p-3 text-sm text-violet">
              {busy}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          {helpLink && (
            <a
              href={helpLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex text-sm font-semibold text-violet underline"
            >
              Message us on Telegram
            </a>
          )}
          {confirmed ? (
            <div className="space-y-4 text-center">
              <p className="text-lg font-semibold">✓ Thank you for voting!</p>
              {status && BigInt(status.available) <= BigInt(0) && (
                <p className="text-sm">You have no votes available right now.</p>
              )}
              <button
                type="button"
                className={`${styles.btnV} w-full`}
                disabled={Boolean(busy)}
                onClick={() => void checkEligibilityAgain()}
              >
                Check for new eligibility to vote again
              </button>
              <button type="button" className={`${styles.btnV} w-full`} onClick={() => setOpen(false)}>
                Continue
              </button>
            </div>
          ) : txHash ? (
            <div className="space-y-3">
              <p className="text-sm">Your vote was sent. Check it before voting again.</p>
              <button
                type="button"
                className={`${styles.btnV} w-full`}
                disabled={Boolean(busy)}
                onClick={() => void perform("Checking your vote…", () => check(txHash))}
              >
                Check my vote
              </button>
              {discardArmed ? (
                <button
                  type="button"
                  className="block text-sm text-violet underline"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void perform("Refreshing…", async () => {
                      applyStatus(await request());
                      setTxHash(null);
                      localStorage.removeItem(storageKey);
                      setDiscardArmed(false);
                    })
                  }
                >
                  Stop checking (the vote may still go through)
                </button>
              ) : (
                <button
                  type="button"
                  className="block text-sm text-violet underline"
                  disabled={Boolean(busy)}
                  onClick={() => setDiscardArmed(true)}
                >
                  Stuck?
                </button>
              )}
            </div>
          ) : status ? (
            !status.verified ? (
              <a className={`${styles.btnV} w-full`} href="/hackathon#register">
                Verify with GoodDollar first
              </a>
            ) : !status.registered ? (
              <button
                type="button"
                className={`${styles.btnV} w-full`}
                disabled={Boolean(busy)}
                onClick={() => void enable()}
              >
                Enable voting with this wallet
              </button>
            ) : (
              <form method="post" action="/api/hackathon/flowstate" className="space-y-5" onSubmit={vote}>
                {canVote && (
                  <>
                    <div className="hk-vote-allocation" aria-live="polite">
                      <output htmlFor="flowstate-votes" className="hk-vote-number">
                        {quantity}
                      </output>
                      <p>of {status.available} points</p>
                    </div>
                    <input
                      id="flowstate-votes"
                      className="hk-vote-range"
                      type="range"
                      aria-label="Votes for GoodBuildIt"
                      aria-valuetext={`${quantity} points`}
                      style={{ "--slider-fill": `${max <= 1 ? 100 : ((Number(quantity) - 1) / (max - 1)) * 100}%` } as React.CSSProperties}
                      name="additional"
                      min="1"
                      max={max}
                      step="1"
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                    />
                    <button className={`${styles.btnV} w-full`} disabled={Boolean(busy)}>
                      Vote {quantity} {quantity === "1" ? "point" : "points"}
                    </button>
                  </>
                )}
                {hasSupport && (
                  <button
                    type="button"
                    className={canVote ? "block w-full text-center text-sm text-violet underline" : `${styles.btnV} w-full`}
                    disabled={Boolean(busy)}
                    onClick={() => void acceptExisting()}
                  >
                    I already voted
                  </button>
                )}
                {!canVote && !hasSupport && (
                  <p className="text-sm">All your points are already given to other projects.</p>
                )}
              </form>
            )
          ) : (
            !busy && (
              <button type="button" className={`${styles.btnV} w-full`} onClick={() => void load()}>
                Try again
              </button>
            )
          )}
          {error.includes("CELO") && wallet && (
            <button
              type="button"
              className="text-left text-sm text-violet underline"
              onClick={() => void navigator.clipboard.writeText(wallet)}
            >
              Copy my wallet address to add CELO
            </button>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
