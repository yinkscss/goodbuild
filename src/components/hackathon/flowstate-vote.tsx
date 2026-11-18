"use client";
import * as React from "react";
import { formatEther } from "viem";
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
import { shortAddress } from "@/lib/format";
import { styles } from "./styles";

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
  const [review, setReview] = React.useState<Review | null>(null);
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
    setReview(null);
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
    setTxHash(null);
    setReview(null);
    setError("");
    setDiscardArmed(false);
    await perform("Checking your wallet…", async () => {
      const saved = localStorage.getItem(storageKey);
      if (saved && /^0x[0-9a-fA-F]{64}$/.test(saved)) {
        setTxHash(saved);
        await check(saved);
      }
      applyStatus(await request());
    });
  }
  async function acceptExisting() {
    await perform("Checking existing support…", async () => {
      const next = await request({ action: "existing" });
      setStatus(next);
      setConfirmed(true);
      setReview(null);
      setTxHash(null);
      localStorage.removeItem(storageKey);
      onConfirmed?.();
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
  async function prepare(e: React.FormEvent) {
    e.preventDefault();
    await perform("Checking your vote and covering the network fee… this can take up to 30 seconds.", async () => {
      if (!/^[1-9]\d{0,28}$/.test(quantity))
        throw new Error("Enter a whole number of votes, starting at 1.");
      setReview(await request({ action: "prepare", additional: quantity }));
    });
  }
  async function submit() {
    if (!review) return;
    await perform("Confirming your vote…", async () => {
      const { client, account } = await signer();
      // Recheck after any wallet/chain prompts, before asking Magic to send anything.
      const fresh: Review = await request({
        action: "prepare",
        additional: review.additional,
      });
      if (
        fresh.after !== review.after ||
        BigInt(fresh.feeCapWei) > BigInt(review.feeCapWei)
      ) {
        setReview(fresh);
        throw new Error(
          "Your ballot or the network fee changed. Review the updated details, then confirm again.",
        );
      }
      const hash = await client.writeContract({
        account,
        chain: celo,
        address: FLOWSTATE_COUNCIL,
        abi: FLOWSTATE_ABI,
        functionName: "vote",
        args: [
          [{ recipient: GOODBUILDIT_RECIPIENT, amount: BigInt(fresh.after) }],
        ],
        gas: BigInt(fresh.gas),
        maxFeePerGas: BigInt(fresh.maxFeePerGas),
        maxPriorityFeePerGas: BigInt(fresh.maxPriorityFeePerGas),
      });
      setTxHash(hash);
      localStorage.setItem(storageKey, hash);
      setReview(null);
      // The server confirms sender, target, successful receipt, calldata and live allocation.
      for (let i = 0; i < 12; i++) {
        try {
          await check(hash);
          return;
        } catch (e) {
          if (
            e instanceof RequestError &&
            (e.status === 400 || e.status === 410)
          )
            throw e;
          if (i === 11)
            throw new Error(
              "Your vote was sent and is still being checked. Use Check confirmation below; you don’t need to vote again.",
            );
        }
        await new Promise((resolve) => setTimeout(resolve, 2500));
      }
    });
  }
  return (
    <>
      <button
        type="button"
        className={styles.btnV}
        disabled={!wallet}
        onClick={() => void load()}
      >
        {confirmed
          ? "✓ FlowState vote confirmed"
          : "Vote here with your email wallet"}
      </button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!busy) setOpen(next);
        }}
      >
        <DialogContent
          className="hk-page hk-flowstate-dialog sm:max-w-[560px] max-h-[90dvh] overflow-y-auto"
          onInteractOutside={(e) => {
            if (busy) e.preventDefault();
          }}
        >
          <DialogTitle className="pr-8 text-2xl font-bold">
            Support GoodBuildIt on FlowState
          </DialogTitle>
          <DialogDescription>
            Use the wallet you already created with your email. You stay on
            GoodBuild and review everything before voting.
          </DialogDescription>
          <p className="text-sm text-grey-600">
            Wallet:{" "}
            <span className="font-mono">{wallet && shortAddress(wallet)}</span>
          </p>
          {busy && (
            <p
              role="status"
              className="rounded-block bg-tint p-3 text-sm text-violet"
            >
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
          {error.includes("CELO") && wallet && (
            <div className="space-y-2 rounded-block bg-tint p-3 text-sm">
              <p>Receive CELO on the Celo network at this wallet address:</p>
              <p className="break-all font-mono text-xs">{wallet}</p>
              <button
                type="button"
                className="text-violet underline"
                onClick={() => void navigator.clipboard.writeText(wallet)}
              >
                Copy wallet address
              </button>
            </div>
          )}
          {confirmed ? (
            <div className="space-y-3 rounded-block bg-tint p-4">
              <p className="font-semibold">
                ✓ Your vote is confirmed on FlowState.
              </p>
              <p className="text-sm">
                Your wallet currently allocates {status?.support} voting points
                to GoodBuildIt. Thank you for supporting us.
              </p>
              <button
                type="button"
                className={styles.btnV}
                onClick={() => setOpen(false)}
              >
                Continue
              </button>
            </div>
          ) : txHash ? (
            <div className="space-y-3">
              <p className="text-sm">
                Your transaction has been sent. Check its confirmation before
                trying another vote.
              </p>
              <button
                type="button"
                className={styles.btnV}
                disabled={Boolean(busy)}
                onClick={() =>
                  void perform("Checking confirmation…", () => check(txHash))
                }
              >
                Check confirmation
              </button>
              <button
                type="button"
                className="block text-sm text-violet underline"
                disabled={Boolean(busy)}
                onClick={() => setDiscardArmed(true)}
              >
                Recovery options
              </button>
              {discardArmed && (
                <div className="space-y-3 rounded-block bg-tint p-3 text-sm">
                  <p>
                    Stopping checks does not cancel a transaction. It may still
                    confirm. Check the transaction before sending another vote.
                  </p>
                  <button
                    type="button"
                    className={styles.btnV}
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void perform("Refreshing ballot…", async () => {
                        applyStatus(await request());
                        setTxHash(null);
                        localStorage.removeItem(storageKey);
                        setDiscardArmed(false);
                      })
                    }
                  >
                    Stop tracking & refresh ballot
                  </button>
                </div>
              )}
            </div>
          ) : status ? (
            <>
              {!status.verified ? (
                <p className="text-sm">
                  Complete{" "}
                  <a
                    className="text-violet underline"
                    href="/hackathon#register"
                  >
                    GoodDollar verification
                  </a>{" "}
                  first, then return here.
                </p>
              ) : !status.registered ? (
                <div className="space-y-4">
                  <p className="text-sm">
                    First, enable this wallet’s voting rights for the
                    GoodBuilders council. This signs a message authorizing
                    FlowState to register this wallet; it does not transfer
                    funds. One wallet per verified person can hold these voting
                    rights.
                  </p>
                  <button
                    type="button"
                    className={styles.btnV}
                    disabled={Boolean(busy)}
                    onClick={() => void enable()}
                  >
                    Enable voting with this wallet
                  </button>
                  <p className="text-xs text-grey-600">
                    Voting has a tiny network fee. The first time, GoodBuild
                    covers it for you.
                  </p>
                </div>
              ) : review ? (
                <div className="space-y-4 rounded-block bg-tint p-4">
                  <p className="font-semibold">Review your vote</p>
                  {review.gasGrant && (
                    <p className="rounded-block bg-white p-3 text-sm">
                      ✓ We added{" "}
                      {Number(formatEther(BigInt(review.gasGrant.amountWei))).toFixed(2)}{" "}
                      CELO to your wallet to pay the network fee. It&rsquo;s free,
                      and what&rsquo;s left helps with your first app deploy.
                    </p>
                  )}
                  <dl className="grid grid-cols-[1fr_auto] gap-3 text-sm">
                    <dt>Project</dt>
                    <dd>GoodBuildIt</dd>
                    <dt>Additional voting points</dt>
                    <dd>{review.additional}</dd>
                    <dt>Your total support after voting</dt>
                    <dd>{review.after}</dd>
                    <dt>G$ sent from your wallet</dt>
                    <dd>0 G$</dd>
                    <dt className="col-span-2">
                      Network fee cap: {formatEther(BigInt(review.feeCapWei))}{" "}
                      CELO
                    </dt>
                  </dl>
                  <p className="text-sm">
                    Your votes for other projects stay unchanged. Only the
                    reviewed GoodBuildIt allocation is updated.
                  </p>
                  <button
                    type="button"
                    className={styles.btnV}
                    disabled={Boolean(busy)}
                    onClick={() => void submit()}
                  >
                    Confirm vote for GoodBuildIt
                  </button>
                  <button
                    type="button"
                    className="block text-sm text-violet underline"
                    disabled={Boolean(busy)}
                    onClick={() => setReview(null)}
                  >
                    Change vote amount
                  </button>
                </div>
              ) : (
                <form
                  method="post"
                  action="/api/hackathon/flowstate"
                  className="space-y-4"
                  onSubmit={prepare}
                >
                  {BigInt(status.support) > BigInt(0) && (
                    <div className="space-y-3 rounded-block bg-tint p-3">
                      <p className="text-sm">
                        You already support GoodBuildIt on FlowState. You don’t
                        need to send another vote.
                      </p>
                      <button
                        type="button"
                        className={styles.btnV}
                        disabled={Boolean(busy)}
                        onClick={() => void acceptExisting()}
                      >
                        Use my existing support
                      </button>
                    </div>
                  )}
                  <p className="text-sm">
                    You have <strong>{status.available}</strong> unallocated
                    voting points. You already support GoodBuildIt with{" "}
                    {status.support}. Your other allocations stay unchanged.
                  </p>
                  {BigInt(status.available) > BigInt(0) &&
                  (!status.spreadFull || BigInt(status.support) > BigInt(0)) ? (
                    <>
                      <label
                        className="block text-sm"
                        htmlFor="flowstate-votes"
                      >
                        Additional votes for GoodBuildIt
                      </label>
                      <div className="hk-vote-allocation" aria-live="polite">
                        <output
                          htmlFor="flowstate-votes"
                          className="hk-vote-number"
                        >
                          {quantity}
                        </output>
                        <p>voting points for GoodBuildIt</p>
                      </div>
                      <input
                        id="flowstate-votes"
                        className="hk-vote-range"
                        type="range"
                        style={
                          {
                            "--slider-fill": `${Number(status.available) <= 1 ? 100 : ((Number(quantity) - 1) / (Math.min(Number.MAX_SAFE_INTEGER, Number(status.available)) - 1)) * 100}%`,
                          } as React.CSSProperties
                        }
                        name="additional"
                        min="1"
                        max={Math.min(
                          Number.MAX_SAFE_INTEGER,
                          Number(status.available),
                        )}
                        step="1"
                        aria-describedby="flowstate-vote-help"
                        aria-valuetext={`${quantity} additional voting points for GoodBuildIt`}
                        value={quantity}
                        onChange={(e) => {
                          setQuantity(e.target.value);
                          setReview(null);
                        }}
                      />
                      <div className="hk-vote-range-labels" aria-hidden="true">
                        <span>1 point</span>
                        <span>{status.available} available points</span>
                      </div>
                      <p id="flowstate-vote-help" className="text-sm">
                        We’ve selected all your available points. You can drag
                        to adjust, then review your vote. Nothing is sent until
                        you confirm.
                      </p>
                      <button className={styles.btnV} disabled={Boolean(busy)}>
                        Review vote & network fee
                      </button>
                    </>
                  ) : (
                    <p className="text-sm">
                      Your available votes or project slots are already
                      allocated. We will not move votes away from other projects
                      without your permission.
                    </p>
                  )}
                </form>
              )}
            </>
          ) : (
            !busy && (
              <button
                type="button"
                className={styles.btnV}
                onClick={() => void load()}
              >
                Retry wallet check
              </button>
            )
          )}
          {txHash && (
            <a
              className="break-all text-sm text-violet underline"
              href={`https://celoscan.io/tx/${txHash}`}
              target="_blank"
              rel="noreferrer"
            >
              View transaction ↗
            </a>
          )}
          <details className="text-xs text-grey-600">
            <summary className="cursor-pointer">Voting details</summary>
            <p className="mt-2 break-all">
              Network: Celo (42220)
              <br />
              Council: {FLOWSTATE_COUNCIL}
              <br />
              GoodBuildIt funding address: {GOODBUILDIT_RECIPIENT}
            </p>
          </details>
        </DialogContent>
      </Dialog>
    </>
  );
}
