"use client";

import * as React from "react";
import { Check, ExternalLink, Loader2 } from "lucide-react";
import { formatUnits, parseUnits } from "viem";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/context";
import type { ExitFunction, OldContract } from "@/lib/deploy/exit-functions";
import { chainLabel, explorerAddressUrl, explorerTxUrl } from "@/lib/deploy/explorer";
import { runExit, withdrawErrorMessage } from "@/lib/deploy/withdraw";
import { shortAddress } from "@/lib/format";

const CELO_MAINNET = 42220;

const ADD_WAY_OUT =
  "Make sure the contract lets people take out their own funds with a withdraw function, so funds can be moved if this contract is ever replaced. Keep everything else the same.";

function formatGd(wei: string) {
  return Number(formatUnits(BigInt(wei), 18)).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function ExitButton({ contract, exit, chainId, onDone }: { contract: OldContract; exit: ExitFunction; chainId: number; onDone: (hash: string) => void }) {
  const auth = useAuth();
  const [busy, setBusy] = React.useState(false);
  const [amount, setAmount] = React.useState(() => formatUnits(BigInt(contract.gdBalance), 18));
  const [error, setError] = React.useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      if (!auth.wallet) throw new Error("no_wallet");
      if (auth.wallet.address.toLowerCase() !== auth.user?.wallet.toLowerCase()) throw new Error("wrong_wallet");
      if (auth.wallet.chainId !== chainId) await auth.switchChain(chainId);
      const hash = await runExit({
        client: await auth.getWalletClient(),
        account: auth.wallet.address,
        chainId,
        embedded: auth.wallet.kind === "embedded",
        contract: contract.address,
        exit,
        amount: exit.input === "amount" ? parseUnits(amount || "0", 18) : undefined,
      });
      onDone(hash);
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      setError(
        message === "no_wallet"
          ? "Connect your wallet from the top bar first."
          : message === "wrong_wallet"
            ? "Switch to the wallet you signed in with, then try again."
            : withdrawErrorMessage(e),
      );
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {exit.input === "amount" && (
          <input
            aria-label={`Amount of G$ for ${exit.name}`}
            value={amount}
            inputMode="decimal"
            disabled={busy}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            className="w-28 rounded-full bg-surface px-3 py-2 text-xs outline-none focus:shadow-focus"
          />
        )}
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => void run()}>
          {busy && <Loader2 className="animate-spin motion-reduce:animate-none" />}
          {busy ? "Check your wallet" : "Move funds out"}
        </Button>
        <code className="font-mono text-xs text-grey-600">{exit.name}()</code>
      </div>
      {error && <p className="mt-2 text-xs text-grey-600">{error}</p>}
    </div>
  );
}

/**
 * A calm note about G$ left in contracts a newer deploy replaced, with what can actually be done.
 * Offers no direct send to the new contract: G$ sent that way may never be credited to anyone.
 */
export function OldFundsCard({ projectId, chainId, refreshKey, busy, onAsk }: { projectId: string; chainId: number; refreshKey: unknown; busy: boolean; onAsk: (prompt: string) => void }) {
  const [contracts, setContracts] = React.useState<OldContract[]>([]);
  const [moved, setMoved] = React.useState<string | null>(null);
  const [reloads, setReloads] = React.useState(0);

  React.useEffect(() => {
    let stale = false;
    void fetch(`/api/projects/${projectId}/old-contracts`)
      .then((res) => (res.ok ? (res.json() as Promise<{ contracts: OldContract[] }>) : null))
      .catch(() => null)
      .then((body) => {
        if (body && !stale) setContracts(body.contracts);
      });
    return () => {
      stale = true;
    };
  }, [projectId, refreshKey, reloads]);

  if (!contracts.length && !moved) return null;

  return (
    <div className="rounded-block bg-tint p-4 text-sm">
      {moved && (
        <p className="flex items-center gap-2 font-semibold" role="status">
          <Check className="size-4 shrink-0 text-success" aria-hidden /> Done.
          <a href={explorerTxUrl(chainId, moved)} target="_blank" rel="noreferrer" className="font-normal text-violet hover:underline">
            See the transaction
          </a>
        </p>
      )}
      {contracts.length > 0 && (
        <>
          <p className={moved ? "mt-3 font-semibold text-violet-ink" : "font-semibold text-violet-ink"}>An older version of your contract still holds funds</p>
          <p className="mt-1 text-grey-600">
            Nothing is lost: replacing a contract doesn&apos;t touch what&apos;s inside it.{chainId !== CELO_MAINNET && ` On ${chainLabel(chainId)} this is test G$, so there's no rush.`}
          </p>
          <ul className="mt-3 space-y-3">
            {contracts.map((c) => (
              <li key={c.address} className="rounded-block bg-surface/60 p-3">
                <p className="flex flex-wrap items-center gap-x-2">
                  <span className="font-medium">{c.name}</span>
                  <span>{formatGd(c.gdBalance)} G$</span>
                  <a href={explorerAddressUrl(chainId, c.address)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-xs text-grey-600 hover:text-violet">
                    {shortAddress(c.address)} <ExternalLink className="size-3" aria-hidden />
                  </a>
                </p>
                {c.exits.length > 0 ? (
                  <div className="mt-2 space-y-2">
                    {c.exits.map((exit) => (
                      <ExitButton
                        key={exit.name}
                        contract={c}
                        exit={exit}
                        chainId={chainId}
                        onDone={(hash) => {
                          setMoved(hash);
                          setReloads((n) => n + 1);
                        }}
                      />
                    ))}
                    <p className="text-xs text-grey-600">Your wallet shows what you&apos;re signing. The contract decides who can take out what.</p>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-grey-600">This version has no withdraw function, so neither you nor GoodBuild can move these funds. They stay in that contract.</p>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-grey-600">Once funds are in your wallet, put them into the new version through your app. Don&apos;t send G$ straight to a contract address, because it may not be counted.</p>
          {contracts.some((c) => !c.exits.length) && (
            <Button variant="ghost" size="sm" className="mt-2 -ml-3" disabled={busy} onClick={() => onAsk(ADD_WAY_OUT)}>
              Make sure the next version has a way out
            </Button>
          )}
        </>
      )}
    </div>
  );
}
