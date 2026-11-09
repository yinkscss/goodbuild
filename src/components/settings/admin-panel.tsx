"use client";

import * as React from "react";
import { Check, Loader2 } from "lucide-react";
import type { Address } from "viem";

import { Button } from "@/components/ui/button";
import { PanelState, useAccountData, CARD, CHIP } from "@/components/settings/use-account-data";
import { useAuth } from "@/lib/auth/context";
import { parseArgs } from "@/lib/deploy/admin-functions";
import { readOwner, runAdminCall } from "@/lib/deploy/admin-call";
import { explorerTxUrl } from "@/lib/deploy/explorer";
import { withdrawErrorMessage } from "@/lib/deploy/withdraw";
import { chainName, shortAddress } from "@/lib/format";
import type { AdminContract } from "@/server/account/overview";

const MAINNET = 42220;

function FunctionCard({ contract, fn, owner }: { contract: AdminContract; fn: AdminContract["functions"][number]; owner: Address | null | undefined }) {
  const auth = useAuth();
  const [values, setValues] = React.useState<string[]>(() => fn.abi.inputs.map(() => ""));
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<string | null>(null);
  const [fieldError, setFieldError] = React.useState<{ index: number; error: string } | null>(null);

  function review() {
    const parsed = parseArgs(fn.abi, values);
    if (!parsed.ok) return setFieldError({ index: parsed.index, error: parsed.error });
    setFieldError(null);
    setError(null);
    setDone(null);
    setConfirming(true);
  }

  async function run() {
    const parsed = parseArgs(fn.abi, values);
    if (!parsed.ok) return;
    setBusy(true);
    setError(null);
    try {
      if (!auth.wallet) throw new Error("no_wallet");
      if (auth.wallet.address.toLowerCase() !== auth.user?.wallet.toLowerCase()) throw new Error("wrong_wallet");
      if (auth.wallet.chainId !== contract.chainId) await auth.switchChain(contract.chainId);
      const hash = await runAdminCall({ client: await auth.getWalletClient(), account: auth.wallet.address, chainId: contract.chainId, embedded: auth.wallet.kind === "embedded", contract: contract.address as Address, fn: fn.abi, callArgs: parsed.args });
      setDone(hash);
      setConfirming(false);
    } catch (e) {
      const m = e instanceof Error ? e.message : "";
      setError(m === "no_wallet" ? "Connect your wallet from the top bar first." : m === "wrong_wallet" ? "Switch to the wallet you signed in with, then try again." : withdrawErrorMessage(e));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  const notOwner = owner && auth.user && owner.toLowerCase() !== auth.user.wallet.toLowerCase();
  return (
    <div className="rounded-block bg-tint p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-semibold">{fn.label}</p>
        <code className="font-mono text-xs text-grey-600">{fn.name}()</code>
        {fn.sensitive && <span className="rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning">Moves funds or control</span>}
      </div>
      {!fn.supported ? (
        <p className="mt-2 text-xs text-grey-600">{fn.reason}</p>
      ) : (
        <>
          {fn.abi.inputs.length > 0 && (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {fn.abi.inputs.map((input, i) => (
                <label key={i} className="block text-xs text-grey-600">
                  {input.name || `Value ${i + 1}`} <span className="font-mono">({input.type})</span>
                  <input
                    value={values[i]}
                    disabled={busy || confirming}
                    onChange={(e) => setValues((v) => v.map((x, j) => (j === i ? e.target.value : x)))}
                    className="mt-1 block w-full rounded-full bg-surface px-3 py-2 text-base text-ink outline-none focus:shadow-focus sm:text-sm"
                  />
                  {fieldError?.index === i && <span role="alert" className="mt-1 block text-danger">{fieldError.error}</span>}
                </label>
              ))}
            </div>
          )}
          {!confirming ? (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button variant="secondary" size="sm" onClick={review}>Review and run</Button>
              {notOwner && <span className="text-xs text-grey-600">This contract&apos;s owner is {shortAddress(owner as string)}, not your wallet. The chain will refuse it.</span>}
            </div>
          ) : (
            <div className="mt-3 rounded-[14px] bg-surface p-3 text-sm">
              <p>
                You are about to run <strong>{fn.label}</strong> on <strong>{contract.contractName}</strong> on <strong>{chainName(contract.chainId)}</strong>
                {contract.chainId === MAINNET ? ". This uses real money for the network fee and cannot be undone." : "."} Your wallet will ask you to sign. We check it first, so a call the contract would refuse never reaches your wallet.
              </p>
              <div className="mt-3 flex gap-2">
                <Button size="sm" disabled={busy} onClick={() => void run()}>
                  {busy && <Loader2 className="animate-spin motion-reduce:animate-none" />}
                  {busy ? "Check your wallet" : "Confirm"}
                </Button>
                <Button variant="secondary" size="sm" disabled={busy} onClick={() => setConfirming(false)}>Cancel</Button>
              </div>
            </div>
          )}
        </>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-grey-600">{error}</p>}
      {done && (
        <p role="status" className="mt-2 flex items-center gap-1.5 text-xs font-medium">
          <Check className="size-3.5 text-success" aria-hidden /> Done.{" "}
          <a href={explorerTxUrl(contract.chainId, done)} target="_blank" rel="noreferrer" className="font-normal text-violet hover:underline">See the transaction</a>
        </p>
      )}
    </div>
  );
}

function ContractCard({ contract }: { contract: AdminContract }) {
  const [owner, setOwner] = React.useState<Address | null | undefined>(undefined);
  React.useEffect(() => {
    let stale = false;
    if (contract.hasOwner) void readOwner(contract.chainId, contract.address as Address).then((o) => !stale && setOwner(o));
    return () => {
      stale = true;
    };
  }, [contract]);
  const auth = useAuth();
  const isOwner = owner && auth.user ? owner.toLowerCase() === auth.user.wallet.toLowerCase() : null;
  return (
    <li className={CARD}>
      <p className="flex flex-wrap items-center gap-2">
        <span className="text-base font-semibold">{contract.contractName}</span>
        <span className={CHIP}>{chainName(contract.chainId)}</span>
        <span className="text-sm text-grey-600">{contract.projectName}</span>
        {isOwner === true && <span className="rounded-full bg-success/10 px-2.5 py-0.5 text-[12px] font-medium text-success">Your wallet is the owner</span>}
        {isOwner === false && <span className="rounded-full bg-warning/10 px-2.5 py-0.5 text-[12px] font-medium text-warning">Owned by {shortAddress(owner as string)}</span>}
      </p>
      <p className="mt-1 text-xs text-grey-600">These functions look like owner or admin controls. We guess from their names, so the contract itself decides who may run them.</p>
      <div className="mt-3 space-y-3">
        {contract.functions.map((fn) => (
          <FunctionCard key={fn.name + fn.abi.inputs.map((i) => i.type).join()} contract={contract} fn={fn} owner={owner} />
        ))}
      </div>
    </li>
  );
}

export function AdminPanel() {
  const loaded = useAccountData<{ contracts: AdminContract[] }>("/api/account/admin-functions");
  const rows = loaded.state === "ready" ? loaded.data.contracts : [];
  return (
    <PanelState loaded={loaded} empty={loaded.state === "ready" && !rows.length ? <div className={`${CARD} mt-6 text-center text-sm text-grey-600`}>None of your live contracts have owner or admin functions yet.</div> : undefined}>
      <ul className="mt-6 space-y-4">{rows.map((c) => <ContractCard key={c.deploymentId} contract={c} />)}</ul>
    </PanelState>
  );
}
